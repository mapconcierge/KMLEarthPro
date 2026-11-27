// 3 エンジン共通の初期カメラ。経緯度は WGS84（EPSG:4326）。
// 地球全体が収まる縮尺で、中心を日本にして真下（北が上）から見る。エンジンごとに高度とズームの尺度が違うため、
// 見え方を揃えた値をここにまとめる（高度は楕円体高）
export const INITIAL_LNG = 137
export const INITIAL_LAT = 37
/** MapLibre のズーム（グローブ投影） */
export const INITIAL_ZOOM_2D = 1.7
/** Navara / Cesium のカメラ高度（m） */
export const INITIAL_HEIGHT_3D = 17_000_000
