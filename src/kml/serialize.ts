import { formatKmlColor } from './color'
import type { AbstractView, Coord, Feature, Geometry, KmlDocument, Style } from './types'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const coords = (cs: Coord[]) => cs.map((c) => c.join(',')).join(' ')
const tag = (n: string, v: string | number | undefined) =>
  v === undefined ? '' : `<${n}>${esc(String(v))}</${n}>`

function style(s: Style, ind: string): string {
  const parts: string[] = []
  if (s.icon)
    parts.push(
      `<IconStyle>${s.icon.color ? tag('color', formatKmlColor(s.icon.color)) : ''}${tag('scale', s.icon.scale)}${s.icon.href ? `<Icon>${tag('href', s.icon.href)}</Icon>` : ''}${s.icon.hotSpot ? `<hotSpot x="${s.icon.hotSpot.x}" y="${s.icon.hotSpot.y}" xunits="${s.icon.hotSpot.xunits}" yunits="${s.icon.hotSpot.yunits}"/>` : ''}</IconStyle>`,
    )
  if (s.label)
    parts.push(
      `<LabelStyle>${s.label.color ? tag('color', formatKmlColor(s.label.color)) : ''}${tag('scale', s.label.scale)}</LabelStyle>`,
    )
  if (s.line)
    parts.push(
      `<LineStyle>${s.line.color ? tag('color', formatKmlColor(s.line.color)) : ''}${tag('width', s.line.width)}</LineStyle>`,
    )
  if (s.poly)
    parts.push(
      `<PolyStyle>${s.poly.color ? tag('color', formatKmlColor(s.poly.color)) : ''}${tag('fill', s.poly.fill === false ? 0 : 1)}${tag('outline', s.poly.outline === false ? 0 : 1)}</PolyStyle>`,
    )
  if (s.balloon) parts.push(`<BalloonStyle>${tag('text', s.balloon.text)}</BalloonStyle>`)
  if (s.list) parts.push(`<ListStyle>${tag('listItemType', s.list.listItemType)}</ListStyle>`)
  const idAttr = s.id ? ` id="${esc(s.id)}"` : ''
  return `${ind}<Style${idAttr}>${parts.join('')}</Style>\n`
}

function geometry(g: Geometry): string {
  switch (g.type) {
    case 'Point':
      return `<Point>${tag('extrude', g.extrude ? 1 : undefined)}${tag('altitudeMode', g.altitudeMode)}${tag('coordinates', coords([g.coordinates]))}</Point>`
    case 'LineString':
      return `<LineString>${tag('extrude', g.extrude ? 1 : undefined)}${tag('tessellate', g.tessellate ? 1 : undefined)}${tag('altitudeMode', g.altitudeMode)}${tag('coordinates', coords(g.coordinates))}</LineString>`
    case 'Polygon': {
      const ring = (c: Coord[]) => `<LinearRing>${tag('coordinates', coords(c))}</LinearRing>`
      return `<Polygon>${tag('extrude', g.extrude ? 1 : undefined)}${tag('tessellate', g.tessellate ? 1 : undefined)}${tag('altitudeMode', g.altitudeMode)}<outerBoundaryIs>${ring(g.outer)}</outerBoundaryIs>${g.inner.map((r) => `<innerBoundaryIs>${ring(r)}</innerBoundaryIs>`).join('')}</Polygon>`
    }
    case 'MultiGeometry':
      return `<MultiGeometry>${g.geometries.map(geometry).join('')}</MultiGeometry>`
  }
}

function view(v: AbstractView): string {
  const common = `${tag('longitude', v.longitude)}${tag('latitude', v.latitude)}${tag('altitude', v.altitude)}${tag('heading', v.heading)}${tag('tilt', v.tilt)}`
  const mode = tag('altitudeMode', v.altitudeMode)
  return v.kind === 'LookAt'
    ? `<LookAt>${common}${tag('range', v.range)}${mode}</LookAt>`
    : `<Camera>${common}${tag('roll', v.roll)}${mode}</Camera>`
}

/**
 * Feature 共通の子要素。KML の XSD の順序（name, visibility, open, description, AbstractView, styleUrl）に合わせる。
 * 順序が違うと XSD 不適合になる（visibility を description の後に出していたのを修正）
 */
function featureHead(f: Feature): string {
  return (
    tag('name', f.name) +
    (f.visibility ? '' : tag('visibility', 0)) +
    (f.kind !== 'Placemark' && f.open ? tag('open', 1) : '') +
    tag('description', f.description) +
    (f.view ? view(f.view) : '') +
    tag('styleUrl', f.styleUrl)
  )
}

function feature(f: Feature, ind: string): string {
  const idAttr = f.id ? ` id="${esc(f.id)}"` : ''
  const head = featureHead(f)
  const inline = f.style ? style(f.style, '') : ''
  if (f.kind === 'Placemark')
    return `${ind}<Placemark${idAttr}>${head}${inline}${f.geometry ? geometry(f.geometry) : ''}</Placemark>\n`
  return `${ind}<${f.kind}${idAttr}>${head}${inline}\n${f.children.map((c) => feature(c, ind + '  ')).join('')}${ind}</${f.kind}>\n`
}

/** 文書モデルを KML 2.2 文字列へ。共有 Style/StyleMap は根コンテナの先頭へ出力する */
export function serializeKml(doc: KmlDocument): string {
  const root = doc.root
  const styles = Object.values(doc.styles)
    .map((s) => style(s, '    '))
    .join('')
  const maps = Object.values(doc.styleMaps)
    .map((m) => {
      const pairs = Object.entries(m.pairs)
        .map(([k, v]) =>
          typeof v === 'string'
            ? `<Pair>${tag('key', k)}${tag('styleUrl', v)}</Pair>`
            : `<Pair>${tag('key', k)}${style(v, '').trim()}</Pair>`,
        )
        .join('')
      return `    <StyleMap id="${esc(m.id)}">${pairs}</StyleMap>\n`
    })
    .join('')
  // 根が Folder の場合も Document で包んで共有スタイルを置ける形にする
  const body =
    root.kind === 'Document'
      ? `  <Document${root.id ? ` id="${esc(root.id)}"` : ''}>${featureHead(root)}\n${styles}${maps}${root.children.map((c) => feature(c, '    ')).join('')}  </Document>\n`
      : `  <Document>\n${styles}${maps}${feature(root, '    ')}  </Document>\n`
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n${body}</kml>\n`
}
