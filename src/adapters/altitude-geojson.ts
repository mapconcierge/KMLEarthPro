import type { Feature as GjFeature, Position } from 'geojson'
import type { Coord, Geometry } from '../kml/types'
import type { ResolvedExtra } from '../kml/altitude'

/** 壁（LineString の extrude）や点の落とし線を、細い角柱で近似するときの幅（m） */
const WALL_WIDTH_M = 2
/** 線の高さを区間ごとの水平な線で近似するときの、高さの刻み（m）と、1 区間あたりの分割数の上限 */
const LINE_HEIGHT_STEP_M = 5
const MAX_PIECES_PER_SEGMENT = 50
const M_PER_DEG_LAT = 111_320

type Resolved = Geometry & Partial<ResolvedExtra>

/** resolveAltitudes で高さを解決済み（楕円体高。clampToGround 以外）のジオメトリか */
export const isResolved = (g: Geometry): g is Resolved & Exclude<Geometry, { type: 'MultiGeometry' }> =>
  g.type !== 'MultiGeometry' && (g as Resolved).resolved === true

const pos = (c: Coord): Position => [c[0], c[1], c[2]]

/** 点 (lng,lat) を中心とする、一辺 size m の正方形の外周 */
function square(lng: number, lat: number, size: number): Position[] {
  const dLat = size / 2 / M_PER_DEG_LAT
  const dLng = size / 2 / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ]
}

/**
 * 頂点列を、高さが一定の線の並びに直す。Navara の線は 1 本ごとに高さが 1 つ（頂点ごとの高さを持てない）なので、
 * 区間を高さの変化が LINE_HEIGHT_STEP_M 以下になるまで分割し、高さを刻みに丸めて、同じ高さが続く部分をつなぐ
 */
export function levelRuns(coords: Coord[]): { height: number; positions: Position[] }[] {
  const runs: { height: number; positions: Position[] }[] = []
  const push = (a: Position, b: Position, h: number) => {
    const last = runs.at(-1)
    if (last && last.height === h) last.positions.push(b)
    else runs.push({ height: h, positions: [a, b] })
  }
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i]
    const b = coords[i + 1]
    const k = Math.min(Math.max(Math.ceil(Math.abs(b[2] - a[2]) / LINE_HEIGHT_STEP_M), 1), MAX_PIECES_PER_SEGMENT)
    for (let j = 0; j < k; j++) {
      const t0 = j / k
      const t1 = (j + 1) / k
      const at = (t: number): Position => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const mid = a[2] + (b[2] - a[2]) * ((t0 + t1) / 2)
      push(at(t0), at(t1), Math.round(mid / LINE_HEIGHT_STEP_M) * LINE_HEIGHT_STEP_M)
    }
  }
  return runs
}

/**
 * 高さ解決済みのジオメトリを、Navara 用のフィーチャへ。座標の Z は楕円体高で、properties に次を足す:
 * - elevated: true（地表に貼らない）
 * - prism: true のとき baseHeight / topHeight（楕円体高）を持つ。polygon を角柱として描く（extrude）
 * extrude の表現:
 * - Point: 地表から点までの細い柱（幅 2 m の角柱）を足す。Navara の線は垂直にできないため
 * - LineString: 線は高さが一定の部分ごとに分ける（lineHeight。levelRuns 参照）。extrude は、各区間を幅 2 m の細い角柱
 *   （壁の近似。上端は区間の高い側で水平）にする
 * - Polygon: 平らな上面（高さは頂点の最大）の角柱にする
 */
export function elevatedFeatures(g: Resolved & Exclude<Geometry, { type: 'MultiGeometry' }>, props: object): GjFeature[] {
  const base = { ...props, elevated: true }
  const feat = (geometry: GjFeature['geometry'], extra: object = {}): GjFeature => ({ type: 'Feature', geometry, properties: { ...base, ...extra } })
  const ground = g.ground

  if (g.type === 'Point') {
    const out = [feat({ type: 'Point', coordinates: pos(g.coordinates) })]
    if (g.extrude && ground) {
      out.push(
        feat(
          { type: 'Polygon', coordinates: [square(g.coordinates[0], g.coordinates[1], WALL_WIDTH_M)] },
          { name: '', iconHref: '', prism: true, baseHeight: ground[0], topHeight: g.coordinates[2] },
        ),
      )
    }
    return out
  }

  if (g.type === 'LineString') {
    const out = levelRuns(g.coordinates).map((r) => feat({ type: 'LineString', coordinates: r.positions }, { lineHeight: r.height }))
    if (g.extrude && ground) {
      for (let i = 0; i + 1 < g.coordinates.length; i++) {
        const a = g.coordinates[i]
        const b = g.coordinates[i + 1]
        const cosLat = Math.cos((a[1] * Math.PI) / 180)
        // 区間に直交する向きへ、幅の半分ずつ
        const dx = (b[0] - a[0]) * cosLat * M_PER_DEG_LAT
        const dy = (b[1] - a[1]) * M_PER_DEG_LAT
        const len = Math.hypot(dx, dy)
        if (len === 0) continue
        const nx = ((-dy / len) * (WALL_WIDTH_M / 2)) / (M_PER_DEG_LAT * cosLat)
        const ny = ((dx / len) * (WALL_WIDTH_M / 2)) / M_PER_DEG_LAT
        const ring: Position[] = [
          [a[0] + nx, a[1] + ny],
          [b[0] + nx, b[1] + ny],
          [b[0] - nx, b[1] - ny],
          [a[0] - nx, a[1] - ny],
          [a[0] + nx, a[1] + ny],
        ]
        out.push(
          feat(
            { type: 'Polygon', coordinates: [ring] },
            { name: '', prism: true, baseHeight: Math.min(ground[i], ground[i + 1]), topHeight: Math.max(a[2], b[2]) },
          ),
        )
      }
    }
    return out
  }

  // Polygon
  const rings = [g.outer, ...g.inner]
  if (g.extrude && ground) {
    const all = rings.flat()
    return [
      feat(
        { type: 'Polygon', coordinates: rings.map((r) => r.map((c) => [c[0], c[1]])) },
        { prism: true, baseHeight: Math.min(...ground), topHeight: Math.max(...all.map((c) => c[2])) },
      ),
    ]
  }
  return [feat({ type: 'Polygon', coordinates: rings.map((r) => r.map(pos)) })]
}
