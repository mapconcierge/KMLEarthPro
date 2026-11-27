import type { CameraPose } from '../kml/camera'

// 3 エンジン共通の初期カメラ。経緯度は WGS84（EPSG:4326）。
// 地球全体が収まる縮尺で、中心を日本にして真下（北が上）から見る。エンジンごとに高度とズームの尺度が違うため、
// 共通のカメラ位置（楕円体高）で持ち、MapLibre は kml/camera.ts の poseToCenterZoom でズームへ換算する
export const INITIAL_LNG = 137
export const INITIAL_LAT = 37
/** Navara / Cesium のカメラ高度（m） */
export const INITIAL_HEIGHT_3D = 17_000_000

export const INITIAL_POSE: CameraPose = {
  lng: INITIAL_LNG,
  lat: INITIAL_LAT,
  height: INITIAL_HEIGHT_3D,
  heading: 0,
  pitch: -90,
  roll: 0,
}
