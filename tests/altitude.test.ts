// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { elevatedGeometries, hasElevatedGeometry, MAX_TERRAIN_POINTS, resolveAltitudes, resolveKmlAltitudes, type HeightSources } from '../src/kml/altitude'
import { parseKml } from '../src/kml/parse'
import type { Geometry, KmlDocument, Placemark } from '../src/kml/types'

const N = 36 // ジオイド高（試験用）
const GROUND = 40 // 地表の楕円体高（試験用）
const src = (over: Partial<HeightSources> = {}): HeightSources => ({
  geoid: async () => N,
  terrain: async (pts) => pts.map(() => GROUND),
  ...over,
})

const kml = (geom: string) => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark>${geom}</Placemark></Document></kml>`
const geomOf = (doc: KmlDocument): Geometry => (doc.root.children[0] as Placemark).geometry!

describe('高度モードの解決（resolveAltitudes）', () => {
  it('absolute はジオイド高を足し、relativeToGround は地表の楕円体高を足す。clampToGround は触らない', async () => {
    const abs = parseKml(kml('<Point><altitudeMode>absolute</altitudeMode><coordinates>139,35,100</coordinates></Point>'))
    const rel = parseKml(kml('<Point><altitudeMode>relativeToGround</altitudeMode><coordinates>139,35,100</coordinates></Point>'))
    const clamp = parseKml(kml('<Point><coordinates>139,35,100</coordinates></Point>'))
    const a = geomOf(await resolveAltitudes(abs, src())) as Extract<Geometry, { type: 'Point' }>
    const r = geomOf(await resolveAltitudes(rel, src())) as Extract<Geometry, { type: 'Point' }>
    const c = geomOf(await resolveAltitudes(clamp, src())) as Extract<Geometry, { type: 'Point' }>
    expect(a.coordinates[2]).toBe(100 + N)
    expect(r.coordinates[2]).toBe(100 + GROUND)
    expect(c.coordinates[2]).toBe(100)
    expect(a.altitudeMode).toBe('absolute')
    expect(r.altitudeMode).toBe('absolute') // 楕円体高へ直したので absolute に統一
    expect(c.altitudeMode).toBe('clampToGround')
  })

  it('元の文書は変えない', async () => {
    const doc = parseKml(kml('<LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>139,35,10 139.1,35,20</coordinates></LineString>'))
    await resolveAltitudes(doc, src())
    const g = geomOf(doc) as Extract<Geometry, { type: 'LineString' }>
    expect(g.coordinates.map((c) => c[2])).toEqual([10, 20])
    expect(g.altitudeMode).toBe('relativeToGround')
  })

  it('頂点ごとの標高を使い、extrude のとき地表の楕円体高（ground）を持つ', async () => {
    const doc = parseKml(kml('<LineString><extrude>1</extrude><altitudeMode>relativeToGround</altitudeMode><coordinates>139,35,10 139.1,35,10</coordinates></LineString>'))
    const out = await resolveAltitudes(doc, src({ terrain: async (pts) => pts.map((p) => (p.lng < 139.05 ? 100 : 200)) }))
    const g = geomOf(out) as Extract<Geometry, { type: 'LineString' }> & { ground?: number[] }
    expect(g.coordinates.map((c) => c[2])).toEqual([110, 210])
    expect(g.ground).toEqual([100, 200])
  })

  it('Polygon は外周と内周をまとめて解決する', async () => {
    const doc = parseKml(
      kml(
        '<Polygon><extrude>1</extrude><altitudeMode>absolute</altitudeMode><outerBoundaryIs><LinearRing><coordinates>0,0,50 1,0,50 1,1,50 0,0,50</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0.2,0.2,50 0.4,0.2,50 0.4,0.4,50 0.2,0.2,50</coordinates></LinearRing></innerBoundaryIs></Polygon>',
      ),
    )
    const g = geomOf(await resolveAltitudes(doc, src())) as Extract<Geometry, { type: 'Polygon' }> & { ground?: number[] }
    expect(g.outer.map((c) => c[2])).toEqual([50 + N, 50 + N, 50 + N, 50 + N])
    expect(g.inner[0].map((c) => c[2])).toEqual([50 + N, 50 + N, 50 + N, 50 + N])
    expect(g.ground).toHaveLength(8)
  })

  it('標高・ジオイド高が引けない（例外・undefined）ときは 0 m 扱い', async () => {
    const rel = parseKml(kml('<Point><altitudeMode>relativeToGround</altitudeMode><coordinates>139,35,100</coordinates></Point>'))
    const abs = parseKml(kml('<Point><altitudeMode>absolute</altitudeMode><coordinates>139,35,100</coordinates></Point>'))
    const bad = src({ terrain: async () => { throw new Error('x') }, geoid: async () => undefined })
    expect((geomOf(await resolveAltitudes(rel, bad)) as Extract<Geometry, { type: 'Point' }>).coordinates[2]).toBe(100)
    expect((geomOf(await resolveAltitudes(abs, bad)) as Extract<Geometry, { type: 'Point' }>).coordinates[2]).toBe(100)
  })

  it('頂点が多すぎる文書は標高を引かない（relativeToGround は高度のまま）', async () => {
    const n = MAX_TERRAIN_POINTS + 1
    const coords = Array.from({ length: n }, (_, i) => `${139 + i * 1e-5},35,10`).join(' ')
    let called = 0
    const doc = parseKml(kml(`<LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>${coords}</coordinates></LineString>`))
    const out = await resolveAltitudes(doc, src({ terrain: async (p) => { called++; return p.map(() => GROUND) } }))
    expect(called).toBe(0)
    expect((geomOf(out) as Extract<Geometry, { type: 'LineString' }>).coordinates[0][2]).toBe(10)
  })

  it('fixtures の 12-altitude.kml には解決対象が 3 種 × 4 列ある', () => {
    const doc = parseKml(readFileSync('fixtures/kml/valid/12-altitude.kml', 'utf8'))
    expect(elevatedGeometries(doc)).toHaveLength(12)
  })
})

describe('Cesium 向けの KML 書き換え（resolveKmlAltitudes）', () => {
  it('高度を楕円体高へ直し、altitudeMode を absolute にする。extrude は残す', async () => {
    const out = await resolveKmlAltitudes(
      kml('<LineString><extrude>1</extrude><altitudeMode>relativeToGround</altitudeMode><coordinates>139,35,10 139.1,35,20</coordinates></LineString>'),
      src(),
    )
    expect(out).toContain('<altitudeMode>absolute</altitudeMode>')
    expect(out).toContain('139,35,50 139.1,35,60')
    expect(out).toContain('<extrude>1</extrude>')
  })

  it('absolute はジオイド高を足す。clampToGround のジオメトリは変えない', async () => {
    const xml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><Point><altitudeMode>absolute</altitudeMode><coordinates>139,35,100</coordinates></Point></Placemark>
      <Placemark><Point><coordinates>140,36,7</coordinates></Point></Placemark></Document></kml>`
    const out = (await resolveKmlAltitudes(xml, src()))!
    expect(out).toContain('139,35,136')
    expect(out).toContain('140,36,7')
  })

  it('Polygon の外周・内周の両方を書き換える', async () => {
    const out = (await resolveKmlAltitudes(
      kml('<Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>0,0,5 1,0,5 1,1,5 0,0,5</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0.1,0.1,5 0.2,0.1,5 0.2,0.2,5 0.1,0.1,5</coordinates></LinearRing></innerBoundaryIs></Polygon>'),
      src(),
    ))!
    expect(out).toContain('0,0,45 1,0,45 1,1,45 0,0,45')
    expect(out).toContain('0.1,0.1,45 0.2,0.1,45 0.2,0.2,45 0.1,0.1,45')
  })

  it('対象が無いとき・パースできないときは null', async () => {
    expect(await resolveKmlAltitudes(kml('<Point><coordinates>139,35,0</coordinates></Point>'), src())).toBeNull()
    expect(await resolveKmlAltitudes('<kml', src())).toBeNull()
    expect(hasElevatedGeometry(kml('<Point><coordinates>139,35,0</coordinates></Point>'))).toBe(false)
    expect(hasElevatedGeometry(kml('<Point><altitudeMode>absolute</altitudeMode><coordinates>139,35,0</coordinates></Point>'))).toBe(true)
  })
})
