// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { kmlToGeoJson } from '../src/adapters/maplibre-kml'
import { levelRuns } from '../src/adapters/altitude-geojson'
import { resolveAltitudes } from '../src/kml/altitude'
import { parseKml } from '../src/kml/parse'

const kml = (geom: string) => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>p</name>${geom}</Placemark></Document></kml>`
const src = { geoid: async () => 36, terrain: async (pts: { lng: number; lat: number }[]) => pts.map(() => 40) }
const feats = async (geom: string, altitude = true) => kmlToGeoJson(await resolveAltitudes(parseKml(kml(geom)), src), undefined, { altitude }).features
const props = (f: { properties: unknown }) => f.properties as Record<string, unknown>

describe('levelRuns（線を高さが一定の部分に分ける）', () => {
  it('高さが一定なら 1 本のまま', () => {
    const r = levelRuns([[0, 0, 100], [1, 0, 100], [1, 1, 100]])
    expect(r).toHaveLength(1)
    expect(r[0].height).toBe(100)
    expect(r[0].positions).toHaveLength(3)
  })
  it('高さが変わる区間は、5 m 刻みに分けて階段状にする', () => {
    const r = levelRuns([[0, 0, 0], [1, 0, 50]])
    expect(r.length).toBeGreaterThanOrEqual(8)
    expect(r[0].height).toBeLessThan(r.at(-1)!.height)
    // 区間の高さは 5 m 刻みで、元の線との差は 2.5 m 以内
    for (const run of r) expect(run.height % 5).toBe(0)
  })
  it('1 区間の分割は 50 までで止める', () => {
    expect(levelRuns([[0, 0, 0], [1, 0, 100000]]).length).toBeLessThanOrEqual(50)
  })
})

describe('kmlToGeoJson(altitude)', () => {
  it('altitude を付けなければ従来どおり 1 フィーチャで、Z を持たない', async () => {
    const f = await feats('<Point><altitudeMode>absolute</altitudeMode><coordinates>139,35,100</coordinates></Point>', false)
    expect(f).toHaveLength(1)
    expect((f[0].geometry as { coordinates: number[] }).coordinates).toEqual([139, 35])
  })
  it('absolute の点は Z（楕円体高）を持ち elevated になる', async () => {
    const f = await feats('<Point><altitudeMode>absolute</altitudeMode><coordinates>139,35,100</coordinates></Point>')
    expect((f[0].geometry as { coordinates: number[] }).coordinates).toEqual([139, 35, 136])
    expect(props(f[0]).elevated).toBe(true)
  })
  it('clampToGround は elevated にならない', async () => {
    const f = await feats('<Point><coordinates>139,35,100</coordinates></Point>')
    expect(props(f[0]).elevated).toBeUndefined()
  })
  it('extrude の点は、地表から点までの細い柱（prism）が付く', async () => {
    const f = await feats('<Point><extrude>1</extrude><altitudeMode>relativeToGround</altitudeMode><coordinates>139,35,100</coordinates></Point>')
    const pole = f.find((x) => props(x).prism)!
    expect(props(pole).baseHeight).toBe(40)
    expect(props(pole).topHeight).toBe(140)
  })
  it('extrude の Polygon は角柱になり、底は地表の最低・上は頂点の最高', async () => {
    const f = await feats(
      '<Polygon><extrude>1</extrude><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>0,0,10 1,0,20 1,1,30 0,0,10</coordinates></LinearRing></outerBoundaryIs></Polygon>',
    )
    expect(f).toHaveLength(1)
    expect(props(f[0]).prism).toBe(true)
    expect(props(f[0]).baseHeight).toBe(40)
    expect(props(f[0]).topHeight).toBe(70)
  })
  it('extrude の LineString は、線と区間ごとの壁（角柱）になる', async () => {
    const f = await feats('<LineString><extrude>1</extrude><altitudeMode>absolute</altitudeMode><coordinates>139,35,100 139.01,35,100 139.02,35,100</coordinates></LineString>')
    expect(f.filter((x) => props(x).lineHeight !== undefined)).toHaveLength(1)
    expect(f.filter((x) => props(x).prism)).toHaveLength(2)
  })
  it('MultiGeometry は、地表に貼る部品と浮かせる部品に分かれる', async () => {
    const f = await feats('<MultiGeometry><Point><coordinates>139,35,0</coordinates></Point><Point><altitudeMode>absolute</altitudeMode><coordinates>139.1,35,50</coordinates></Point></MultiGeometry>')
    expect(f).toHaveLength(2)
    expect(f.map((x) => props(x).elevated === true)).toEqual([false, true])
  })
})
