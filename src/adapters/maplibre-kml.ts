import type { FeatureCollection, Feature as GjFeature, Geometry as GjGeometry } from 'geojson'
import type { Map as MlMap, LngLatBoundsLike } from 'maplibre-gl'
import { resolveStyle } from '../kml/style'
import type { Feature, Geometry, KmlDocument, Style } from '../kml/types'

// 2D(MapLibre) では高度を無視し、アイコン画像は円で代用する（未実装の制限）。
const DEFAULT_LINE = '#ffffff'
const DEFAULT_FILL = '#ffffff'

function toGeoJsonGeometry(g: Geometry): GjGeometry {
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] }
    case 'LineString':
      return { type: 'LineString', coordinates: g.coordinates.map((c) => [c[0], c[1]]) }
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: [g.outer, ...g.inner].map((r) => r.map((c) => [c[0], c[1]])),
      }
    case 'MultiGeometry':
      return { type: 'GeometryCollection', geometries: g.geometries.map(toGeoJsonGeometry) }
  }
}

function props(name: string | undefined, s: Style | undefined) {
  return {
    name: name ?? '',
    lineColor: s?.line?.color?.hex ?? DEFAULT_LINE,
    lineOpacity: s?.line?.color?.opacity ?? 1,
    lineWidth: s?.line?.width ?? 1,
    fillColor: s?.poly?.color?.hex ?? DEFAULT_FILL,
    fillOpacity: s?.poly?.fill === false ? 0 : (s?.poly?.color?.opacity ?? 1),
    outline: s?.poly?.outline !== false,
    pointColor: s?.icon?.color?.hex ?? '#ffd400',
  }
}

/** 文書モデルを GeoJSON へ。visibility=0 のフィーチャと、その配下は含めない */
export function kmlToGeoJson(doc: KmlDocument): FeatureCollection {
  const features: GjFeature[] = []
  const walk = (f: Feature) => {
    if (!f.visibility) return
    if (f.kind === 'Placemark') {
      if (!f.geometry) return
      features.push({
        type: 'Feature',
        geometry: toGeoJsonGeometry(f.geometry),
        properties: props(f.name, resolveStyle(doc, f)),
      })
    } else {
      f.children.forEach(walk)
    }
  }
  walk(doc.root)
  return { type: 'FeatureCollection', features }
}

export function geoJsonBounds(fc: FeatureCollection): LngLatBoundsLike | undefined {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0])
      s = Math.min(s, c[1] as number); n = Math.max(n, c[1] as number)
    } else if (Array.isArray(c)) c.forEach(visit)
  }
  const geom = (g: GjGeometry): void =>
    g.type === 'GeometryCollection' ? g.geometries.forEach(geom) : visit(g.coordinates)
  fc.features.forEach((f) => geom(f.geometry))
  return Number.isFinite(w) ? [[w, s], [e, n]] : undefined
}

const ids = (id: string) => ({
  src: `kml-${id}`,
  fill: `kml-${id}-fill`,
  line: `kml-${id}-line`,
  point: `kml-${id}-point`,
  label: `kml-${id}-label`,
})

/** 文書を地図へ追加する。style が未ロードなら呼び出し側が load 後に呼ぶこと */
export function addKmlToMap(map: MlMap, id: string, doc: KmlDocument): FeatureCollection {
  const fc = kmlToGeoJson(doc)
  const n = ids(id)
  map.addSource(n.src, { type: 'geojson', data: fc })
  map.addLayer({
    id: n.fill,
    type: 'fill',
    source: n.src,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] },
  })
  map.addLayer({
    id: n.line,
    type: 'line',
    source: n.src,
    filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']],
    paint: {
      'line-color': ['get', 'lineColor'],
      'line-opacity': ['get', 'lineOpacity'],
      'line-width': ['get', 'lineWidth'],
    },
  })
  map.addLayer({
    id: n.point,
    type: 'circle',
    source: n.src,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 6,
      'circle-color': ['get', 'pointColor'],
      'circle-stroke-color': '#000000',
      'circle-stroke-width': 1,
    },
  })
  map.addLayer({
    id: n.label,
    type: 'symbol',
    source: n.src,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 },
  })
  return fc
}

export function removeKmlFromMap(map: MlMap, id: string): void {
  const n = ids(id)
  for (const l of [n.label, n.point, n.line, n.fill]) if (map.getLayer(l)) map.removeLayer(l)
  if (map.getSource(n.src)) map.removeSource(n.src)
}
