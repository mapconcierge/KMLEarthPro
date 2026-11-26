// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { hotSpotFraction, iconPlacement } from './icon'
import { featureAtPath, featureBounds, findPlacemarkPath, lookAtFromBounds, parseFeaturePath, resolveFlyView } from './target'
import { cameraToPose, findInitialView, lookAtToPose, resolveAbsoluteView, viewToCenterZoom } from './camera'
import { formatKmlColor, parseKmlColor } from './color'
import { parseCoordinates, parseKml } from './parse'
import { serializeKml } from './serialize'
import { resolveIconHref, resolveStyle } from './style'
import type { Folder, Placemark } from './types'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document><name>テスト</name><open>1</open>
  <Style id="s1"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
    <PolyStyle><color>7f00ff00</color></PolyStyle></Style>
  <StyleMap id="m1"><Pair><key>normal</key><styleUrl>#s1</styleUrl></Pair>
    <Pair><key>highlight</key><styleUrl>#s1</styleUrl></Pair></StyleMap>
  <Folder><name>F</name>
    <Placemark><name>P</name><styleUrl>#m1</styleUrl>
      <LookAt><longitude>139.7</longitude><latitude>35.6</latitude><range>500</range></LookAt>
      <Point><coordinates>139.7,35.6,10</coordinates></Point></Placemark>
    <Placemark><name>L</name><visibility>0</visibility><styleUrl>#s1</styleUrl>
      <LineString><altitudeMode>relativeToGround</altitudeMode>
        <coordinates>139,35,0 140,36,5</coordinates></LineString></Placemark>
    <Placemark><name>G</name><Polygon>
      <outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs>
      <innerBoundaryIs><LinearRing><coordinates>0.1,0.1 0.2,0.1 0.2,0.2 0.1,0.1</coordinates></LinearRing></innerBoundaryIs>
    </Polygon></Placemark>
  </Folder>
</Document></kml>`

describe('color', () => {
  it('aabbggrr → CSS', () => {
    expect(parseKmlColor('ff0000ff')).toEqual({ hex: '#ff0000', opacity: 1 })
    expect(parseKmlColor('7f00ff00')?.hex).toBe('#00ff00')
    expect(parseKmlColor('xyz')).toBeUndefined()
  })
  it('往復', () => {
    expect(formatKmlColor(parseKmlColor('80123456')!)).toBe('80123456')
  })
})

describe('coordinates', () => {
  it('不正値を警告して捨てる', () => {
    const w: string[] = []
    expect(parseCoordinates('1,2,3 200,0 a,b 4,5', w)).toEqual([
      [1, 2, 3],
      [4, 5, 0],
    ])
    expect(w).toHaveLength(2)
  })
})

describe('parseKml', () => {
  const doc = parseKml(SAMPLE)
  const folder = doc.root.children[0] as Folder
  it('構造とスタイル', () => {
    expect(doc.root.name).toBe('テスト')
    expect(doc.styles.s1.line?.width).toBe(3)
    expect(folder.children).toHaveLength(3)
    const [p, l, g] = folder.children as Placemark[]
    expect(p.geometry).toMatchObject({ type: 'Point', coordinates: [139.7, 35.6, 10] })
    expect(p.view).toMatchObject({ kind: 'LookAt', range: 500 })
    expect(l.visibility).toBe(false)
    expect(l.geometry).toMatchObject({ type: 'LineString', altitudeMode: 'relativeToGround' })
    expect(g.geometry).toMatchObject({ type: 'Polygon' })
  })
  it('StyleMap は normal を解決', () => {
    expect(resolveStyle(doc, folder.children[0])?.id).toBe('s1')
  })
  it('不正 XML / 非 KML は Error', () => {
    expect(() => parseKml('<kml><Document>')).toThrow()
    expect(() => parseKml('<foo/>')).toThrow()
  })
  it('parse → serialize → parse が同値', () => {
    const again = parseKml(serializeKml(doc))
    expect(again.root).toEqual(doc.root)
    expect(again.styles).toEqual(doc.styles)
    expect(again.styleMaps).toEqual(doc.styleMaps)
  })
})

describe('resolveIconHref', () => {
  const res = { 'files/a b.png': 'blob:x/1' }
  it('絶対 URL はそのまま', () => {
    expect(resolveIconHref('https://e.com/i.png', res)).toBe('https://e.com/i.png')
    expect(resolveIconHref('data:image/png;base64,AA', undefined)).toBe('data:image/png;base64,AA')
  })
  it('KMZ 同梱は相対パスで引く（./ 付き・%エンコードも可）', () => {
    expect(resolveIconHref('files/a b.png', res)).toBe('blob:x/1')
    expect(resolveIconHref('./files/a%20b.png', res)).toBe('blob:x/1')
  })
  it('解決できなければ undefined', () => {
    expect(resolveIconHref('missing.png', res)).toBeUndefined()
    expect(resolveIconHref(undefined, res)).toBeUndefined()
  })
})

describe('camera', () => {
  const look = (o: object) => ({
    longitude: 139, latitude: 35, altitude: 0, heading: 0, tilt: 0, range: 1000,
    altitudeMode: 'clampToGround' as const, ...o,
  })
  it('tilt=0 は真上から（位置は注視点の真上、pitch=-90）', () => {
    const p = lookAtToPose(look({}))
    expect(p).toMatchObject({ lng: 139, lat: 35, height: 1000, pitch: -90 })
  })
  it('tilt=90 / heading=0 はカメラが注視点の南側・同高度', () => {
    const p = lookAtToPose(look({ tilt: 90, range: 1105.4 }))
    expect(p.height).toBeCloseTo(0, 6)
    expect(p.pitch).toBe(0)
    expect(p.lat).toBeCloseTo(35 - 0.01, 6)
    expect(p.lng).toBeCloseTo(139, 9)
  })
  it('heading=90（東向き）ならカメラは西側', () => {
    const p = lookAtToPose(look({ tilt: 90, heading: 90, range: 1000 }))
    expect(p.lng).toBeLessThan(139)
    expect(p.lat).toBeCloseTo(35, 6)
  })
  it('altitudeMode=absolute は注視点高度を足し、clampToGround は無視', () => {
    expect(lookAtToPose(look({ altitude: 50, altitudeMode: 'absolute' })).height).toBe(1050)
    expect(lookAtToPose(look({ altitude: 50 })).height).toBe(1000)
  })
  it('Camera は位置をそのまま使い tilt を pitch へ', () => {
    const p = cameraToPose({
      longitude: 1, latitude: 2, altitude: 300, heading: 45, tilt: 60, roll: 5, altitudeMode: 'absolute',
    })
    expect(p).toEqual({ lng: 1, lat: 2, height: 300, heading: 45, pitch: -30, roll: 5 })
  })
  it('文書内の最初の視点を深さ優先で探す', () => {
    const doc = parseKml(`<kml><Document><Folder><Placemark><name>a</name></Placemark>
      <Placemark><LookAt><longitude>1</longitude><latitude>2</latitude><range>10</range></LookAt>
      <Point><coordinates>1,2</coordinates></Point></Placemark></Folder></Document></kml>`)
    expect(findInitialView(doc)).toMatchObject({ kind: 'LookAt', longitude: 1, range: 10 })
    expect(findInitialView(parseKml('<kml><Document/></kml>'))).toBeUndefined()
  })
})

describe('viewToCenterZoom (MapLibre)', () => {
  const look = { kind: 'LookAt' as const, longitude: 139, latitude: 35, altitude: 0, heading: 90, tilt: 60, range: 500, altitudeMode: 'clampToGround' as const }
  it('LookAt は注視点を中心に、heading→bearing・tilt→pitch', () => {
    const v = viewToCenterZoom(look, 800)
    expect(v.center).toEqual([139, 35])
    expect(v.bearing).toBe(90)
    expect(v.pitch).toBe(60)
  })
  it('range が 2 倍になると zoom は 1 小さくなる', () => {
    const a = viewToCenterZoom(look, 800).zoom
    const b = viewToCenterZoom({ ...look, range: 1000 }, 800).zoom
    expect(a - b).toBeCloseTo(1, 6)
  })
  it('LookAt の range が大きく（数十 km）ても切り詰めず、zoom は range の対数に比例する', () => {
    const a = viewToCenterZoom({ ...look, tilt: 0, range: 40_000 }, 800).zoom
    const b = viewToCenterZoom({ ...look, tilt: 0, range: 80_000 }, 800).zoom
    expect(a - b).toBeCloseTo(1, 6)
  })
  it('pitch は maxPitch を超えない', () => {
    expect(viewToCenterZoom({ ...look, tilt: 90 }, 800, 85).pitch).toBe(85)
  })
  it('Camera は視線が地面に当たる点を中心にする（北向き・tilt=45・高度 1000m なら北へ約 1000m）', () => {
    const v = viewToCenterZoom(
      { kind: 'Camera', longitude: 139, latitude: 35, altitude: 1000, heading: 0, tilt: 45, roll: 0, altitudeMode: 'absolute' },
      800,
    )
    expect(v.center[0]).toBeCloseTo(139, 9)
    expect(v.center[1]).toBeCloseTo(35 + 1000 / 110540, 6)
    expect(v.bearing).toBe(0)
  })
})

describe('resolveAbsoluteView（地形標高の反映）', () => {
  const sample = (lng: number, lat: number) => (lng === 139 && lat === 35 ? 120 : undefined)
  const base = { longitude: 139, latitude: 35, altitude: 30, heading: 0, tilt: 45 }
  const look = { kind: 'LookAt' as const, ...base, range: 500 }
  const cam = { kind: 'Camera' as const, ...base, roll: 0 }

  it('LookAt: clampToGround は標高、relativeToGround は標高+altitude、absolute はそのまま', async () => {
    expect((await resolveAbsoluteView({ ...look, altitudeMode: 'clampToGround' }, sample)).altitude).toBe(120)
    expect((await resolveAbsoluteView({ ...look, altitudeMode: 'relativeToGround' }, sample)).altitude).toBe(150)
    expect((await resolveAbsoluteView({ ...look, altitudeMode: 'absolute' }, sample)).altitude).toBe(30)
  })
  it('Camera: clamp も relative も標高+altitude（地面に潜らない）', async () => {
    expect((await resolveAbsoluteView({ ...cam, altitudeMode: 'clampToGround' }, sample)).altitude).toBe(150)
    expect((await resolveAbsoluteView({ ...cam, altitudeMode: 'relativeToGround' }, sample)).altitude).toBe(150)
  })
  it('結果は altitudeMode=absolute になり、元の視点は変更されない', async () => {
    const src = { ...look, altitudeMode: 'relativeToGround' as const }
    const out = await resolveAbsoluteView(src, sample)
    expect(out.altitudeMode).toBe('absolute')
    expect(src.altitude).toBe(30)
  })
  it('標高が引けない/例外のときは 0 m を地面とみなす', async () => {
    const none = { ...look, longitude: 10, altitudeMode: 'relativeToGround' as const }
    expect((await resolveAbsoluteView(none, sample)).altitude).toBe(30)
    const boom = () => { throw new Error('x') }
    expect((await resolveAbsoluteView({ ...look, altitudeMode: 'clampToGround' }, boom)).altitude).toBe(0)
  })
  it('標高 120m の地面に clamp した LookAt は、地面標高を渡せば標高 0m の場合と同じ中心・zoom になる', async () => {
    const flat = viewToCenterZoom({ ...look, altitudeMode: 'clampToGround' }, 800, 85, 0)
    const resolved = await resolveAbsoluteView({ ...look, altitudeMode: 'clampToGround' }, sample)
    const hilly = viewToCenterZoom(resolved, 800, 85, 120)
    expect(hilly.zoom).toBeCloseTo(flat.zoom, 9)
    expect(hilly.center[0]).toBeCloseTo(flat.center[0], 9)
    expect(hilly.center[1]).toBeCloseTo(flat.center[1], 9)
  })
  it('地面標高を渡さないと、標高のある地点ではカメラが高く見積もられ zoom が小さくなる', async () => {
    const resolved = await resolveAbsoluteView({ ...look, altitudeMode: 'clampToGround' }, sample)
    expect(viewToCenterZoom(resolved, 800, 85, 0).zoom).toBeLessThan(viewToCenterZoom(resolved, 800, 85, 120).zoom)
  })
})

describe('parse/serialize: hotSpot', () => {
  const kml = (hs: string) => `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Style id="s"><IconStyle>
    <Icon><href>a.png</href></Icon>${hs}</IconStyle></Style></Document></kml>`
  it('属性と units を読み、既定は中心(0.5,0.5 fraction)', () => {
    const d = parseKml(kml('<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>'))
    expect(d.styles.s.icon?.hotSpot).toEqual({ x: 20, y: 2, xunits: 'pixels', yunits: 'pixels' })
    expect(parseKml(kml('<hotSpot/>')).styles.s.icon?.hotSpot).toEqual({ x: 0.5, y: 0.5, xunits: 'fraction', yunits: 'fraction' })
    expect(parseKml(kml('<hotSpot x="1" xunits="bogus"/>')).styles.s.icon?.hotSpot?.xunits).toBe('fraction')
    expect(parseKml(kml('')).styles.s.icon?.hotSpot).toBeUndefined()
  })
  it('往復で保持される', () => {
    const d = parseKml(kml('<hotSpot x="0.5" y="1" xunits="fraction" yunits="insetPixels"/>'))
    expect(parseKml(serializeKml(d)).styles.s.icon?.hotSpot).toEqual(d.styles.s.icon?.hotSpot)
  })
})

describe('icon: hotSpotFraction / iconPlacement', () => {
  const size = { width: 64, height: 32 }
  it('既定は中心、fraction はそのまま', () => {
    expect(hotSpotFraction(undefined, size)).toEqual({ fx: 0.5, fy: 0.5 })
    expect(hotSpotFraction({ x: 0.25, y: 1, xunits: 'fraction', yunits: 'fraction' }, size)).toEqual({ fx: 0.25, fy: 1 })
  })
  it('pixels は左/下から、insetPixels は右/上から割合へ', () => {
    expect(hotSpotFraction({ x: 16, y: 8, xunits: 'pixels', yunits: 'pixels' }, size)).toEqual({ fx: 0.25, fy: 0.25 })
    expect(hotSpotFraction({ x: 16, y: 8, xunits: 'insetPixels', yunits: 'insetPixels' }, size)).toEqual({ fx: 0.75, fy: 0.75 })
  })
  it('中心 hotSpot はオフセット 0、下端までは表示高さの半分', () => {
    const p = iconPlacement(size, 1, undefined)
    expect(p.offsetX).toBeCloseTo(0)
    expect(p.offsetY).toBeCloseTo(0)
    expect(p.displayWidth).toBe(32)
    expect(p.displayHeight).toBe(16)
    expect(p.belowPx).toBe(8)
  })
  it('下端中央の hotSpot（ピン）は、画像中心を座標の上へ（offsetY は負）、ラベルは直下', () => {
    const p = iconPlacement(size, 1, { x: 0.5, y: 0, xunits: 'fraction', yunits: 'fraction' })
    expect(p.offsetY).toBeCloseTo(-16) // 自然 px で高さの半分だけ上
    expect(p.belowPx).toBe(0)
  })
  it('左下 hotSpot は画像中心を座標の右上へ', () => {
    const p = iconPlacement(size, 1, { x: 0, y: 0, xunits: 'fraction', yunits: 'fraction' })
    expect(p.offsetX).toBeCloseTo(32)
    expect(p.offsetY).toBeCloseTo(-16)
  })
  it('scale は表示サイズと倍率に効き、オフセット（自然 px）は変わらない', () => {
    const a = iconPlacement(size, 1, undefined)
    const b = iconPlacement(size, 2, { x: 0.5, y: 0, xunits: 'fraction', yunits: 'fraction' })
    expect(b.displayWidth).toBe(64)
    expect(b.sizeRatio).toBeCloseTo(a.sizeRatio * 2)
    expect(b.offsetY).toBeCloseTo(-16)
  })
})

describe('target: 飛行先の決定', () => {
  const doc = parseKml(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>d</name>
    <Folder><name>F</name>
      <Placemark><name>pt</name><Point><coordinates>139.0,35.0</coordinates></Point></Placemark>
      <Placemark><name>line</name><LineString><coordinates>139.0,35.0 139.02,35.01</coordinates></LineString></Placemark>
      <Placemark><name>withview</name>
        <LookAt><longitude>140</longitude><latitude>36</latitude><range>77</range></LookAt>
        <Point><coordinates>140,36</coordinates></Point></Placemark>
    </Folder>
    <Placemark><name>nogeom</name></Placemark>
  </Document></kml>`)

  it('featureAtPath: 根・フォルダ・Placemark・範囲外', () => {
    expect(featureAtPath(doc, [])?.kind).toBe('Document')
    expect(featureAtPath(doc, [0])?.name).toBe('F')
    expect(featureAtPath(doc, [0, 1])?.name).toBe('line')
    expect(featureAtPath(doc, [0, 9])).toBeUndefined()
    expect(featureAtPath(doc, [0, 1, 0])).toBeUndefined() // Placemark の下は無い
  })
  it('featureBounds: Placemark / フォルダ（配下を合算）/ ジオメトリ無しは undefined', () => {
    expect(featureBounds(featureAtPath(doc, [0, 0])!)).toEqual([139, 35, 139, 35])
    expect(featureBounds(featureAtPath(doc, [0, 1])!)).toEqual([139, 35, 139.02, 35.01])
    expect(featureBounds(featureAtPath(doc, [0])!)).toEqual([139, 35, 140, 36])
    expect(featureBounds(featureAtPath(doc, [1])!)).toBeUndefined()
  })
  it('lookAtFromBounds: 点は固定距離、広がりがあれば範囲に応じて大きくなる', () => {
    expect(lookAtFromBounds([139, 35, 139, 35])).toMatchObject({ longitude: 139, latitude: 35, range: 800, tilt: 0 })
    const small = lookAtFromBounds([139, 35, 139.001, 35.001]).range
    const big = lookAtFromBounds([139, 35, 140, 36]).range
    expect(big).toBeGreaterThan(small)
    expect(small).toBeGreaterThanOrEqual(300)
  })
  it('lookAtFromBounds: 縦に長い範囲は縦、横に長い範囲は横（アスペクト 1.6 想定）で決まる', () => {
    const tall = lookAtFromBounds([139, 35, 139, 35.1]).range
    const wide = lookAtFromBounds([139, 35, 139.1 / 1.0, 35]).range
    expect(tall).toBeGreaterThan(0)
    expect(wide).toBeGreaterThan(0)
    // 同じ長さ(度)の南北と東西なら、東西は 1/1.6 の分だけ小さい距離で収まる（緯度補正の cos も効く）
    expect(wide).toBeLessThan(tall)
  })
  it('lookAtFromBounds: 表示領域が縦長（aspect が小さい）ほど、横に長い範囲は遠くから見る', () => {
    const b: [number, number, number, number] = [139, 35, 139.3, 35.05]
    expect(lookAtFromBounds(b, 1.0).range).toBeGreaterThan(lookAtFromBounds(b, 2.0).range)
  })
  it('resolveFlyView: 自身の視点 > 範囲、文書全体は最初の視点 > 全体の範囲、無ければ undefined', () => {
    expect(resolveFlyView(doc, [0, 2])).toMatchObject({ kind: 'LookAt', longitude: 140, range: 77 })
    expect(resolveFlyView(doc, [0, 0])).toMatchObject({ kind: 'LookAt', longitude: 139, range: 800 })
    expect(resolveFlyView(doc)).toMatchObject({ kind: 'LookAt', longitude: 140, range: 77 }) // 最初に見つかる視点
    expect(resolveFlyView(doc, [1])).toBeUndefined()
    expect(resolveFlyView(doc, [5])).toBeUndefined()
    const noView = parseKml('<kml><Document><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>')
    expect(resolveFlyView(noView)).toMatchObject({ kind: 'LookAt', longitude: 1, latitude: 2, range: 800 })
  })
})

describe('地図クリックでの Placemark 特定', () => {
  const doc = parseKml(`<kml><Document>
    <Folder><Placemark><name>A</name><Point><coordinates>139.0,35.0</coordinates></Point></Placemark></Folder>
    <Folder><Placemark><name>A</name><Point><coordinates>140.0,36.0</coordinates></Point></Placemark>
    <Placemark><name>L</name><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark></Folder>
  </Document></kml>`)
  it('parseFeaturePath は不正な値を弾く', () => {
    expect(parseFeaturePath('0/2/1')).toEqual([0, 2, 1])
    expect(parseFeaturePath('')).toEqual([])
    expect(parseFeaturePath('a/1')).toBeUndefined()
    expect(parseFeaturePath(undefined)).toBeUndefined()
  })
  it('同名でも位置が近い方を返す', () => {
    expect(findPlacemarkPath(doc, 'A', 140.0, 36.0)).toEqual([1, 0])
    expect(findPlacemarkPath(doc, 'A', 139.0, 35.0)).toEqual([0, 0])
    expect(findPlacemarkPath(doc, 'L', 1, 2)).toEqual([1, 1])
  })
  it('名前か位置が合わなければ undefined', () => {
    expect(findPlacemarkPath(doc, 'X', 139.0, 35.0)).toBeUndefined()
    expect(findPlacemarkPath(doc, 'A', 100, 10)).toBeUndefined()
  })
})
