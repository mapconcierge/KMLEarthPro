import type { FeatureCollection, Feature as GjFeature, Geometry as GjGeometry } from 'geojson'
import type { FilterSpecification, Map as MlMap } from 'maplibre-gl'
import { resolveIconHref, resolveStyle } from '../kml/style'
import { prepareIcons } from './kml-icons'
import type { Feature, Geometry, KmlDocument, Style } from '../kml/types'

// 2D(MapLibre) では高度を無視する。アイコンは画像（取れなければ円）、hotSpot とラベル位置に対応。
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

function props(name: string | undefined, s: Style | undefined, resources: Record<string, string> | undefined, kmlPath: string) {
  return {
    // 地図クリックでどの Placemark かを特定するための文書内の位置（FeaturePath を '/' で連結）
    kmlPath,
    iconHref: resolveIconHref(s?.icon?.href, resources) ?? '',
    iconScale: s?.icon?.scale ?? 1,
    // hotSpot は単位つきの生値で持ち、画像サイズが分かった後に prepareIcons が割合へ直す
    hotX: s?.icon?.hotSpot?.x ?? 0.5,
    hotY: s?.icon?.hotSpot?.y ?? 0.5,
    hotXu: s?.icon?.hotSpot?.xunits ?? '',
    hotYu: s?.icon?.hotSpot?.yunits ?? '',
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
export function kmlToGeoJson(doc: KmlDocument, resources?: Record<string, string>): FeatureCollection {
  const features: GjFeature[] = []
  const walk = (f: Feature, path: number[]) => {
    if (!f.visibility) return
    if (f.kind === 'Placemark') {
      if (!f.geometry) return
      features.push({
        type: 'Feature',
        geometry: toGeoJsonGeometry(f.geometry),
        properties: props(f.name, resolveStyle(doc, f), resources, path.join('/')),
      })
    } else {
      f.children.forEach((c, i) => walk(c, [...path, i]))
    }
  }
  walk(doc.root, [])
  return { type: 'FeatureCollection', features }
}

const ids = (id: string) => ({
  src: `kml-${id}`,
  fill: `kml-${id}-fill`,
  line: `kml-${id}-line`,
  point: `kml-${id}-point`,
  icon: `kml-${id}-icon`,
  label: `kml-${id}-label`,
})

/** アイコン URL → MapLibre の画像 ID。同じ URL は文書をまたいで 1 度だけ登録する */
const iconIds = new WeakMap<MlMap, Map<string, Promise<string | null>>>()

function loadIcon(map: MlMap, href: string) {
  let m = iconIds.get(map)
  if (!m) iconIds.set(map, (m = new Map()))
  let p = m.get(href)
  if (!p) {
    // ID は await より前に採番する（並行読み込みで m.size が進み、ID が衝突するため）
    const id = `kml-icon-${m.size}`
    p = (async () => {
      try {
        const { data } = await map.loadImage(href)
        if (!map.hasImage(id)) map.addImage(id, data)
        return id
      } catch (e) {
        // CORS・404 などで取れない場合は円で代用する
        console.warn('[MapLibre] KML icon load failed:', href, e)
        return null
      }
    })()
    m.set(href, p)
  }
  return p
}

const LABEL_SIZE_PX = 12
const LABEL_GAP_PX = 4
/** アイコンの無い点のラベル（円の半径 6px + すき間）の ems */
const LABEL_OFFSET_EM_NO_ICON = 1.2

const layerIdsByDoc = new Map<string, string[]>()

/** 文書を描いているレイヤ ID（クリック判定の対象） */
export const kmlLayerIds = (id: string) => layerIdsByDoc.get(id) ?? []

/**
 * 文書を地図へ追加する（アイコン画像の読み込みを待つので非同期）。
 * style が未ロードなら呼び出し側が load 後に呼ぶこと。
 *
 * アイコン付きの点は、hotSpot とラベル位置が同じもの（iconGroup）ごとにレイヤを分ける。
 * MapLibre の icon-offset / text-offset は配列のため、GeoJSON のプロパティに持たせて
 * データ駆動にできない（配列は文字列化される）ので、リテラルを持つレイヤをグループごとに作る。
 */
export async function addKmlToMap(
  map: MlMap,
  id: string,
  doc: KmlDocument,
  resources?: Record<string, string>,
): Promise<FeatureCollection> {
  const fc = kmlToGeoJson(doc, resources)
  const groups = await prepareIcons(fc)
  // MapLibre 側の画像も読み込む。取れなければ円で代用する
  const iconIdByHref = new Map(
    await Promise.all(
      [...new Set(fc.features.map((f) => (f.properties as { iconHref: string }).iconHref).filter(Boolean))].map(
        async (h) => [h, await loadIcon(map, h)] as const,
      ),
    ),
  )
  for (const f of fc.features) {
    const p = f.properties as { iconHref: string; iconId?: string; iconGroup?: string }
    if (!p.iconHref) continue
    const iconId = iconIdByHref.get(p.iconHref)
    if (iconId) p.iconId = iconId
    else delete p.iconGroup
  }

  const n = ids(id)
  const added: string[] = []
  const add = (layer: Parameters<MlMap['addLayer']>[0]) => {
    map.addLayer(layer)
    added.push(layer.id)
  }
  map.addSource(n.src, { type: 'geojson', data: fc })
  const isPoint: FilterSpecification = ['==', ['geometry-type'], 'Point']
  const noIcon: FilterSpecification = ['!', ['has', 'iconGroup']]
  add({
    id: n.fill,
    type: 'fill',
    source: n.src,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] },
  })
  add({
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
  add({
    id: n.point,
    type: 'circle',
    source: n.src,
    filter: ['all', isPoint, noIcon],
    paint: {
      'circle-radius': 6,
      'circle-color': ['get', 'pointColor'],
      'circle-stroke-color': '#000000',
      'circle-stroke-width': 1,
    },
  })
  const labelPaint = { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 }
  const labelLayout = (emBelow: number) => ({
    'text-field': ['get', 'name'] as never,
    'text-font': ['Noto Sans Regular'],
    'text-size': LABEL_SIZE_PX,
    'text-offset': [0, emBelow] as [number, number],
    'text-anchor': 'top' as const,
  })
  // アイコンの無い点のラベル
  add({
    id: n.label,
    type: 'symbol',
    source: n.src,
    filter: ['all', isPoint, noIcon],
    layout: labelLayout(LABEL_OFFSET_EM_NO_ICON),
    paint: labelPaint,
  })
  // アイコン付きの点: グループごとに icon-offset と、アイコン下端の直下に置くラベル
  let i = 0
  for (const g of groups.values()) {
    const filter: FilterSpecification = ['all', isPoint, ['==', ['get', 'iconGroup'], g.key]]
    add({
      id: `${n.icon}-${i}`,
      type: 'symbol',
      source: n.src,
      filter,
      layout: {
        'icon-image': ['get', 'iconId'],
        'icon-size': ['get', 'iconSizeRatio'],
        'icon-offset': [g.offsetX, g.offsetY],
        'icon-allow-overlap': true,
      },
    })
    add({
      id: `${n.label}-${i}`,
      type: 'symbol',
      source: n.src,
      filter,
      layout: labelLayout((g.belowPx + LABEL_GAP_PX) / LABEL_SIZE_PX),
      paint: labelPaint,
    })
    i += 1
  }
  layerIdsByDoc.set(id, added)
  return fc
}

export function removeKmlFromMap(map: MlMap, id: string): void {
  const n = ids(id)
  for (const l of [...(layerIdsByDoc.get(id) ?? [])].reverse()) if (map.getLayer(l)) map.removeLayer(l)
  layerIdsByDoc.delete(id)
  if (map.getSource(n.src)) map.removeSource(n.src)
}
