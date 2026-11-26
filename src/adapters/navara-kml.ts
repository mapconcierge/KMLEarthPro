import type ThreeView from '@navaramap/three'
import { Color, fetchFontFamilyFromCss, type FeatureEvaluator, type Source } from '@navaramap/three'
import type { DefaultDescriptions } from '@navaramap/three-default-plugin'
import type { FeatureCollection } from 'geojson'
import { kmlToGeoJson, geoJsonBounds } from './maplibre-kml'
import { prepareIcons } from './kml-icons'
import { KML_ICON_BASE_PX } from '../kml/style'
import { findInitialView, resolveAbsoluteView, type ElevationSampler } from '../kml/camera'
import type { AbstractView, KmlDocument } from '../kml/types'

// Navara(3D) では GeoJSON ソース + vector レイヤで描き、色・幅・ラベルは
// FeatureEvaluator でフィーチャのプロパティから当てる（2D と同じ変換結果を共有）。
// アイコン画像は billboard（FeatureEvaluator の image でフィーチャごとに指定）。取れない/無い点は円。
// 制限: hotSpot 未対応（中心基準）、高度・extrude は未反映（地表に貼る）。
// ラベル(name): 原因調査の結果、text レイヤーは font 未指定だと一切描画されない（Navara 0.1.1）。Google Fonts の
// CSS から unicode-range 分割の FontFamily を作って登録し、使う文字を含む face だけ取得させる。
const FONT_FAMILY = 'KmlLabelFont'
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Sans&family=Noto+Sans+JP'
const fontReady = new WeakMap<object, Promise<void>>()

async function ensureFont(view: View): Promise<void> {
  let p = fontReady.get(view)
  if (!p) {
    p = fetchFontFamilyFromCss(FONT_FAMILY, FONT_CSS).then((f) => void view.addFontFamily(f))
    fontReady.set(view, p)
  }
  return p
}

type View = ThreeView<DefaultDescriptions>

/** 1 つの GeoJSON ソースと、それを描く vector レイヤ */
interface NavaraPart {
  source: Source
  layerId: string
}

export interface NavaraKml {
  /** 通常のフィーチャ用 1 つ + アイコン配置（hotSpot）グループごとに 1 つ */
  parts: NavaraPart[]
  /** [west, south, east, north] */
  bounds: [number, number, number, number] | undefined
  /** 文書の LookAt / Camera。あれば範囲より優先して飛ぶ */
  view: AbstractView | undefined
}

const LABEL_SIZE_PX = 18
const LABEL_GAP_PX = 3
const POINT_RADIUS_PX = 6
// lineHeight=1 のとき、空行 1 行が占める高さ ÷ size。Noto Sans JP で size=18 のときの実測から較正した値
// （Navara 0.1.1 の行高は font の行間を含むため size より大きい）。フォントを変えたら測り直すこと
const LINE_HEIGHT_PX_PER_SIZE = 2.17

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
const numv = (v: unknown, d: number) => (typeof v === 'number' ? v : d)

export async function addKmlToNavara(
  view: View,
  doc: KmlDocument,
  resources?: Record<string, string>,
): Promise<NavaraKml> {
  // フォント取得に失敗してもラベルが出ないだけで、点・線・面は描く
  await ensureFont(view).catch((e: unknown) => console.warn('[Navara] font load failed:', e))
  const fc = kmlToGeoJson(doc, resources)
  const groups = await prepareIcons(fc)

  // Navara の billboard / text の center（アンカー）はレイヤ単位で、フィーチャごとには変えられない。
  // そこで、hotSpot とラベル位置が同じアイコン点（iconGroup）ごとにソースとレイヤを分ける。
  const featuresOf = (pred: (group: string | undefined) => boolean): FeatureCollection => ({
    type: 'FeatureCollection',
    features: fc.features.filter((f) => pred((f.properties as { iconGroup?: string }).iconGroup)),
  })
  const parts: NavaraPart[] = []
  const addPart = (data: FeatureCollection, materials: Record<string, unknown>) => {
    const source = view.addSource({ type: 'geojson', data })
    const layer = view.addLayer({ type: 'vector', source, ...materials } as never)
    layer.on('featureCreated', ({ evaluator }) => style(evaluator))
    parts.push({ source, layerId: layer.id })
  }
  const textBase = {
    font: FONT_FAMILY,
    lang: 'ja',
    clampToGround: true,
    depthTest: false,
    sizeInMeters: false,
    size: LABEL_SIZE_PX,
    declutter: false,
    color: new Color().setStyle('#ffffff'),
    outlineColor: new Color().setStyle('#000000'),
    outlineOpacity: 1,
    outlineWidth: 4,
    opacity: 1,
  }
  // text の center は 0..1（0.5,0.5 が中央。billboard の -0.5..0.5 とは基準が違う）。
  // y は 1 を超えても効かない（飽和する）ため、アイコン分だけ下げる手段が center では取れない。
  // そこで y=1（テキスト上端を座標に合わせ、座標の真下に垂れる）にしたうえで、ラベルの先頭に
  // 空行を 1 行入れ、lineHeight（行高の倍率）で空行の高さ = アイコン下端までの距離 + すき間にする。
  const labelMaterial = (belowPx: number) => ({
    ...textBase,
    center: { x: 0.5, y: 1 },
    lineHeight: Math.max(belowPx, 1) / (LABEL_SIZE_PX * LINE_HEIGHT_PX_PER_SIZE),
  })

  // 通常のフィーチャ（面・線・アイコン無しの点）。ラベルは円の直下
  addPart(featuresOf((g) => g === undefined), {
    polygon: { clampToGround: true, transparent: true, outline: false },
    polyline: { clampToGround: true, transparent: true, width: 2 },
    point: { clampToGround: true, sizeInMeters: false, depthTest: false, size: 12, color: new Color().setStyle('#ffd400') },
    text: labelMaterial(POINT_RADIUS_PX + LABEL_GAP_PX),
  })
  // アイコン付きの点（グループごと）
  for (const g of groups.values()) {
    addPart(featuresOf((k) => k === g.key), {
      billboard: {
        clampToGround: true,
        sizeInMeters: false,
        depthTest: false,
        size: KML_ICON_BASE_PX,
        declutter: false,
        transparent: true,
        center: { x: g.anchorX, y: g.anchorY },
      },
      // 同じ点は円（point）も生成されるが、評価で隠す。ラベルはアイコン下端の直下
      point: { clampToGround: true, sizeInMeters: false, depthTest: false, size: 12, color: new Color().setStyle('#ffd400') },
      text: labelMaterial(g.belowPx + LABEL_GAP_PX),
    })
  }

  const style = (e: FeatureEvaluator) =>
    e.evaluate(({ properties: p, meshGeomType }) => {
      const props = p ?? {}
      switch (meshGeomType) {
        case 'polygon':
          return { color: new Color().setStyle(str(props.fillColor, '#ffffff')), opacity: numv(props.fillOpacity, 1) }
        case 'polyline':
          return { color: new Color().setStyle(str(props.lineColor, '#ffffff')), opacity: numv(props.lineOpacity, 1), width: numv(props.lineWidth, 1) }
        case 'point': {
          // アイコン画像のある点は billboard 側で描くので円は隠す
          const hasIcon = str(props.iconHref, '') !== ''
          return { color: new Color().setStyle(str(props.pointColor, '#ffd400')), show: !hasIcon }
        }
        case 'billboard': {
          const href = str(props.iconHref, '')
          return href
            // Navara の billboard の size は「高さ」（幅は画像の縦横比で決まる）。MapLibre と大きさを揃える
            ? { show: true, image: href, size: numv(props.iconDisplayHeight, KML_ICON_BASE_PX * numv(props.iconScale, 1)) }
            : { show: false }
        }
        case 'text': {
          // 先頭の空行で、座標（hotSpot）より下へずらす（labelMaterial のコメント参照）。
          // 名前の改行は、空行の高さ調整が崩れないよう空白にする
          const name = str(props.name, '').replace(/\s*[\r\n]+\s*/g, ' ')
          return { text: name === '' ? '' : `\n${name}`, opacity: 1, show: name !== '' }
        }
        default:
          return {}
      }
    })

  const b = geoJsonBounds(fc) as [[number, number], [number, number]] | undefined
  return { parts, view: findInitialView(doc), bounds: b ? [b[0][0], b[0][1], b[1][0], b[1][1]] : undefined }
}

export function removeKmlFromNavara(view: View, k: NavaraKml): void {
  // レイヤーが参照している間はソースを消せないので順序を守る
  for (const part of k.parts) {
    view.deleteLayerById(part.layerId)
    part.source.delete()
  }
}

/**
 * 文書の視点があればそこへ、無ければ範囲全体へ飛ぶ。
 * 標高は view.sampleTerrainMostDetailed（呼び出し側が sample として渡す）で引く。
 * LookAt は Navara の distance（注視点からカメラ前方へ range 離れる）にそのまま対応する。
 * pitch は水平=0・真下=-90 なので tilt - 90。
 */
export async function flyToNavaraKml(
  view: View,
  k: NavaraKml,
  duration: number,
  sample: ElevationSampler,
): Promise<void> {
  if (!k.view) {
    if (k.bounds) flyToNavaraBounds(view, k.bounds, duration)
    return
  }
  // altitudeMode に応じて地形標高を足し、絶対高度へ直してから飛ぶ
  const v = await resolveAbsoluteView(k.view, sample)
  if (v.kind === 'LookAt') {
    void view.flyTo(
      {
        lng: v.longitude,
        lat: v.latitude,
        height: v.altitude,
        distance: v.range,
        pitch: Math.min(Math.max(v.tilt, 0), 90) - 90,
        heading: v.heading,
      },
      { duration },
    )
  } else {
    void view.flyTo(
      {
        lng: v.longitude,
        lat: v.latitude,
        height: v.altitude,
        pitch: Math.min(Math.max(v.tilt, 0), 180) - 90,
        heading: v.heading,
        roll: v.roll,
      },
      { duration },
    )
  }
}

/** 範囲全体が収まる高さ（FOV 約 60° を想定した目安）で真上気味に寄る */
export function flyToNavaraBounds(view: View, bounds: [number, number, number, number], duration: number): void {
  const [w, s, e, n] = bounds
  const lat = (s + n) / 2
  const dx = (e - w) * 111_320 * Math.cos((lat * Math.PI) / 180)
  const dy = (n - s) * 110_540
  const height = Math.min(Math.max(Math.max(dx, dy) * 1.6, 300), 2e7)
  void view.flyTo({ lng: (w + e) / 2, lat, height, pitch: -90, heading: 0 }, { duration })
}
