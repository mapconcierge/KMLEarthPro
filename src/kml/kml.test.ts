// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { formatKmlColor, parseKmlColor } from './color'
import { parseCoordinates, parseKml } from './parse'
import { serializeKml } from './serialize'
import { resolveStyle } from './style'
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
