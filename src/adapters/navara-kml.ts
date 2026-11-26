import type ThreeView from '@navaramap/three'
import { Color, fetchFontFamilyFromCss, type FeatureEvaluator, type Source } from '@navaramap/three'
import type { DefaultDescriptions } from '@navaramap/three-default-plugin'
import { kmlToGeoJson, geoJsonBounds } from './maplibre-kml'
import { KML_ICON_BASE_PX } from '../kml/style'
import { findInitialView } from '../kml/camera'
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

export interface NavaraKml {
  source: Source
  layerId: string
  /** [west, south, east, north] */
  bounds: [number, number, number, number] | undefined
  /** 文書の LookAt / Camera。あれば範囲より優先して飛ぶ */
  view: AbstractView | undefined
}

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
  const source = view.addSource({ type: 'geojson', data: fc })
  const layer = view.addLayer({
    type: 'vector',
    source,
    polygon: { clampToGround: true, transparent: true, outline: false },
    polyline: { clampToGround: true, transparent: true, width: 2 },
    text: {
      font: FONT_FAMILY,
      lang: 'ja',
      clampToGround: true,
      depthTest: false,
      sizeInMeters: false,
      size: 18,
      declutter: false,
      color: new Color().setStyle('#ffffff'),
      outlineColor: new Color().setStyle('#000000'),
      outlineOpacity: 1,
      outlineWidth: 4,
      opacity: 1,
    },
    // アイコン付きの点は billboard で描く（url は評価で上書き。円の point は評価で隠す）
    billboard: { clampToGround: true, sizeInMeters: false, depthTest: false, size: KML_ICON_BASE_PX, declutter: false, transparent: true },
    point: { clampToGround: true, sizeInMeters: false, depthTest: false, size: 12, color: new Color().setStyle('#ffd400') },
  })

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
            ? { show: true, image: href, size: KML_ICON_BASE_PX * numv(props.iconScale, 1) }
            : { show: false }
        }
        case 'text':
          return { text: str(props.name, ''), opacity: 1, show: str(props.name, '') !== '' }
        default:
          return {}
      }
    })
  layer.on('featureCreated', ({ evaluator }) => style(evaluator))

  const b = geoJsonBounds(fc) as [[number, number], [number, number]] | undefined
  return { source, layerId: layer.id, view: findInitialView(doc), bounds: b ? [b[0][0], b[0][1], b[1][0], b[1][1]] : undefined }
}

export function removeKmlFromNavara(view: View, k: NavaraKml): void {
  // レイヤーが参照している間はソースを消せないので順序を守る
  view.deleteLayerById(k.layerId)
  k.source.delete()
}

/**
 * 文書の視点があればそこへ、無ければ範囲全体へ飛ぶ。
 * LookAt は Navara の distance（注視点からカメラ前方へ range 離れる）にそのまま対応する。
 * pitch は水平=0・真下=-90 なので tilt - 90。
 */
export function flyToNavaraKml(view: View, k: NavaraKml, duration: number): void {
  const v = k.view
  if (v?.kind === 'LookAt') {
    const tilt = Math.min(Math.max(v.tilt, 0), 90)
    void view.flyTo(
      {
        lng: v.longitude,
        lat: v.latitude,
        height: v.altitudeMode === 'clampToGround' ? 0 : v.altitude,
        distance: v.range,
        pitch: tilt - 90,
        heading: v.heading,
      },
      { duration },
    )
  } else if (v?.kind === 'Camera') {
    void view.flyTo(
      {
        lng: v.longitude,
        lat: v.latitude,
        height: v.altitudeMode === 'clampToGround' ? 0 : v.altitude,
        pitch: Math.min(Math.max(v.tilt, 0), 180) - 90,
        heading: v.heading,
        roll: v.roll,
      },
      { duration },
    )
  } else if (k.bounds) {
    flyToNavaraBounds(view, k.bounds, duration)
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
