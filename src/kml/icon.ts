import type { HotSpot } from './types'
import { KML_ICON_BASE_PX } from './style'

export interface IconSize {
  /** 画像の自然サイズ（px） */
  width: number
  height: number
}

/**
 * hotSpot を「画像の左端/下端からの割合」（0..1）へ直す。
 * KML の既定（hotSpot 省略）は画像の中心。units:
 * - fraction: そのまま（左/下から）
 * - pixels: 左/下からの px
 * - insetPixels: 右/上からの px
 */
export function hotSpotFraction(hs: HotSpot | undefined, size: IconSize): { fx: number; fy: number } {
  if (!hs) return { fx: 0.5, fy: 0.5 }
  const conv = (v: number, units: HotSpot['xunits'], len: number) =>
    units === 'pixels' ? v / len : units === 'insetPixels' ? (len - v) / len : v
  return { fx: conv(hs.x, hs.xunits, size.width), fy: conv(hs.y, hs.yunits, size.height) }
}

export interface IconPlacement {
  /** 表示サイズ（px）。KML は scale=1 で幅 32px とし、縦横比は画像のまま */
  displayWidth: number
  displayHeight: number
  /** icon-size 相当（自然サイズに掛ける倍率） */
  sizeRatio: number
  /** 画像中心を座標からずらす量（自然 px、右・下が正）。hotSpot を座標に合わせるため */
  offsetX: number
  offsetY: number
  /** 座標（hotSpot）からアイコン下端までの距離（表示 px、下向き正）。ラベルをこの下に置く */
  belowPx: number
}

export function iconPlacement(size: IconSize, scale: number, hotSpot: HotSpot | undefined): IconPlacement {
  const { fx, fy } = hotSpotFraction(hotSpot, size)
  const sizeRatio = (KML_ICON_BASE_PX * scale) / size.width
  const displayHeight = size.height * sizeRatio
  return {
    displayWidth: KML_ICON_BASE_PX * scale,
    displayHeight,
    sizeRatio,
    offsetX: (0.5 - fx) * size.width,
    offsetY: (fy - 0.5) * size.height,
    // 下端は hotSpot から fy*高さ だけ下。上に突き出す（fy<0 は無い想定）場合も 0 未満にはしない
    belowPx: Math.max(fy * displayHeight, 0),
  }
}

const sizeCache = new Map<string, Promise<IconSize | null>>()

/** アイコン画像の自然サイズを取得する（ブラウザ）。取得できなければ null。結果は URL ごとにキャッシュ */
export function loadIconSize(href: string): Promise<IconSize | null> {
  let p = sizeCache.get(href)
  if (!p) {
    p = new Promise<IconSize | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
      img.onerror = () => resolve(null)
      img.src = href
    })
    sizeCache.set(href, p)
  }
  return p
}
