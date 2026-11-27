// エンジン非依存の KML 文書モデル（OGC KML 2.3 の Phase 1 範囲）。
// 座標は [経度, 緯度, 標高(m)]（WGS84 / EPSG:4326）。

export type Coord = [lon: number, lat: number, alt: number]

export type AltitudeMode = 'clampToGround' | 'relativeToGround' | 'absolute'

export interface PointGeom {
  type: 'Point'
  coordinates: Coord
  altitudeMode: AltitudeMode
  extrude: boolean
}
export interface LineStringGeom {
  type: 'LineString'
  coordinates: Coord[]
  altitudeMode: AltitudeMode
  extrude: boolean
  tessellate: boolean
}
export interface PolygonGeom {
  type: 'Polygon'
  outer: Coord[]
  inner: Coord[][]
  altitudeMode: AltitudeMode
  extrude: boolean
  tessellate: boolean
}
export interface MultiGeometryGeom {
  type: 'MultiGeometry'
  geometries: Geometry[]
}
export type Geometry = PointGeom | LineStringGeom | PolygonGeom | MultiGeometryGeom

/** 色は CSS の #rrggbb と不透明度 0..1 に分けて持つ（KML の aabbggrr から変換済み） */
export interface KmlColor {
  hex: string
  opacity: number
}

/** IconStyle の hotSpot（アイコンのうち座標に合わせる点）。units は KML の fraction / pixels / insetPixels */
export type HotSpotUnits = 'fraction' | 'pixels' | 'insetPixels'
export interface HotSpot {
  x: number
  y: number
  xunits: HotSpotUnits
  yunits: HotSpotUnits
}

export interface Style {
  id?: string
  icon?: { href?: string; scale?: number; color?: KmlColor; hotSpot?: HotSpot }
  label?: { scale?: number; color?: KmlColor }
  line?: { color?: KmlColor; width?: number }
  poly?: { color?: KmlColor; fill?: boolean; outline?: boolean }
  balloon?: { text?: string }
  list?: { listItemType?: string }
}

export interface StyleMap {
  id: string
  /** key は 'normal' | 'highlight'。値は styleUrl（#id）またはインライン Style */
  pairs: Record<string, string | Style>
}

export interface LookAt {
  longitude: number
  latitude: number
  altitude: number
  heading: number
  tilt: number
  range: number
  altitudeMode: AltitudeMode
}
export interface Camera {
  longitude: number
  latitude: number
  altitude: number
  heading: number
  tilt: number
  roll: number
  altitudeMode: AltitudeMode
}
export type AbstractView = ({ kind: 'LookAt' } & LookAt) | ({ kind: 'Camera' } & Camera)

/** Region の範囲（度）。minAltitude / maxAltitude は m */
export interface LatLonAltBox {
  north: number
  south: number
  east: number
  west: number
  minAltitude?: number
  maxAltitude?: number
  altitudeMode: AltitudeMode
}
/** Lod: 領域が画面上で占める大きさ（px）に応じた表示範囲。maxLodPixels = -1 は上限なし */
export interface Lod {
  minLodPixels: number
  maxLodPixels: number
  minFadeExtent: number
  maxFadeExtent: number
}
export interface Region {
  box: LatLonAltBox
  lod?: Lod
}

export type RefreshMode = 'onChange' | 'onInterval' | 'onExpire'
export type ViewRefreshMode = 'never' | 'onStop' | 'onRequest' | 'onRegion'
/**
 * NetworkLink の Link（旧形式の Url も読む）。省略された値は undefined のまま持ち（保存で値を足さないため）、
 * 既定値（refreshMode=onChange, refreshInterval=4, viewRefreshMode=never, viewRefreshTime=4, viewBoundScale=1）は使う側で補う
 */
export interface Link {
  href?: string
  refreshMode?: RefreshMode
  refreshInterval?: number
  viewRefreshMode?: ViewRefreshMode
  viewRefreshTime?: number
  viewBoundScale?: number
  viewFormat?: string
  httpQuery?: string
}

interface FeatureBase {
  id?: string
  name?: string
  description?: string
  visibility: boolean
  open: boolean
  styleUrl?: string
  style?: Style
  view?: AbstractView
  region?: Region
}
export interface Placemark extends FeatureBase {
  kind: 'Placemark'
  geometry?: Geometry
}
export interface Folder extends FeatureBase {
  kind: 'Folder' | 'Document'
  children: Feature[]
}
/** 別の KML 資源への参照。取得した内容は文書モデルには入れない（kmlStore の派生エントリが持つ） */
export interface NetworkLink extends FeatureBase {
  kind: 'NetworkLink'
  link?: Link
  refreshVisibility: boolean
  flyToView: boolean
}
export type Feature = Placemark | Folder | NetworkLink

/** 子を持つ（Document / Folder）なら子の一覧、それ以外（Placemark / NetworkLink）は空 */
export function childrenOf(f: Feature): Feature[] {
  return f.kind === 'Placemark' || f.kind === 'NetworkLink' ? [] : f.children
}

export interface KmlDocument {
  root: Folder
  /** id（# 無し）→ Style */
  styles: Record<string, Style>
  styleMaps: Record<string, StyleMap>
  /** パース時の警告（未対応要素・不正な座標など）。黙って捨てないために残す */
  warnings: string[]
}
