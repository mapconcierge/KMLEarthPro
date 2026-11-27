import { upgradeInsecureUrl } from './style'
import { childrenOf, type Feature, type KmlDocument, type Link, type NetworkLink } from './types'
import type { FeaturePath } from './target'

// NetworkLink の解決・更新まわりの純関数（取得そのものは linkManager.ts）。

/** リンク先を相対解決するときの基準。URL から取得した文書は url、KMZ 内の文書は dir（アーカイブ内のディレクトリ。ルートは ''） */
export interface LinkBase {
  url?: string
  dir?: string
}

export type ResolvedHref =
  | { kind: 'url'; url: string }
  | { kind: 'file'; name: string }
  | { kind: 'unresolved'; reason: string }

/** 'a/./b/../c.kml' → 'a/c.kml'。アーカイブの外（先頭を超える ..）へは出られない（undefined） */
export function normalizeArchivePath(p: string): string | undefined {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return undefined
      out.pop()
    } else out.push(seg)
  }
  return out.join('/')
}

/**
 * href の指す先を決める。
 * - http(s) の絶対 URL: そのまま（https のページでは http を https へ直す）
 * - 相対: 基準が URL ならそれに対して解決、KMZ 内の文書なら同梱ファイルから（files に在るものだけ）
 * - それ以外（file: や、基準の無い相対パスなど）は解決不能として理由を返す
 */
export function resolveHref(
  href: string,
  base: LinkBase,
  files: Record<string, unknown> | undefined,
  pageProtocol: string | undefined,
): ResolvedHref {
  const h = href.trim()
  if (h === '') return { kind: 'unresolved', reason: 'href が空です' }
  if (/^https?:\/\//i.test(h)) return { kind: 'url', url: upgradeInsecureUrl(h, pageProtocol) }
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return { kind: 'unresolved', reason: `未対応のスキームです: ${h.split(':')[0]}:` }
  // 相対参照。フラグメントとクエリは同梱ファイル名には含めない
  if (base.url) {
    try {
      return { kind: 'url', url: upgradeInsecureUrl(new URL(h, base.url).href, pageProtocol) }
    } catch {
      return { kind: 'unresolved', reason: `URL として解決できません: ${h}` }
    }
  }
  if (base.dir !== undefined) {
    const name = normalizeArchivePath(`${base.dir ?? ''}${base.dir ? '/' : ''}${decodeURIComponent(h.replace(/[?#].*$/, ''))}`)
    if (name !== undefined && files && name in files) return { kind: 'file', name }
    return { kind: 'unresolved', reason: `KMZ 内に ${h} がありません` }
  }
  return { kind: 'unresolved', reason: '相対パスの基準がありません（ドロップした単体の KML では、相対参照を解決できません）' }
}

/** httpQuery / viewFormat の [clientName] などを置き換える。表示範囲の値（[bboxWest] 等）は view があるときだけ */
export interface QueryContext {
  clientName: string
  clientVersion: string
  language: string
  view?: { west: number; south: number; east: number; north: number }
}

export function substituteQuery(template: string, ctx: QueryContext): string {
  const v = ctx.view
  const table: Record<string, string | undefined> = {
    clientName: ctx.clientName,
    clientVersion: ctx.clientVersion,
    kmlVersion: '2.2',
    language: ctx.language,
    bboxWest: v && String(v.west),
    bboxSouth: v && String(v.south),
    bboxEast: v && String(v.east),
    bboxNorth: v && String(v.north),
  }
  // 値の無いパラメータはそのまま残す（サーバーに未置換だと分かるように）
  return template.replace(/\[(\w+)\]/g, (m, k: string) => table[k] ?? m)
}

/** href に httpQuery（と、viewFormat）を付けた URL。既に ? があれば & で連結する */
export function buildLinkUrl(url: string, link: Link, ctx: QueryContext, withView: boolean): string {
  const parts = [link.httpQuery, withView ? link.viewFormat : undefined]
    .filter((x): x is string => !!x && x.trim() !== '')
    .map((t) => substituteQuery(t.trim().replace(/^[?&]/, ''), ctx))
  if (parts.length === 0) return url
  const hash = url.indexOf('#')
  const base = hash >= 0 ? url.slice(0, hash) : url
  const frag = hash >= 0 ? url.slice(hash) : ''
  return `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}${frag}`
}

/** 次回の取得までのミリ秒。更新しない（onChange / never / 期限情報なし）なら undefined */
export function nextRefreshDelayMs(
  link: Link,
  headers: { cacheControl?: string | null; expires?: string | null; date?: string | null } = {},
  now = Date.now(),
): number | undefined {
  const mode = link.refreshMode ?? 'onChange'
  if (mode === 'onInterval') {
    const sec = link.refreshInterval !== undefined && link.refreshInterval > 0 ? link.refreshInterval : 4
    return Math.max(sec, 1) * 1000 // 仕様の既定は 4 秒。サーバーを叩きすぎないよう下限は 1 秒
  }
  if (mode === 'onExpire') {
    const m = /max-age\s*=\s*(\d+)/i.exec(headers.cacheControl ?? '')
    if (m) return Math.max(Number(m[1]), 1) * 1000
    const exp = headers.expires ? Date.parse(headers.expires) : NaN
    if (Number.isFinite(exp)) return Math.max(exp - now, 1000)
    return undefined
  }
  return undefined
}

export interface FoundLink {
  path: FeaturePath
  feature: NetworkLink
}

/**
 * 文書内の NetworkLink（有効なもの）を列挙する。visibility=0 の NetworkLink や、非表示のフォルダ配下は
 * 取得しない（Google Earth でチェックを外した NetworkLink が読み込まれないのと同じ）
 */
export function findNetworkLinks(doc: KmlDocument): FoundLink[] {
  const out: FoundLink[] = []
  const walk = (f: Feature, path: FeaturePath) => {
    if (!f.visibility) return
    if (f.kind === 'NetworkLink') {
      if (f.link?.href) out.push({ path, feature: f })
      return
    }
    childrenOf(f).forEach((c, i) => walk(c, [...path, i]))
  }
  walk(doc.root, [])
  return out
}
