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
