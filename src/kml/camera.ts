import type { AbstractView, Camera, Feature, KmlDocument, LookAt } from './types'

/**
 * KML の視点（LookAt / Camera）を各エンジンへ渡すための共通処理。
 *
 * KML の角度: heading は北=0 の時計回り、tilt は 0=真下・90=水平（Camera は最大 180）。
 * 各エンジンの pitch は水平=0・真下=-90 なので、pitch = tilt - 90 に直す。
 *
 * 制限: 地形標高は考慮しない。altitudeMode が clampToGround / relativeToGround の場合も
 * 標高 0 m を地面とみなす（absolute は楕円体高として扱い、ジオイド補正はしない）。
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

/** 視点が指す対象点（LookAt の注視点 / Camera の位置）の高度。clampToGround は 0 とみなす */
function altitudeOf(v: { altitude: number; altitudeMode: string }): number {
  return v.altitudeMode === 'clampToGround' ? 0 : v.altitude
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
    height: altitudeOf(v) + v.range * Math.cos(t),
    heading: v.heading,
    pitch: tilt - 90,
    roll: 0,
  }
}

export function cameraToPose(v: Camera): CameraPose {
  return {
    lng: v.longitude,
    lat: v.latitude,
    height: altitudeOf(v),
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
 * - LookAt: 注視点を中心にし、range から zoom を決める
 * - Camera: 視線が標高 0 m の地面に当たる点を中心にし、その距離から zoom を決める
 * viewportHeightPx は地図の表示高さ（px）。地形標高は考慮しない。
 */
export function viewToCenterZoom(v: AbstractView, viewportHeightPx: number, maxPitch = 85): CenterZoomView {
  let lng: number, lat: number, distance: number, tilt: number
  if (v.kind === 'LookAt') {
    lng = v.longitude
    lat = v.latitude
    distance = Math.max(v.range, 1)
    tilt = Math.min(Math.max(v.tilt, 0), 90)
  } else {
    tilt = Math.min(Math.max(v.tilt, 0), 90)
    const alt = Math.max(altitudeOf(v), 1)
    distance = Math.min(alt / Math.max(Math.cos((tilt * Math.PI) / 180), 1e-6), MAX_GROUND_DISTANCE_M)
    const horizontal = distance * Math.sin((tilt * Math.PI) / 180)
    const h = (v.heading * Math.PI) / 180
    lat = v.latitude + (horizontal * Math.cos(h)) / M_PER_DEG_LAT
    lng = v.longitude + (horizontal * Math.sin(h)) / (M_PER_DEG_LON_EQ * Math.cos((v.latitude * Math.PI) / 180))
  }
  const metersPerPx = distance / (ML_CAMERA_TO_CENTER_PX_PER_VIEWPORT_PX * Math.max(viewportHeightPx, 1))
  const zoom = Math.log2((ML_METERS_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / metersPerPx)
  return { center: [lng, lat], zoom: Math.min(Math.max(zoom, 0), 22), bearing: v.heading, pitch: Math.min(tilt, maxPitch) }
}
