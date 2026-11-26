import type { KmlColor } from './types'

/** KML の色 aabbggrr（16進8桁）を CSS の #rrggbb と不透明度へ変換する。不正値は undefined */
export function parseKmlColor(value: string | undefined | null): KmlColor | undefined {
  const s = value?.trim().toLowerCase()
  if (!s || !/^[0-9a-f]{8}$/.test(s)) return undefined
  const a = parseInt(s.slice(0, 2), 16)
  const b = s.slice(2, 4)
  const g = s.slice(4, 6)
  const r = s.slice(6, 8)
  return { hex: `#${r}${g}${b}`, opacity: Math.round((a / 255) * 1000) / 1000 }
}

/** parseKmlColor の逆変換 */
export function formatKmlColor(color: KmlColor): string {
  const a = Math.round(color.opacity * 255)
    .toString(16)
    .padStart(2, '0')
  const r = color.hex.slice(1, 3)
  const g = color.hex.slice(3, 5)
  const b = color.hex.slice(5, 7)
  return `${a}${b}${g}${r}`
}
