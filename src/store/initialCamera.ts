// 3 エンジン共通の初期カメラ（日本の上空）。経緯度は WGS84（EPSG:4326）。
// 日本列島（北海道〜九州）が収まる範囲を、真下（北が上）から見る。エンジンごとに高度とズームの尺度が違うため、
// 見え方を揃えた値をここにまとめる（高度は楕円体高）
export const INITIAL_LNG = 137
export const INITIAL_LAT = 37
/** MapLibre のズーム（グローブ投影） */
export const INITIAL_ZOOM_2D = 4.2
/** Navara / Cesium のカメラ高度（m） */
export const INITIAL_HEIGHT_3D = 3_800_000
