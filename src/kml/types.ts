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

export interface Style {
  id?: string
  icon?: { href?: string; scale?: number; color?: KmlColor }
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

interface FeatureBase {
  id?: string
  name?: string
  description?: string
  visibility: boolean
  open: boolean
  styleUrl?: string
  style?: Style
  view?: AbstractView
}
export interface Placemark extends FeatureBase {
  kind: 'Placemark'
  geometry?: Geometry
}
export interface Folder extends FeatureBase {
  kind: 'Folder' | 'Document'
  children: Feature[]
}
export type Feature = Placemark | Folder

export interface KmlDocument {
  root: Folder
  /** id（# 無し）→ Style */
  styles: Record<string, Style>
  styleMaps: Record<string, StyleMap>
  /** パース時の警告（未対応要素・不正な座標など）。黙って捨てないために残す */
  warnings: string[]
}
