import type { AbstractView, Camera, Feature, KmlDocument, LookAt } from './types'

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
    if (f.kind !== 'Placemark') {
      for (const c of f.children) {
        const v = walk(c)
        if (v) return v
      }
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

// MapLibre の縦画角は約 36.87°（0.6435 rad）。tan(fov/2) = 1/3 なので、
// カメラから中心までの距離は画面高さの 1.5 倍（px）になる
const ML_CAMERA_TO_CENTER_PX_PER_VIEWPORT_PX = 1.5
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
