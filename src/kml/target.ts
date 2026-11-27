import { findInitialView, VERTICAL_FOV_DEG } from './camera'
import { childrenOf, type AbstractView, type Coord, type Feature, type Geometry, type KmlDocument, type LookAt, type Placemark } from './types'

/** [west, south, east, north]（度）。日付変更線をまたぐ範囲は扱わない */
export type Bounds = [west: number, south: number, east: number, north: number]

/** フィーチャ木の位置（根からの子インデックス列）。根自身は空配列 */
export type FeaturePath = number[]

export function featureAtPath(doc: KmlDocument, path: FeaturePath): Feature | undefined {
  let f: Feature = doc.root
  for (const i of path) {
    const next: Feature | undefined = childrenOf(f)[i]
    if (!next) return undefined
    f = next
  }
  return f
}

function geometryCoords(g: Geometry, out: Coord[]): void {
  switch (g.type) {
    case 'Point':
      out.push(g.coordinates)
      break
    case 'LineString':
      out.push(...g.coordinates)
      break
    case 'Polygon':
      out.push(...g.outer) // 内側の輪は外側の内に収まる
      break
    case 'MultiGeometry':
      g.geometries.forEach((c) => geometryCoords(c, out))
  }
}

/** フィーチャ（フォルダなら配下すべて）のジオメトリの範囲。ジオメトリが無ければ undefined */
export function featureBounds(f: Feature): Bounds | undefined {
  const coords: Coord[] = []
  const walk = (x: Feature) => {
    if (x.kind === 'Placemark') {
      if (x.geometry) geometryCoords(x.geometry, coords)
    } else childrenOf(x).forEach(walk)
  }
  walk(f)
  if (!coords.length) {
    // ジオメトリが無いもの（取得前の NetworkLink など）は、Region の範囲があればそれを範囲とする
    const b = f.region?.box
    return b ? [b.west, b.south, b.east, b.north] : undefined
  }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [lon, lat] of coords) {
    w = Math.min(w, lon)
    e = Math.max(e, lon)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  return [w, s, e, n]
}

const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LON_EQ = 111_320
/** 範囲が点（広がりなし）のときの注視距離（m） */
const POINT_RANGE_M = 800
const MIN_RANGE_M = 300
/** 縦画角 50° のとき、距離 R で画面の縦に収まる長さは 2R·tan(25°) ≈ 0.933R */
const VISIBLE_HEIGHT_PER_RANGE = 2 * Math.tan((VERTICAL_FOV_DEG * Math.PI) / 360)
/** 範囲に足す余白（30%。点のアイコン・ラベルが端で切れないように）と、表示領域のアスペクト比（幅/高さ）が分からないときの想定値 */
const FIT_MARGIN = 1.3
const DEFAULT_ASPECT = 1.6

/**
 * 範囲が画面に収まる真上からの LookAt を作る（地面は標高 0 m 扱い。標高は適用側が
 * resolveAbsoluteView で反映する）。点（広がりなし）は固定の距離にする。
 * aspect は表示領域の幅/高さ。サイドバーなどで実際の比率は端末ごとに違うため、
 * 呼び出し側（各エンジン）がコンテナの寸法から渡す。
 */
export function lookAtFromBounds(b: Bounds, aspect = DEFAULT_ASPECT): LookAt {
  const [w, s, e, n] = b
  const lat = (s + n) / 2
  const dy = (n - s) * M_PER_DEG_LAT
  const dx = (e - w) * M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180)
  const extent = Math.max(dy, dx / Math.max(aspect, 0.1))
  const range =
    extent <= 0 ? POINT_RANGE_M : Math.max((extent * FIT_MARGIN) / VISIBLE_HEIGHT_PER_RANGE, MIN_RANGE_M)
  return {
    longitude: (w + e) / 2,
    latitude: lat,
    altitude: 0,
    heading: 0,
    tilt: 0,
    range: Math.min(range, 2e7),
    altitudeMode: 'clampToGround',
  }
}

/**
 * 飛行先の視点を決める。
 * - path 無し（文書全体）: 文書内で最初に見つかる LookAt/Camera、無ければ全体の範囲
 * - path あり（フォルダ/Placemark）: そのフィーチャ自身の視点、無ければ配下の範囲
 * 視点も範囲も無い（ジオメトリの無い文書など）場合は undefined。aspect は範囲から作る LookAt 用
 */
export function resolveFlyView(doc: KmlDocument, path?: FeaturePath, aspect?: number): AbstractView | undefined {
  if (!path) {
    const v = findInitialView(doc)
    if (v) return v
    const b = featureBounds(doc.root)
    return b && { kind: 'LookAt', ...lookAtFromBounds(b, aspect) }
  }
  const f = featureAtPath(doc, path)
  if (!f) return undefined
  if (f.view) return f.view
  const b = featureBounds(f)
  return b && { kind: 'LookAt', ...lookAtFromBounds(b, aspect) }
}

/** 'kmlPath'（'0/2/1' 形式）を FeaturePath へ。不正なら undefined */
export function parseFeaturePath(s: unknown): FeaturePath | undefined {
  if (typeof s !== 'string') return undefined
  if (s === '') return []
  const p = s.split('/').map(Number)
  return p.every((n) => Number.isInteger(n) && n >= 0) ? p : undefined
}

/** Placemark の最初の座標（経度, 緯度）。ジオメトリが無ければ undefined */
function firstLonLat(g: NonNullable<Placemark['geometry']>): [number, number] | undefined {
  switch (g.type) {
    case 'Point': return [g.coordinates[0], g.coordinates[1]]
    case 'LineString': return g.coordinates[0] && [g.coordinates[0][0], g.coordinates[0][1]]
    case 'Polygon': return g.outer[0] && [g.outer[0][0], g.outer[0][1]]
    case 'MultiGeometry': for (const x of g.geometries) { const c = firstLonLat(x); if (c) return c }
  }
}

/**
 * 名前と位置から Placemark を探す索引を作る（Cesium の KmlDataSource のエンティティから文書モデルへ戻す用）。
 * 名前ごとに候補を持つので、エンティティが多くても 1 件あたりは同名の Placemark の数だけで済む。
 * 返す関数は、最初の座標が (lon, lat) に最も近い候補を選ぶ。名前が一致するものだけが候補。許容は約 1 m
 */
export function placemarkLocator(doc: KmlDocument): (name: string, lon: number, lat: number) => FeaturePath | undefined {
  const byName = new Map<string, { path: FeaturePath; c: [number, number] }[]>()
  const walk = (f: Feature, path: FeaturePath) => {
    if (f.kind === 'Placemark') {
      const c = f.geometry && firstLonLat(f.geometry)
      if (!c) return
      const key = f.name ?? ''
      const list = byName.get(key)
      if (list) list.push({ path, c })
      else byName.set(key, [{ path, c }])
    } else childrenOf(f).forEach((x, i) => walk(x, [...path, i]))
  }
  walk(doc.root, [])
  return (name, lon, lat) => {
    let best: { path: FeaturePath; d: number } | undefined
    for (const { path, c } of byName.get(name) ?? []) {
      const d = Math.hypot(c[0] - lon, c[1] - lat)
      if (!best || d < best.d) best = { path, d }
    }
    return best && best.d < 1e-4 ? best.path : undefined
  }
}

/** 名前と位置から Placemark を探す（1 件だけ引く用。多数を引くなら placemarkLocator） */
export function findPlacemarkPath(doc: KmlDocument, name: string, lon: number, lat: number): FeaturePath | undefined {
  return placemarkLocator(doc)(name, lon, lat)
}

/** path のフィーチャ（フォルダなら配下すべて）に含まれる、ジオメトリを持つ Placemark の kmlPath 一覧（強調表示用） */
export function placemarkKeys(doc: KmlDocument, path: FeaturePath): string[] {
  const f = featureAtPath(doc, path)
  const out: string[] = []
  const walk = (x: Feature, p: FeaturePath) => {
    if (x.kind === 'Placemark') {
      if (x.geometry) out.push(p.join('/'))
    } else childrenOf(x).forEach((c, i) => walk(c, [...p, i]))
  }
  if (f) walk(f, path)
  return out
}
