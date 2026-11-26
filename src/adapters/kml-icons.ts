import type { FeatureCollection } from 'geojson'
import { hotSpotFraction, iconPlacement, loadIconSize } from '../kml/icon'
import type { HotSpot } from '../kml/types'
import { needsTint, tintIcon } from './icon-tint'

/** 同じ配置（画像中心のずらし量・ラベル位置）を持つアイコン点のまとまり */
export interface IconGroup {
  key: string
  /** 画像中心を座標からずらす量（自然 px、右・下が正） */
  offsetX: number
  offsetY: number
  /** 座標（hotSpot）からアイコン下端までの表示 px。ラベルはこの下に置く */
  belowPx: number
  /** スプライト上のアンカー（-0.5..0.5、中心が 0・右/上が正）。hotSpot の割合 - 0.5 */
  anchorX: number
  anchorY: number
}

interface IconProps {
  iconHref?: string
  /** IconStyle の color（乗算色）。無ければ着色しない */
  iconColor?: string
  iconOpacity?: number
  iconScale?: number
  hotX?: number
  hotY?: number
  hotXu?: string
  hotYu?: string
  iconGroup?: string
  iconSizeRatio?: number
  iconDisplayHeight?: number
}

/**
 * アイコン付きの点について、画像サイズを取得して配置（hotSpot・ラベル位置）を決め、
 * 各フィーチャのプロパティへ iconGroup / iconSizeRatio を書き込む（fc を破壊的に更新する）。
 * 画像サイズが取れない点は iconHref を空にして、呼び出し側が円で描くようにする。
 * MapLibre / Navara で共通に使う。
 */
export async function prepareIcons(fc: FeatureCollection): Promise<Map<string, IconGroup>> {
  const groups = new Map<string, IconGroup>()
  // IconStyle の color を画像へ乗算する。着色済み画像の URL に差し替える（取れなければ元画像のまま）
  await Promise.all(
    fc.features.map(async (f) => {
      const p = f.properties as IconProps
      if (p.iconHref && p.iconColor && needsTint(p.iconColor, p.iconOpacity ?? 1)) {
        p.iconHref = (await tintIcon(p.iconHref, p.iconColor, p.iconOpacity ?? 1)) ?? p.iconHref
      }
    }),
  )
  const hrefs = new Set<string>()
  for (const f of fc.features) {
    const h = (f.properties as IconProps).iconHref
    if (h) hrefs.add(h)
  }
  const sizes = new Map(await Promise.all([...hrefs].map(async (h) => [h, await loadIconSize(h)] as const)))

  for (const f of fc.features) {
    const p = f.properties as IconProps
    if (!p.iconHref) continue
    const size = sizes.get(p.iconHref)
    if (!size) {
      p.iconHref = ''
      continue
    }
    const hs: HotSpot | undefined = p.hotXu
      ? { x: p.hotX ?? 0.5, y: p.hotY ?? 0.5, xunits: p.hotXu as HotSpot['xunits'], yunits: (p.hotYu ?? 'fraction') as HotSpot['yunits'] }
      : undefined
    const pl = iconPlacement(size, p.iconScale ?? 1, hs)
    const key = `${pl.offsetX.toFixed(1)}|${pl.offsetY.toFixed(1)}|${pl.belowPx.toFixed(0)}`
    p.iconGroup = key
    p.iconSizeRatio = pl.sizeRatio
    p.iconDisplayHeight = pl.displayHeight
    if (!groups.has(key)) {
      const { fx, fy } = hotSpotFraction(hs, size)
      groups.set(key, { key, offsetX: pl.offsetX, offsetY: pl.offsetY, belowPx: pl.belowPx, anchorX: fx - 0.5, anchorY: fy - 0.5 })
    }
  }
  return groups
}
