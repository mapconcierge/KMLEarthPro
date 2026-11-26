import { parseKmlColor } from './color'
import type {
  AbstractView,
  AltitudeMode,
  Coord,
  Feature,
  Folder,
  Geometry,
  HotSpot,
  KmlDocument,
  Placemark,
  Style,
  StyleMap,
} from './types'

// ---- XML ヘルパ（名前空間は無視し localName で照合する。KML 2.0/2.1/2.2/2.3 と gx: 混在に対応） ----

function children(el: Element, name?: string): Element[] {
  return Array.from(el.children).filter((c) => !name || c.localName === name)
}
function child(el: Element, name: string): Element | undefined {
  return children(el, name)[0]
}
function text(el: Element, name: string): string | undefined {
  const t = child(el, name)?.textContent?.trim()
  return t === '' ? undefined : t
}
function num(el: Element, name: string, fallback = 0): number {
  const v = Number(text(el, name))
  return text(el, name) !== undefined && Number.isFinite(v) ? v : fallback
}
function bool(el: Element, name: string, fallback: boolean): boolean {
  const t = text(el, name)
  if (t === undefined) return fallback
  return t === '1' || t.toLowerCase() === 'true'
}
function altMode(el: Element): AltitudeMode {
  // gx:altitudeMode も localName は altitudeMode
  const t = text(el, 'altitudeMode')
  return t === 'relativeToGround' || t === 'absolute' ? t : 'clampToGround'
}

/** "lon,lat[,alt]" の空白区切り列。不正なタプルは捨て、件数を warnings へ */
export function parseCoordinates(raw: string | undefined, warnings: string[]): Coord[] {
  if (!raw) return []
  const out: Coord[] = []
  for (const tuple of raw.trim().split(/\s+/)) {
    if (!tuple) continue
    const [lon, lat, alt] = tuple.split(',').map(Number)
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90
    ) {
      warnings.push(`不正な座標を無視: "${tuple}"`)
      continue
    }
    out.push([lon, lat, Number.isFinite(alt) ? alt : 0])
  }
  return out
}

function ringCoords(el: Element | undefined, warnings: string[]): Coord[] {
  const lr = el && child(el, 'LinearRing')
  return lr ? parseCoordinates(text(lr, 'coordinates'), warnings) : []
}

function parseGeometry(el: Element, warnings: string[]): Geometry | undefined {
  switch (el.localName) {
    case 'Point': {
      const c = parseCoordinates(text(el, 'coordinates'), warnings)[0]
      if (!c) return undefined
      return {
        type: 'Point',
        coordinates: c,
        altitudeMode: altMode(el),
        extrude: bool(el, 'extrude', false),
      }
    }
    case 'LineString': {
      const coordinates = parseCoordinates(text(el, 'coordinates'), warnings)
      if (coordinates.length < 2) return undefined
      return {
        type: 'LineString',
        coordinates,
        altitudeMode: altMode(el),
        extrude: bool(el, 'extrude', false),
        tessellate: bool(el, 'tessellate', false),
      }
    }
    case 'Polygon': {
      const outer = ringCoords(child(el, 'outerBoundaryIs'), warnings)
      if (outer.length < 3) return undefined
      const inner = children(el, 'innerBoundaryIs')
        .map((e) => ringCoords(e, warnings))
        .filter((r) => r.length >= 3)
      return {
        type: 'Polygon',
        outer,
        inner,
        altitudeMode: altMode(el),
        extrude: bool(el, 'extrude', false),
        tessellate: bool(el, 'tessellate', false),
      }
    }
    case 'MultiGeometry': {
      const geometries = children(el)
        .map((c) => parseGeometry(c, warnings))
        .filter((g): g is Geometry => !!g)
      return geometries.length ? { type: 'MultiGeometry', geometries } : undefined
    }
    default:
      return undefined
  }
}

const UNITS = ['fraction', 'pixels', 'insetPixels'] as const
/** <hotSpot x= y= xunits= yunits=/>。属性が無い/不正な場合は KML の既定（0.5, 0.5 fraction = 中心）になる */
function parseHotSpot(el: Element | undefined): HotSpot | undefined {
  if (!el) return undefined
  const n = (a: string, d: number) => {
    const v = el.getAttribute(a)
    return v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d
  }
  const u = (a: string) => {
    const v = el.getAttribute(a)
    return (UNITS as readonly string[]).includes(v ?? '') ? (v as HotSpot['xunits']) : 'fraction'
  }
  return { x: n('x', 0.5), y: n('y', 0.5), xunits: u('xunits'), yunits: u('yunits') }
}

function parseStyle(el: Element): Style {
  const style: Style = { id: el.getAttribute('id') ?? undefined }
  const icon = child(el, 'IconStyle')
  if (icon) {
    style.icon = {
      href: text(child(icon, 'Icon') ?? icon, 'href'),
      scale: text(icon, 'scale') ? num(icon, 'scale', 1) : undefined,
      color: parseKmlColor(text(icon, 'color')),
      hotSpot: parseHotSpot(child(icon, 'hotSpot')),
    }
  }
  const label = child(el, 'LabelStyle')
  if (label) {
    style.label = {
      scale: text(label, 'scale') ? num(label, 'scale', 1) : undefined,
      color: parseKmlColor(text(label, 'color')),
    }
  }
  const line = child(el, 'LineStyle')
  if (line) {
    style.line = {
      color: parseKmlColor(text(line, 'color')),
      width: text(line, 'width') ? num(line, 'width', 1) : undefined,
    }
  }
  const poly = child(el, 'PolyStyle')
  if (poly) {
    style.poly = {
      color: parseKmlColor(text(poly, 'color')),
      fill: bool(poly, 'fill', true),
      outline: bool(poly, 'outline', true),
    }
  }
  const balloon = child(el, 'BalloonStyle')
  if (balloon) style.balloon = { text: text(balloon, 'text') }
  const list = child(el, 'ListStyle')
  if (list) style.list = { listItemType: text(list, 'listItemType') }
  return style
}

function parseView(el: Element | undefined): AbstractView | undefined {
  if (!el) return undefined
  const base = {
    longitude: num(el, 'longitude'),
    latitude: num(el, 'latitude'),
    altitude: num(el, 'altitude'),
    heading: num(el, 'heading'),
    tilt: num(el, 'tilt'),
    altitudeMode: altMode(el),
  }
  if (el.localName === 'LookAt') return { kind: 'LookAt', ...base, range: num(el, 'range', 1000) }
  if (el.localName === 'Camera') return { kind: 'Camera', ...base, roll: num(el, 'roll') }
  return undefined
}

function parseFeature(el: Element, doc: KmlDocument): Feature | undefined {
  const name = el.localName
  if (name !== 'Placemark' && name !== 'Folder' && name !== 'Document') {
    return undefined
  }
  const base = {
    id: el.getAttribute('id') ?? undefined,
    name: text(el, 'name'),
    description: text(el, 'description'),
    visibility: bool(el, 'visibility', true),
    open: bool(el, 'open', false),
    styleUrl: text(el, 'styleUrl'),
    view: parseView(child(el, 'LookAt') ?? child(el, 'Camera')),
  }
  const inline = child(el, 'Style')
  const style = inline ? parseStyle(inline) : undefined

  if (name === 'Placemark') {
    const geomEl = children(el).find((c) =>
      ['Point', 'LineString', 'Polygon', 'MultiGeometry'].includes(c.localName),
    )
    const pm: Placemark = {
      kind: 'Placemark',
      ...base,
      style,
      geometry: geomEl ? parseGeometry(geomEl, doc.warnings) : undefined,
    }
    return pm
  }
  const folder: Folder = { kind: name, ...base, style, children: [] }
  collect(el, folder, doc)
  return folder
}

/** コンテナ直下の Style/StyleMap を文書へ登録し、Feature を子として積む */
function collect(el: Element, into: Folder, doc: KmlDocument): void {
  for (const c of children(el)) {
    if (c.localName === 'Style') {
      const s = parseStyle(c)
      if (s.id) doc.styles[s.id] = s
    } else if (c.localName === 'StyleMap') {
      const id = c.getAttribute('id')
      if (!id) continue
      const sm: StyleMap = { id, pairs: {} }
      for (const pair of children(c, 'Pair')) {
        const key = text(pair, 'key') ?? 'normal'
        const inline = child(pair, 'Style')
        const url = text(pair, 'styleUrl')
        if (inline) sm.pairs[key] = parseStyle(inline)
        else if (url) sm.pairs[key] = url
      }
      doc.styleMaps[id] = sm
    } else {
      const f = parseFeature(c, doc)
      if (f) into.children.push(f)
      else if (
        ![
          'name',
          'description',
          'visibility',
          'open',
          'styleUrl',
          'LookAt',
          'Camera',
          'Snippet',
          'address',
          'atom:author',
          'author',
          'link',
          'ExtendedData',
          'TimeStamp',
          'TimeSpan',
          'Region',
          'phoneNumber',
          'AddressDetails',
        ].includes(c.localName)
      ) {
        doc.warnings.push(`未対応の要素を無視: <${c.localName}>`)
      }
    }
  }
}

/** KML 文字列を文書モデルへ。XML として不正なら Error を投げる */
export function parseKml(xml: string): KmlDocument {
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  const err = dom.getElementsByTagName('parsererror')[0]
  if (err) throw new Error(`KML の XML 解析に失敗: ${err.textContent?.slice(0, 200)}`)

  const rootEl = dom.documentElement
  if (!rootEl || rootEl.localName !== 'kml') throw new Error('ルート要素が <kml> ではありません')

  const doc: KmlDocument = {
    root: {
      kind: 'Document',
      visibility: true,
      open: true,
      children: [],
    },
    styles: {},
    styleMaps: {},
    warnings: [],
  }
  // <kml> 直下は Feature 1 つが標準だが、Style 等が並ぶ場合も collect が受ける
  collect(rootEl, doc.root, doc)
  // Document 1 つだけなら、それを根にして階層を 1 段減らす
  if (doc.root.children.length === 1 && doc.root.children[0].kind === 'Document') {
    doc.root = doc.root.children[0] as Folder
  }
  return doc
}
