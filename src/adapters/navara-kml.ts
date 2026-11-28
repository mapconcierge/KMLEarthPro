import type ThreeView from '@navaramap/three'
import { Color, fetchFontFamilyFromCss, type FeatureEvaluator, type Source } from '@navaramap/three'
import type { DefaultDescriptions } from '@navaramap/three-default-plugin'
import type { FeatureCollection } from 'geojson'
import { kmlToGeoJson } from './maplibre-kml'
import { prepareIcons } from './kml-icons'
import { KML_ICON_BASE_PX } from '../kml/style'
import { resolveAbsoluteView, type ElevationSampler } from '../kml/camera'
import type { AbstractView, KmlDocument } from '../kml/types'

// Navara(3D) では GeoJSON ソース + vector レイヤで描き、色・幅・ラベルは
// FeatureEvaluator でフィーチャのプロパティから当てる（2D と同じ変換結果を共有）。
// アイコン画像は billboard（FeatureEvaluator の image でフィーチャごとに指定）。取れない/無い点は円。
// 高度: resolveAltitudes で楕円体高へ直した relativeToGround / absolute は、地表に貼らず浮かせる（extrude は角柱・落とし線で近似）。
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
  /** 再評価（Region による表示切替）のために保持する */
  layer?: { forceUpdate(): void }
}

export interface NavaraKml {
  /** 通常のフィーチャ用 1 つ + アイコン配置（hotSpot）グループごとに 1 つ */
  parts: NavaraPart[]
  /** Region（Lod）で見える Placemark の kmlPath。null なら全部見せる */
  visibleKeys?: Set<string> | null
}

/**
 * Region（Lod）による表示切替を適用する。見える Placemark の kmlPath の集合（null で全表示）を渡すと、
 * 各レイヤのフィーチャを再評価して show を切り替える（データの入れ直しはしない）
 */
export function setNavaraVisibleKeys(k: NavaraKml, keys: Set<string> | null): void {
  k.visibleKeys = keys
  for (const part of k.parts) part.layer?.forceUpdate()
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
  const fc = kmlToGeoJson(doc, resources, { altitude: true })
  const groups = await prepareIcons(fc)

  // Navara の billboard / text の center（アンカー）はレイヤ単位で、フィーチャごとには変えられない。
  // そこで、hotSpot とラベル位置が同じアイコン点（iconGroup）ごとにソースとレイヤを分ける。
  // 高度（resolveAltitudes で楕円体高へ直したもの）を持つフィーチャは、地表に貼らない別レイヤにする。
  // 角柱（prism: extrude した面・壁）は、さらに別レイヤ（height / extrudedHeight をフィーチャごとに当てる）
  type P = { iconGroup?: string; elevated?: boolean; prism?: boolean }
  const featuresOf = (pred: (group: string | undefined) => boolean, kind: 'ground' | 'elevated' | 'prism' = 'ground'): FeatureCollection => ({
    type: 'FeatureCollection',
    features: fc.features.filter((f) => {
      const p = f.properties as P
      const k = p.prism ? 'prism' : p.elevated ? 'elevated' : 'ground'
      return k === kind && pred(p.iconGroup)
    }),
  })
  const parts: NavaraPart[] = []
  const result: NavaraKml = { parts, visibleKeys: null }
  const addPart = (data: FeatureCollection, materials: Record<string, unknown>) => {
    const source = view.addSource({ type: 'geojson', data })
    const layer = view.addLayer({ type: 'vector', source, ...materials } as never)
    layer.on('featureCreated', ({ evaluator }) => style(evaluator))
    // Region による表示切替で forceUpdate されたとき、同じ評価をやり直す
    layer.on('featureUpdated', ({ evaluator }) => style(evaluator))
    parts.push({ source, layerId: layer.id, layer })
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

  // 地表に貼る（ground）か、高度どおりに浮かせる（elevated）か
  for (const kind of ['ground', 'elevated'] as const) {
    const clamp = kind === 'ground'
    // 通常のフィーチャ（面・線・アイコン無しの点）。ラベルは円の直下
    addPart(featuresOf((g) => g === undefined, kind), {
      polygon: clamp
        ? { clampToGround: true, transparent: true, outline: false }
        : { clampToGround: false, perPositionHeight: true, transparent: true, outline: false },
      polyline: { clampToGround: clamp, transparent: true, width: 2 },
      point: { clampToGround: clamp, sizeInMeters: false, depthTest: false, size: 12, color: new Color().setStyle('#ffd400') },
      text: { ...labelMaterial(POINT_RADIUS_PX + LABEL_GAP_PX), clampToGround: clamp },
    })
    // アイコン付きの点（グループごと）
    for (const g of groups.values()) {
      addPart(featuresOf((k) => k === g.key, kind), {
        billboard: {
          clampToGround: clamp,
          sizeInMeters: false,
          depthTest: false,
          size: KML_ICON_BASE_PX,
          declutter: false,
          transparent: true,
          center: { x: g.anchorX, y: g.anchorY },
        },
        // 同じ点は円（point）も生成されるが、評価で隠す。ラベルはアイコン下端の直下
        point: { clampToGround: clamp, sizeInMeters: false, depthTest: false, size: 12, color: new Color().setStyle('#ffd400') },
        text: { ...labelMaterial(g.belowPx + LABEL_GAP_PX), clampToGround: clamp },
      })
    }
  }
  // extrude した面・壁（角柱）。底面と上面の楕円体高をフィーチャごとに当てる
  addPart(featuresOf((g) => g === undefined, 'prism'), {
    polygon: { clampToGround: false, transparent: true, outline: false },
  })

  const style = (e: FeatureEvaluator) =>
    e.evaluate(({ properties: p, meshGeomType }) => {
      const props = p ?? {}
      // Region（Lod）で非表示の Placemark は、どの種類のメッシュでも隠す
      const keys = result.visibleKeys
      const inRegion = !keys || keys.has(str(props.kmlPath, ''))
      switch (meshGeomType) {
        case 'polygon': {
          const base = { color: new Color().setStyle(str(props.fillColor, '#ffffff')), opacity: numv(props.fillOpacity, 1), show: inRegion }
          // 角柱（extrude）は、底面と上面の楕円体高を当てる
          return props.prism === true ? { ...base, height: numv(props.baseHeight, 0), extrudedHeight: numv(props.topHeight, 0) } : base
        }
        case 'polyline':
          // 浮かせる線は、1 本ごとに高さが 1 つ（頂点の高さは使われない）。lineHeight を当てる
          return {
            color: new Color().setStyle(str(props.lineColor, '#ffffff')),
            opacity: numv(props.lineOpacity, 1),
            width: numv(props.lineWidth, 1),
            show: inRegion,
            ...(typeof props.lineHeight === 'number' ? { height: props.lineHeight } : {}),
          }
        case 'point': {
          // アイコン画像のある点は billboard 側で描くので円は隠す
          const hasIcon = str(props.iconHref, '') !== ''
          return { color: new Color().setStyle(str(props.pointColor, '#ffd400')), opacity: numv(props.pointOpacity, 1), show: !hasIcon && inRegion }
        }
        case 'billboard': {
          const href = str(props.iconHref, '')
          return href
            // Navara の billboard の size は「高さ」（幅は画像の縦横比で決まる）。MapLibre と大きさを揃える
            ? { show: inRegion, image: href, size: numv(props.iconDisplayHeight, KML_ICON_BASE_PX * numv(props.iconScale, 1)) }
            : { show: false }
        }
        case 'text': {
          // 先頭の空行で、座標（hotSpot）より下へずらす（labelMaterial のコメント参照）。
          // 名前の改行は、空行の高さ調整が崩れないよう空白にする
          const name = str(props.name, '').replace(/\s*[\r\n]+\s*/g, ' ')
          // LabelStyle: 色・不透明度・scale。縁取り色は Navara ではフィーチャ単位に変えられず黒固定
          return {
            text: name === '' ? '' : `\n${name}`,
            color: new Color().setStyle(str(props.labelColor, '#ffffff')),
            opacity: numv(props.labelOpacity, 1),
            size: LABEL_SIZE_PX * numv(props.labelScale, 1),
            show: name !== '' && inRegion,
          }
        }
        default:
          return {}
      }
    })

  return result
}

/**
 * 選択中の Placemark（kmlPath の一覧）を強調する別レイヤを作る。呼び出し側が前のものを
 * removeKmlFromNavara で消してから呼ぶ。対象が無ければ null
 */
export function addNavaraHighlight(view: View, doc: KmlDocument, keys: string[]): NavaraKml | null {
  const set = new Set(keys)
  const features = kmlToGeoJson(doc).features.filter((f) => set.has(String((f.properties as { kmlPath?: string }).kmlPath)))
  if (features.length === 0) return null
  const HL = new Color().setStyle('#00e5ff')
  const source = view.addSource({ type: 'geojson', data: { type: 'FeatureCollection', features } })
  const layer = view.addLayer({
    type: 'vector',
    source,
    polygon: { clampToGround: true, transparent: true, outline: false, color: HL, opacity: 0.35 },
    polyline: { clampToGround: true, transparent: true, width: 6, color: HL, opacity: 0.9 },
    point: { clampToGround: true, sizeInMeters: false, depthTest: false, size: 30, color: HL, opacity: 0.45 },
  } as never)
  return { parts: [{ source, layerId: layer.id }] }
}

export function removeKmlFromNavara(view: View, k: NavaraKml): void {
  // レイヤーが参照している間はソースを消せないので順序を守る
  for (const part of k.parts) {
    view.deleteLayerById(part.layerId)
    part.source.delete()
  }
}

/**
 * 視点（LookAt / Camera。範囲しか無い場合も呼び出し側が resolveFlyView で LookAt にしてある）へ飛ぶ。
 * 標高は view.sampleTerrainMostDetailed（呼び出し側が sample として渡す）で引く。
 * LookAt は Navara の distance（注視点からカメラ前方へ range 離れる）にそのまま対応する。
 * pitch は水平=0・真下=-90 なので tilt - 90。
 */
export async function flyToNavaraView(
  view: View,
  target: AbstractView,
  duration: number,
  sample: ElevationSampler,
): Promise<void> {
  // altitudeMode に応じて地形標高を足し、絶対高度へ直してから飛ぶ
  const v = await resolveAbsoluteView(target, sample)
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
