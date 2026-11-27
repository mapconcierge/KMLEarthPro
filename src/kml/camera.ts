import { childrenOf, type AbstractView, type Camera, type Feature, type KmlDocument, type LookAt } from './types'

/**
 * KML の視点（LookAt / Camera）を各エンジンへ渡すための共通処理。
 *
 * KML の角度: heading は北=0 の時計回り、tilt は 0=真下・90=水平（Camera は最大 180）。
 * 各エンジンの pitch は水平=0・真下=-90 なので、pitch = tilt - 90 に直す。
 *
 * 地形標高: 純関数側（lookAtToPose / cameraToPose / viewToCenterZoom）は altitudeMode を
 * 'absolute' とみなして高度をそのまま使う。標高を考慮するときは、先に resolveAbsoluteView で
 * エンジンが持つ地形から標高を引いて 'absolute' に直してから渡す。標高が引けない場合は
 * 標高 0 m を地面とみなす。高度の基準（楕円体高/海抜）は各エンジンの地形データに従い、
 * ジオイド補正は行わない。
 */

/** 文書内で最初に見つかる視点。根 → 子の深さ優先（Google Earth が開いたとき最初に飛ぶ視点に相当） */
export function findInitialView(doc: KmlDocument): AbstractView | undefined {
  const walk = (f: Feature): AbstractView | undefined => {
    if (f.view) return f.view
    for (const c of childrenOf(f)) {
      const v = walk(c)
      if (v) return v
    }
    return undefined
  }
  return walk(doc.root)
}

/**
 * 視点が指す対象点（LookAt の注視点 / Camera の位置）の高度。
 * LookAt の clampToGround は高度を無視して 0。Camera は clampToGround でも地面より下に
 * 潜らないよう、altitude を地上高として扱う（標高 0 m が地面の前提）。
 */
function altitudeOf(v: { kind: 'LookAt' | 'Camera'; altitude: number; altitudeMode: string }): number {
  return v.kind === 'LookAt' && v.altitudeMode === 'clampToGround' ? 0 : v.altitude
}

/** 経緯度の地形標高（m）を返す関数。引けなければ undefined（呼び出し側は 0 m 扱い） */
export type ElevationSampler = (lng: number, lat: number) => number | undefined | Promise<number | undefined>

/**
 * 視点の高度を、地形標高を加味して altitudeMode='absolute' の値へ直す。
 * - LookAt: clampToGround → 注視点の標高、relativeToGround → 標高 + altitude
 * - Camera: clampToGround / relativeToGround → カメラ位置の標高 + altitude（clamp は地上高扱い）
 * - absolute はそのまま
 * sample が undefined を返す（地形が未取得）場合は標高 0 m とみなす。
 */
export async function resolveAbsoluteView(v: AbstractView, sample: ElevationSampler): Promise<AbstractView> {
  if (v.altitudeMode === 'absolute') return v
  let ground = 0
  try {
    ground = (await sample(v.longitude, v.latitude)) ?? 0
  } catch {
    // 標高が取れなくても視点自体は適用する
  }
  const altitude =
    v.kind === 'LookAt'
      ? v.altitudeMode === 'relativeToGround'
        ? ground + v.altitude
        : ground
      : ground + v.altitude
  return { ...v, altitude, altitudeMode: 'absolute' }
}

export interface CameraPose {
  lng: number
  lat: number
  /** カメラの高度（m） */
  height: number
  /** 北=0 の時計回り（度） */
  heading: number
  /** 水平=0・真下=-90（度）。Navara / Cesium の pitch と同じ向き */
  pitch: number
  roll: number
}

const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LON_EQ = 111_320

/**
 * LookAt をカメラ位置へ換算する。注視点から heading の逆向きに range*sin(tilt) だけ離れ、
 * 高さ range*cos(tilt) の位置から注視点を見る。局所平面近似なので range が数百 km を超えると誤差が出る。
 */
export function lookAtToPose(v: LookAt): CameraPose {
  const tilt = Math.min(Math.max(v.tilt, 0), 90)
  const t = (tilt * Math.PI) / 180
  const h = (v.heading * Math.PI) / 180
  const horizontal = v.range * Math.sin(t)
  const dEast = -horizontal * Math.sin(h)
  const dNorth = -horizontal * Math.cos(h)
  const lat = v.latitude + dNorth / M_PER_DEG_LAT
  const lng = v.longitude + dEast / (M_PER_DEG_LON_EQ * Math.cos((v.latitude * Math.PI) / 180))
  return {
    lng,
    lat,
    height: altitudeOf({ kind: 'LookAt', ...v }) + v.range * Math.cos(t),
    heading: v.heading,
    pitch: tilt - 90,
    roll: 0,
  }
}

export function cameraToPose(v: Camera): CameraPose {
  return {
    lng: v.longitude,
    lat: v.latitude,
    height: altitudeOf({ kind: 'Camera', ...v }),
    heading: v.heading,
    pitch: Math.min(Math.max(v.tilt, 0), 180) - 90,
    roll: v.roll,
  }
}

export function viewToPose(v: AbstractView): CameraPose {
  return v.kind === 'LookAt' ? lookAtToPose(v) : cameraToPose(v)
}

export interface CenterZoomView {
  center: [lng: number, lat: number]
  zoom: number
  bearing: number
  /** 真下=0（KML の tilt と同じ向き） */
  pitch: number
}

/**
 * 3 エンジン共通の縦画角（度）。Navara は 50°、Cesium は標準の横 60°（縦横比 1.289 で縦 48.3°）、MapLibre は 36.87° と
 * 画角がばらばらで、同じカメラ位置でも見える範囲と大きさが一致しなかった（Issue #9）。
 * Navara にそろえ、MapLibre は setVerticalFieldOfView、Cesium は縦横比から横画角を求めて設定する。
 */
export const VERTICAL_FOV_DEG = 50
// tan(fov/2) で、カメラから中心までの距離は画面高さの 0.5 / tan(fov/2) 倍（px）になる（50° で約 1.072）
const ML_CAMERA_TO_CENTER_PX_PER_VIEWPORT_PX = 0.5 / Math.tan((VERTICAL_FOV_DEG * Math.PI) / 360)
// 512px タイルでの zoom 0 の地上解像度（赤道, m/px）
const ML_METERS_PER_PX_Z0 = 78271.517
/** Camera（水平に近い視線）で地面に当たらない/遠すぎるときに使う注視距離の上限（m） */
const MAX_GROUND_DISTANCE_M = 20_000

/**
 * 視点を MapLibre の「中心 + ズーム + 方位 + 傾き」へ換算する。
 * MapLibre の自由カメラ API（elevation 付き）は flyTo / easeTo で最終位置がずれる・
 * DEM 範囲外エラーを起こすため使わない。
 *
 * 視点をカメラ位置（高度は絶対値＝resolveAbsoluteView 済み）へ直し、カメラから視線が
 * 地面（標高 groundElevation の水平面）に当たる点を中心にして、その距離から zoom を決める。
 * 地面標高を実際の値にすると、MapLibre が地形上の中心点として扱うため、注視点が画面中央に来る。
 * ただし tilt が水平に近い（85° 以上）と交点が遠すぎるため、LookAt は注視点・range をそのまま使う。
 * viewportHeightPx は地図の表示高さ（px）。
 */
export function viewToCenterZoom(
  v: AbstractView,
  viewportHeightPx: number,
  maxPitch = 85,
  groundElevation = 0,
): CenterZoomView {
  const pose = viewToPose(v)
  const tilt = Math.min(Math.max(pose.pitch + 90, 0), 90)
  const t = (tilt * Math.PI) / 180
  const h = (pose.heading * Math.PI) / 180

  let lng = pose.lng
  let lat = pose.lat
  let distance: number
  if (v.kind === 'LookAt' && tilt >= 85) {
    lng = v.longitude
    lat = v.latitude
    distance = Math.max(v.range, 1)
  } else {
    const heightAboveGround = Math.max(pose.height - groundElevation, 1)
    // 上限は Camera（視線と地面の交点を推定する）のためのもの。LookAt は range が意図した距離なので
    // 広い範囲（数十 km）を切り詰めないよう、range に応じて上限を広げる
    const cap = v.kind === 'LookAt' ? Math.max(MAX_GROUND_DISTANCE_M, v.range * 3) : MAX_GROUND_DISTANCE_M
    distance = Math.min(heightAboveGround / Math.max(Math.cos(t), 1e-6), cap)
    const horizontal = distance * Math.sin(t)
    lat += (horizontal * Math.cos(h)) / M_PER_DEG_LAT
    lng += (horizontal * Math.sin(h)) / (M_PER_DEG_LON_EQ * Math.cos((pose.lat * Math.PI) / 180))
  }
  const metersPerPx = distance / (ML_CAMERA_TO_CENTER_PX_PER_VIEWPORT_PX * Math.max(viewportHeightPx, 1))
  const zoom = Math.log2((ML_METERS_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / metersPerPx)
  return { center: [lng, lat], zoom: Math.min(Math.max(zoom, 0), 22), bearing: pose.heading, pitch: Math.min(tilt, maxPitch) }
}

// ---- カメラ位置 ⇄ MapLibre の「中心 + ズーム + 方位 + 傾き」（球面で視線と地面の交点を求める版） ----
// 局所平面近似の viewToCenterZoom は KML の視点向け。こちらは地球全体（高度 数千 km）から地上まで同じ式で換算し、
// エンジンを切り替えたときにカメラ位置と画角を一致させるために使う。

const EARTH_R = 6_371_008.8
type V3 = [number, number, number]
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const add = (...vs: V3[]): V3 => vs.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]] as V3, [0, 0, 0] as V3)

/** 経緯度の地点での、東・北・上の単位ベクトル（地心直交座標） */
function enuBasis(lngDeg: number, latDeg: number): { e: V3; n: V3; u: V3 } {
  const lo = rad(lngDeg)
  const la = rad(latDeg)
  return {
    e: [-Math.sin(lo), Math.cos(lo), 0],
    n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    u: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  }
}

function toLngLat(v: V3): [number, number] {
  return [deg(Math.atan2(v[1], v[0])), deg(Math.atan2(v[2], Math.hypot(v[0], v[1])))]
}

/** 地面（標高を返す関数で決まる高さの球面）の標高。引けなければ 0 m */
export type GroundHeight = (lng: number, lat: number) => number

/**
 * カメラから視線を伸ばして地面に当たる点と、そこまでの距離（m）。
 * 地面は半径 EARTH_R + 標高 の球面とし、交点の標高で 1 回やり直す。当たらない（水平より上・地球の外れ）ときは null
 */
export function groundIntersection(
  pose: Pick<CameraPose, 'lng' | 'lat' | 'height' | 'heading' | 'pitch'>,
  groundAt: GroundHeight = () => 0,
): { lng: number; lat: number; distance: number } | null {
  const { e, n, u } = enuBasis(pose.lng, pose.lat)
  const c = scale(u, EARTH_R + pose.height)
  const h = rad(pose.heading)
  const p = rad(pose.pitch)
  const d = add(scale(e, Math.sin(h) * Math.cos(p)), scale(n, Math.cos(h) * Math.cos(p)), scale(u, Math.sin(p)))
  let g = groundAt(pose.lng, pose.lat)
  let hit: { lng: number; lat: number; distance: number } | null = null
  for (let i = 0; i < 2; i++) {
    const rg = EARTH_R + g
    const b = dot(c, d)
    const disc = b * b - (dot(c, c) - rg * rg)
    if (disc < 0) return null
    const t = -b - Math.sqrt(disc)
    if (!(t > 0)) return null
    const [lng, lat] = toLngLat(add(c, scale(d, t)))
    hit = { lng, lat, distance: t }
    g = groundAt(lng, lat)
  }
  return hit
}

/** 水平に近い視線（伏角が浅い）で地面に当たらない/遠すぎるときの注視距離の上限は MAX_GROUND_DISTANCE_M を使う */
const NEAR_HORIZONTAL_PITCH_DEG = -5

/**
 * カメラ位置 → MapLibre の中心・ズーム・方位・傾き。viewportHeightPx は地図の表示高さ（px）。
 * groundAt は地面の楕円体高（地形標高 + ジオイド高）。水平に近い視線は、注視距離を MAX_GROUND_DISTANCE_M として水平に進めた点を中心にする
 */
export function poseToCenterZoom(
  pose: Pick<CameraPose, 'lng' | 'lat' | 'height' | 'heading' | 'pitch'>,
  viewportHeightPx: number,
  groundAt: GroundHeight = () => 0,
  maxPitch = 85,
): CenterZoomView {
  let center: [number, number]
  let distance: number
  const hit = pose.pitch > NEAR_HORIZONTAL_PITCH_DEG ? null : groundIntersection(pose, groundAt)
  if (hit) {
    center = [hit.lng, hit.lat]
    distance = hit.distance
  } else {
    distance = MAX_GROUND_DISTANCE_M
    const horizontal = distance * Math.cos(rad(pose.pitch))
    const h = rad(pose.heading)
    center = [
      pose.lng + (horizontal * Math.sin(h)) / (M_PER_DEG_LON_EQ * Math.cos(rad(pose.lat))),
      pose.lat + (horizontal * Math.cos(h)) / M_PER_DEG_LAT,
    ]
  }
  const metersPerPx = distance / (ML_CAMERA_TO_CENTER_PX_PER_VIEWPORT_PX * Math.max(viewportHeightPx, 1))
  const zoom = Math.log2((ML_METERS_PER_PX_Z0 * Math.cos(rad(center[1]))) / metersPerPx)
  return {
    center,
    zoom: Math.min(Math.max(zoom, 0), 22),
    bearing: pose.heading,
    pitch: Math.min(Math.max(pose.pitch + 90, 0), maxPitch),
  }
}

/**
 * MapLibre の中心・ズーム・方位・傾き → カメラ位置（poseToCenterZoom の逆）。
 * まず局所平面で位置を見積もり、順方向の結果（交点と距離）との差で位置を補正する（数回で収束）
 */
export function centerZoomToPose(
  view: CenterZoomView,
  viewportHeightPx: number,
  groundAt: GroundHeight = () => 0,
): CameraPose {
  const [lng, lat] = view.center
  const metersPerPx = (ML_METERS_PER_PX_Z0 * Math.cos(rad(lat))) / 2 ** view.zoom
  const distance = metersPerPx * ML_CAMERA_TO_CENTER_PX_PER_VIEWPORT_PX * Math.max(viewportHeightPx, 1)
  const tilt = rad(Math.min(Math.max(view.pitch, 0), 90))
  const h = rad(view.bearing)
  const horizontal = distance * Math.sin(tilt)
  const pose: CameraPose = {
    lng: lng - (horizontal * Math.sin(h)) / (M_PER_DEG_LON_EQ * Math.cos(rad(lat))),
    lat: lat - (horizontal * Math.cos(h)) / M_PER_DEG_LAT,
    height: groundAt(lng, lat) + distance * Math.cos(tilt),
    heading: view.bearing,
    pitch: view.pitch - 90,
    roll: 0,
  }
  if (view.pitch >= 90 + NEAR_HORIZONTAL_PITCH_DEG) return pose // 水平に近い視線は地面との交点が定まらない
  for (let i = 0; i < 8; i++) {
    const hit = groundIntersection(pose, groundAt)
    if (!hit) break
    const dLng = lng - hit.lng
    const dLat = lat - hit.lat
    const dDist = distance - hit.distance
    if (Math.abs(dLng) < 1e-10 && Math.abs(dLat) < 1e-10 && Math.abs(dDist) < 1e-3) break
    pose.lng += dLng
    pose.lat += dLat
    pose.height += -dDist * Math.sin(rad(pose.pitch))
  }
  return pose
}
