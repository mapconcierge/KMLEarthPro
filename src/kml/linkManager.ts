import { useKmlStore, linkKey, type KmlEntry } from '../store/kmlStore'
import { readKmlFile } from './kmz'
import { buildLinkUrl, findNetworkLinks, nextRefreshDelayMs, normalizeArchivePath, resolveHref, type FoundLink, type LinkBase } from './networkLink'
import { parseKml } from './parse'
import { validateKmlSemantics } from './validate'

// NetworkLink の取得・更新を行う。取得した文書は「派生エントリ」として kmlStore へ積み、
// MapLibre / Navara は既存の購読（syncKml）でそのまま描画する。Cesium は自前の NetworkLink 処理があり、
// 派生エントリには file が無いので二重には描かない。

/** NetworkLink をたどる最大の深さ（循環参照・暴走の打ち切り） */
const MAX_DEPTH = 5
/** 取得する KML/KMZ の上限サイズ */
const MAX_BYTES = 50 * 1024 * 1024
/** 1 回の取得のタイムアウト */
const FETCH_TIMEOUT_MS = 30_000

interface Controller {
  /** 担当する NetworkLink */
  link: FoundLink
  entryId: string
  timer?: ReturnType<typeof setTimeout>
  abort?: AbortController
  /** 現在の派生エントリ（更新のたびに作り替える） */
  derivedId?: string
  /** 停止済みなら true（非同期の取得が戻ってきても何もしない） */
  stopped: boolean
}

const controllers = new Map<string, Controller>()

const clientContext = () => ({
  clientName: 'KMLEarthPro',
  clientVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0',
  language: globalThis.navigator?.language ?? 'en',
})

/** エントリとその子孫（派生エントリ）をすべて取り除く */
export function removeEntryTree(id: string): void {
  const { entries, remove } = useKmlStore.getState()
  const descendants = (pid: string): string[] =>
    entries.filter((e) => e.parent?.id === pid).flatMap((e) => [e.id, ...descendants(e.id)])
  for (const d of descendants(id)) remove(d)
  remove(id)
}

async function fetchResource(
  url: string,
  signal: AbortSignal,
): Promise<{ file: File; headers: { cacheControl: string | null; expires: string | null } }> {
  const res = await fetch(url, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim())
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > MAX_BYTES) throw new Error(`サイズが大きすぎます（${Math.round(len / 1048576)} MB）`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error(`サイズが大きすぎます（${Math.round(buf.byteLength / 1048576)} MB）`)
  const last = new URL(url).pathname.split('/').pop() || 'link.kml'
  return {
    file: new File([buf], last),
    headers: { cacheControl: res.headers.get('cache-control'), expires: res.headers.get('expires') },
  }
}

/** 1 つの NetworkLink を取得して派生エントリを作る。更新の予約もここで行う */
async function load(c: Controller, first: boolean): Promise<void> {
  const store = useKmlStore.getState()
  const parent = store.entries.find((e) => e.id === c.entryId)
  const key = linkKey(c.entryId, c.link.path)
  const link = c.link.feature.link
  if (!parent || !link?.href || c.stopped) return

  const depth = (parent.depth ?? 0) + 1
  const prev = store.links[key]
  store.setLink(key, { ...prev, status: 'loading' })
  c.abort = new AbortController()
  const timeout = setTimeout(() => c.abort?.abort(), FETCH_TIMEOUT_MS)
  try {
    if (depth > MAX_DEPTH) throw new Error(`NetworkLink のたどり深さが上限（${MAX_DEPTH}）を超えました（循環参照の可能性）`)
    const target = resolveHref(link.href, parent.base ?? {}, parent.files, globalThis.location?.protocol)
    if (target.kind === 'unresolved') throw new Error(target.reason)
    // 循環参照: 自分の祖先と同じ取得元をたどろうとしたら止める
    const source = target.kind === 'url' ? target.url.replace(/[?#].*$/, '') : `file:${target.name}`
    const all = store.entries
    for (let a: KmlEntry | undefined = parent; a; a = a.parent ? all.find((e) => e.id === a!.parent!.id) : undefined) {
      if (a.source === source) throw new Error(`循環参照です（${link.href} は、すでにたどっている文書を参照しています）`)
    }

    let file: File
    let headers: { cacheControl: string | null; expires: string | null } = { cacheControl: null, expires: null }
    let base: LinkBase
    if (target.kind === 'file') {
      const bytes = parent.files?.[target.name]
      if (!bytes) throw new Error(`KMZ 内に ${target.name} がありません`)
      file = new File([bytes as BlobPart], target.name.split('/').pop() ?? 'link.kml')
      // 入れ子の KML の相対参照は、そのファイルのあるディレクトリから
      const dir = target.name.includes('/') ? normalizeArchivePath(target.name.replace(/\/[^/]*$/, '')) : ''
      base = { dir: dir ?? '' }
    } else {
      // 表示範囲の置換（viewFormat）は段階 3。ここでは httpQuery だけ付ける
      const url = buildLinkUrl(target.url, link, clientContext(), false)
      const r = await fetchResource(url, c.abort.signal)
      file = r.file
      headers = r.headers
      base = { url: target.url }
    }

    const { kml, resources, files } = await readKmlFile(file)
    // 取得した KMZ（同梱ファイルがある）の相対参照は、その KMZ の中から解決する
    const inArchive = target.kind === 'file' || Object.keys(files).length > 0 || /\.kmz$/i.test(file.name)
    const doc = parseKml(kml)
    const issues = validateKmlSemantics(kml)
    if (issues.length) console.warn(`[NetworkLink] ${link.href}: 仕様の検査で ${issues.length} 件`, issues.map((i) => `${i.rule} ${i.message}`))
    if (c.stopped || !useKmlStore.getState().entries.some((e) => e.id === c.entryId)) return

    // 更新: 古い派生エントリ（と、その先の NetworkLink）を捨てて作り直す
    if (c.derivedId) removeEntryTree(c.derivedId)
    const derived: KmlEntry = {
      id: crypto.randomUUID(),
      name: doc.root.name ?? c.link.feature.name ?? link.href,
      status: 'loaded',
      doc,
      resources,
      // 同じ KMZ の中から読んだ文書は、その KMZ の同梱ファイルを共有する
      files: target.kind === 'file' ? parent.files : files,
      base: inArchive ? { dir: base.dir ?? '' } : base,
      source,
      parent: { id: c.entryId, path: c.link.path },
      // flyToView は NetworkLink を有効にしたとき（最初の 1 回）だけ
      autoFly: first && c.link.feature.flyToView,
      depth,
    }
    c.derivedId = derived.id
    useKmlStore.getState().add(derived)
    useKmlStore.getState().setLink(key, { status: 'loaded', fetchedAt: Date.now(), derivedId: derived.id })

    const delay = nextRefreshDelayMs(link, headers)
    if (delay !== undefined && !c.stopped) c.timer = setTimeout(() => void load(c, false), delay)
  } catch (err: unknown) {
    if (c.stopped) return
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    const msg = aborted ? `タイムアウト（${FETCH_TIMEOUT_MS / 1000} 秒）` : err instanceof Error ? err.message : String(err)
    // fetch の失敗理由は CORS・ネットワーク断・混在コンテンツなどでブラウザが区別して教えない
    const hint = err instanceof TypeError ? '（取得できませんでした。相手のサーバーが CORS を許可していない、またはネットワークの問題の可能性があります）' : ''
    console.warn(`[NetworkLink] ${link.href}: ${msg}${hint}`)
    useKmlStore.getState().setLink(key, { ...useKmlStore.getState().links[key], status: 'error', message: `${msg}${hint}` })
    // 更新モードなら失敗しても次の周期でやり直す
    const delay = nextRefreshDelayMs(link)
    if (delay !== undefined) c.timer = setTimeout(() => void load(c, false), delay)
  } finally {
    clearTimeout(timeout)
  }
}

function stop(key: string): void {
  const c = controllers.get(key)
  if (!c) return
  c.stopped = true
  clearTimeout(c.timer)
  c.abort?.abort()
  controllers.delete(key)
  useKmlStore.getState().setLink(key, null)
  if (c.derivedId) removeEntryTree(c.derivedId)
}

const linksOfDoc = new WeakMap<object, FoundLink[]>()

/** kmlStore を購読し、文書に含まれる NetworkLink の取得を開始・停止する。アプリ起動時に 1 度だけ呼ぶ */
export function startNetworkLinks(): () => void {
  const sync = () => {
    const entries = useKmlStore.getState().entries
    const alive = new Set<string>()
    for (const e of entries) {
      if (!e.doc) continue
      let found = linksOfDoc.get(e.doc)
      if (!found) linksOfDoc.set(e.doc, (found = findNetworkLinks(e.doc)))
      for (const l of found) {
        const key = linkKey(e.id, l.path)
        alive.add(key)
        if (controllers.has(key)) continue
        const c: Controller = { link: l, entryId: e.id, stopped: false }
        controllers.set(key, c)
        void load(c, true)
      }
    }
    for (const key of [...controllers.keys()]) if (!alive.has(key)) stop(key)
  }
  const unsub = useKmlStore.subscribe(sync)
  sync()
  return () => {
    unsub()
    for (const key of [...controllers.keys()]) stop(key)
  }
}
