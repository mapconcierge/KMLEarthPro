// IconStyle の color は「画像に乗算する色」（KML 2.3）。MapLibre / Navara は画像の着色を
// データ駆動で持てないので、乗算済みの画像を canvas で作って data URL として使う。
// CORS で画像が読めない（canvas が汚染される）場合は null を返し、呼び出し側は元画像のまま描く。

import { upgradeInsecureUrl } from '../kml/style'

const cache = new Map<string, Promise<string | null>>()

/** 色（#rrggbb）が白で不透明なら乗算しても変わらないので着色不要 */
export const needsTint = (hex: string, opacity: number) => hex.toLowerCase() !== '#ffffff' || opacity < 1

export function tintIcon(href: string, hex: string, opacity: number): Promise<string | null> {
  const key = `${href}|${hex}|${opacity}`
  let p = cache.get(key)
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const w = img.naturalWidth
          const h = img.naturalHeight
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const g = c.getContext('2d')
          if (!g || w === 0) return resolve(null)
          g.drawImage(img, 0, 0)
          // 乗算 → 元の透明部分を戻す（multiply は不透明な色で透明部分も塗ってしまうため）
          g.globalCompositeOperation = 'multiply'
          g.fillStyle = hex
          g.fillRect(0, 0, w, h)
          g.globalCompositeOperation = 'destination-in'
          g.drawImage(img, 0, 0)
          if (opacity < 1) {
            const c2 = document.createElement('canvas')
            c2.width = w
            c2.height = h
            const g2 = c2.getContext('2d')!
            g2.globalAlpha = opacity
            g2.drawImage(c, 0, 0)
            return resolve(c2.toDataURL('image/png'))
          }
          resolve(c.toDataURL('image/png'))
        } catch {
          resolve(null) // canvas 汚染（SecurityError）など
        }
      }
      img.onerror = () => resolve(null)
      img.src = upgradeInsecureUrl(href, globalThis.location?.protocol)
    })
    cache.set(key, p)
  }
  return p
}
