import type { Coord, Feature, Geometry, KmlDocument } from './types'

/**
 * 高度モード（altitudeMode）を、3D エンジン（Navara / CesiumJS）が描ける「楕円体高」へ直す。
 *
 * KML の高度は次のとおりで、どちらも楕円体高ではない:
 * - absolute: 海抜（ジオイド基準）。楕円体高 = 高度 + ジオイド高 N（日本で約 +37 m）
 * - relativeToGround: 地表からの高さ。楕円体高 = 高度 + 地表の楕円体高（地形 DEM は楕円体高）
 * - clampToGround: 高度は無視して地表に貼る（ここでは触らない）
 * CesiumJS の KmlDataSource は absolute / relativeToGround の高度をそのまま楕円体高として描く
 * （Point の relativeToGround だけは地形に追従する）ので、そのままだと地表の標高・ジオイド高ぶんずれる。
 *
 * 引けない値（ジオイド高・標高）は 0 m 扱い。個数が多すぎるときは標高を引かない（MAX_TERRAIN_POINTS）。
 * gx:altitudeMode の clampToSeaFloor / relativeToSeaFloor は対象外（パース時に clampToGround 扱い）。
 */

export interface HeightSources {
  /** その地点のジオイド高 N（m）。引けなければ undefined */
  geoid: (lng: number, lat: number) => Promise<number | undefined>
  /** 各地点の地表の楕円体高（m）。引けない点は undefined */
  terrain: (points: { lng: number; lat: number }[]) => Promise<(number | undefined)[]>
}

/** 標高を引く頂点数の上限。これを超える文書は、relativeToGround / extrude の標高を 0 m 扱いにする */
export const MAX_TERRAIN_POINTS = 5000
const CHUNK = 500

type Mode = 'clampToGround' | 'relativeToGround' | 'absolute'

/** 頂点の座標を、そのまま比較に使えるキーへ（標高の取得を重複させない） */
const key = (c: { lng: number; lat: number }) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`

/**
 * 高度の解決に標高が要る頂点の標高を、まとめて引く。重複は 1 回にし、上限を超えるときは何も引かない。
 * 戻りは「経緯度キー → 楕円体高」。引けない点は入らない
 */
async function sampleTerrain(points: { lng: number; lat: number }[], src: HeightSources): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const unique = [...new Map(points.map((p) => [key(p), p])).values()]
  if (unique.length === 0 || unique.length > MAX_TERRAIN_POINTS) return out
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const heights = await src.terrain(chunk).catch(() => [] as (number | undefined)[])
    chunk.forEach((p, j) => {
      const h = heights[j]
      if (typeof h === 'number' && Number.isFinite(h)) out.set(key(p), h)
    })
  }
  return out
}

/** 1 つのジオメトリの頂点（経緯度と高度）と、解決に必要なもの */
export interface Run {
  mode: Mode
  extrude: boolean
  coords: { lng: number; lat: number; alt: number }[]
}

/**
 * 頂点列の楕円体高と、extrude のときの地表の楕円体高（無ければ undefined）を返す。
 * terrain は sampleTerrain の結果、geoid は absolute のときのジオイド高
 */
export function heightsOf(
  run: Run,
  terrain: Map<string, number>,
  geoid: number,
): { z: number[]; ground?: number[] } {
  const ground = (c: { lng: number; lat: number }) => terrain.get(key(c)) ?? 0
  const z = run.coords.map((c) => (run.mode === 'absolute' ? c.alt + geoid : c.alt + ground(c)))
  return run.extrude ? { z, ground: run.coords.map(ground) } : { z }
}

/** 標高の要る頂点（relativeToGround の全頂点と、extrude の全頂点）を集める */
function terrainPointsOf(runs: Run[]): { lng: number; lat: number }[] {
  const pts: { lng: number; lat: number }[] = []
  for (const r of runs) if (r.mode === 'relativeToGround' || r.extrude) pts.push(...r.coords)
  return pts
}

/** 文書中の、高度を解決する対象のジオメトリ（MultiGeometry は展開済み。clampToGround は含めない） */
export function elevatedGeometries(doc: KmlDocument): Geometry[] {
  const out: Geometry[] = []
  const add = (g: Geometry) => {
    if (g.type === 'MultiGeometry') g.geometries.forEach(add)
    else if (g.altitudeMode !== 'clampToGround') out.push(g)
  }
  const walk = (f: Feature) => {
    if (f.kind === 'Placemark') {
      if (f.geometry) add(f.geometry)
    } else if (f.kind === 'Folder' || f.kind === 'Document') f.children.forEach(walk)
  }
  walk(doc.root)
  return out
}

/** 描画用に高さを解決したジオメトリの印（ground は extrude のときの地表の楕円体高） */
export interface ResolvedExtra {
  /** true なら、座標の高度は楕円体高へ直してある（altitudeMode は 'absolute' に統一） */
  resolved: true
  /** extrude のとき、各頂点の地表の楕円体高（outer・inner の順に並べた 1 次元配列） */
  ground?: number[]
}

/**
 * 文書の複製を返す。clampToGround 以外のジオメトリの高度を楕円体高へ直し、altitudeMode を 'absolute' にする。
 * 複製の対象は文書モデル全体（元の文書は変えない）。描画専用で、保存には使わない。
 */
export async function resolveAltitudes(doc: KmlDocument, src: HeightSources): Promise<KmlDocument> {
  const copy = structuredClone(doc)
  const geoms = elevatedGeometries(copy)
  if (geoms.length === 0) return copy

  const runOf = (g: Geometry): Run => {
    const flat = (cs: Coord[]) => cs.map(([lng, lat, alt]) => ({ lng, lat, alt }))
    if (g.type === 'Point') return { mode: g.altitudeMode, extrude: g.extrude, coords: flat([g.coordinates]) }
    if (g.type === 'LineString') return { mode: g.altitudeMode, extrude: g.extrude, coords: flat(g.coordinates) }
    if (g.type === 'Polygon') return { mode: g.altitudeMode, extrude: g.extrude, coords: flat([...g.outer, ...g.inner.flat()]) }
    throw new Error('MultiGeometry は展開済みのはず')
  }
  const runs = geoms.map(runOf)
  const terrain = await sampleTerrain(terrainPointsOf(runs), src)

  for (let i = 0; i < geoms.length; i++) {
    const g = geoms[i]
    const run = runs[i]
    const first = run.coords[0]
    const n = run.mode === 'absolute' && first ? ((await src.geoid(first.lng, first.lat).catch(() => undefined)) ?? 0) : 0
    const { z, ground } = heightsOf(run, terrain, n)
    let k = 0
    const apply = (cs: Coord[]) => cs.forEach((c) => (c[2] = z[k++]))
    if (g.type === 'Point') apply([g.coordinates])
    else if (g.type === 'LineString') apply(g.coordinates)
    else if (g.type === 'Polygon') {
      apply(g.outer)
      g.inner.forEach(apply)
    }
    const extra = g as Geometry & Partial<ResolvedExtra>
    extra.resolved = true
    extra.ground = ground
    ;(g as { altitudeMode: Mode }).altitudeMode = 'absolute'
  }
  return copy
}

// ---- CesiumJS 向け: KML の DOM に直接書く（KmlDataSource に渡す前） ----

const ns = (el: Element, name: string) => Array.from(el.children).find((e) => e.localName === name)

/** 座標文字列を、タプルの数を保ったまま分解する（不正なタプルは null） */
function parseTuples(text: string): ({ lng: number; lat: number; alt: number } | null)[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const [lng, lat, alt] = t.split(',').map(Number)
      return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat, alt: Number.isFinite(alt) ? alt : 0 } : null
    })
}

/** Placemark のジオメトリ要素（Point / LineString / Polygon）のうち、clampToGround でないもの */
function elevatedElements(root: Document): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => {
    if (!['Point', 'LineString', 'Polygon'].includes(e.localName)) return false
    const mode = ns(e, 'altitudeMode')?.textContent?.trim()
    return mode === 'relativeToGround' || mode === 'absolute'
  })
}

/** KML 文字列に、clampToGround 以外のジオメトリがあるか */
export function hasElevatedGeometry(kml: string): boolean {
  const doc = new DOMParser().parseFromString(kml, 'application/xml')
  return !doc.getElementsByTagName('parsererror').length && elevatedElements(doc).length > 0
}

/**
 * KML 文字列の clampToGround 以外のジオメトリの高度を楕円体高へ直し、altitudeMode を absolute にして返す。
 * 該当が無い・パースできないときは null。extrude / tessellate はそのまま残す（Cesium が処理する）
 */
export async function resolveKmlAltitudes(kml: string, src: HeightSources): Promise<string | null> {
  const doc = new DOMParser().parseFromString(kml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  const els = elevatedElements(doc)
  if (els.length === 0) return null

  const units = els.map((el) => {
    const mode = ns(el, 'altitudeMode')!.textContent!.trim() as Mode
    const extrude = ['1', 'true'].includes(ns(el, 'extrude')?.textContent?.trim().toLowerCase() ?? '')
    // Polygon の座標は LinearRing 配下。それ以外は直下
    const coordEls = Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === 'coordinates')
    const tuples = coordEls.map((c) => parseTuples(c.textContent ?? ''))
    return { el, mode, extrude, coordEls, tuples }
  })
  const flat = (u: (typeof units)[number]) => u.tuples.flat().filter((t): t is NonNullable<typeof t> => t !== null)
  const terrain = await sampleTerrain(
    terrainPointsOf(units.map((u) => ({ mode: u.mode, extrude: false, coords: flat(u) }))),
    src,
  )

  for (const u of units) {
    const coords = flat(u)
    const first = coords[0]
    const n = u.mode === 'absolute' && first ? ((await src.geoid(first.lng, first.lat).catch(() => undefined)) ?? 0) : 0
    const { z } = heightsOf({ mode: u.mode, extrude: false, coords }, terrain, n)
    let k = 0
    u.coordEls.forEach((ce, i) => {
      ce.textContent = u.tuples[i]
        .map((t) => (t ? `${t.lng},${t.lat},${z[k++]}` : ''))
        .filter(Boolean)
        .join(' ')
    })
    // gx:altitudeMode（海底系）が併記されていたら外し、kml:altitudeMode を absolute にする
    for (const m of Array.from(u.el.children).filter((e) => e.localName === 'altitudeMode')) {
      if (m.namespaceURI === 'http://www.google.com/kml/ext/2.2') u.el.removeChild(m)
      else m.textContent = 'absolute'
    }
  }
  return new XMLSerializer().serializeToString(doc)
}
