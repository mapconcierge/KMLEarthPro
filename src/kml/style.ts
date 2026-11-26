import type { Feature, KmlDocument, Style } from './types'

/** Feature の styleUrl / インライン Style を解決する（StyleMap は normal 側）。外部 URL は未対応 */
export function resolveStyle(doc: KmlDocument, f: Feature): Style | undefined {
  if (f.style) return f.style
  if (!f.styleUrl?.startsWith('#')) return undefined
  const id = f.styleUrl.slice(1)
  const sm = doc.styleMaps[id]
  if (sm) {
    const n = sm.pairs.normal
    if (typeof n !== 'string') return n
    return n.startsWith('#') ? doc.styles[n.slice(1)] : undefined
  }
  return doc.styles[id]
}

/**
 * IconStyle の href を、描画に使える URL へ解決する。
 * - http(s) / data / blob はそのまま
 * - それ以外は KMZ 同梱リソース（相対パス）として resources から引く
 * 解決できなければ undefined（呼び出し側は円で代用する）
 */
export function resolveIconHref(
  href: string | undefined,
  resources: Record<string, string> | undefined,
): string | undefined {
  if (!href) return undefined
  if (/^(https?:|data:|blob:)/i.test(href)) return href
  const key = decodeURIComponent(href).replace(/^\.\//, '').replace(/^\/+/, '')
  return resources?.[key]
}

/** KML 既定のアイコン寸法（px）。scale=1 でこの大きさに描く */
export const KML_ICON_BASE_PX = 32
