import { create } from 'zustand'
import type { FeaturePath } from '../kml/target'
import type { LinkBase } from '../kml/networkLink'
import type { KmlDocument } from '../kml/types'
import type { Engine } from './engineStore'

export type KmlStatus = 'loading' | 'loaded' | 'error'

export interface KmlEntry {
  id: string
  name: string
  status: KmlStatus
  /** status が 'error' のときの理由 */
  message?: string
  /** エンジン共通の文書モデル。切替後の再描画と保存の元になる */
  doc?: KmlDocument
  /** KMZ 内リソース（相対パス → Blob URL） */
  resources?: Record<string, string>
  /** KMZ 内の同梱ファイルの中身。KMZ 保存で書き戻す */
  files?: Record<string, Uint8Array>
  /** 読み込んだ原本。Cesium の KmlDataSource（NetworkLink 等の完全実装）へ渡す */
  file?: File
  /**
   * NetworkLink から取得した文書（派生エントリ）のとき、取得元の NetworkLink の位置。
   * サイドバーの一覧には出さず、親のツリーの NetworkLink の下に出す。Cesium は自前の NetworkLink 処理で描くため file を持たない
   */
  parent?: { id: string; path: FeaturePath }
  /** 取得元の識別子（URL からクエリを除いたもの、または `file:` + KMZ 内のパス）。循環参照の検出に使う */
  source?: string
  /** この文書内の相対 href を解決する基準 */
  base?: LinkBase
  /** 追加時にその文書へ飛ぶか（既定 true。NetworkLink の更新や flyToView=0 のときは false） */
  autoFly?: boolean
  /** NetworkLink をたどった深さ（ルートは 0）。循環参照の打ち切りに使う */
  depth?: number
}

/** NetworkLink ごとの取得状態（キーは `${文書 ID}/${フィーチャのパス}`） */
export interface LinkState {
  status: 'loading' | 'loaded' | 'error'
  message?: string
  /** 最後に取得できた時刻（ms） */
  fetchedAt?: number
  /** 取得した文書の派生エントリ ID */
  derivedId?: string
}
export const linkKey = (id: string, path: FeaturePath) => `${id}/${path.join('/')}`

/** path 無しは文書全体、あればそのフォルダ/Placemark へ飛ぶ */
type Flyer = (id: string, path?: FeaturePath) => void

/** 選択中の Placemark/フォルダ（サイドバーの木と地図クリックで共有） */
export interface KmlSelection {
  id: string
  path: FeaturePath
}

interface KmlState {
  entries: KmlEntry[]
  selection: KmlSelection | null
  links: Record<string, LinkState>
  setLink: (key: string, state: LinkState | null) => void
  select: (sel: KmlSelection | null) => void
  /** エンジンごとの「KML の範囲へ寄る」関数。各ビューが初期化時に登録する */
  flyers: Partial<Record<Engine, Flyer>>
  add: (entry: KmlEntry) => void
  update: (id: string, patch: Partial<Omit<KmlEntry, 'id'>>) => void
  remove: (id: string) => void
  registerFlyer: (engine: Engine, fn: Flyer | null) => void
}

export const useKmlStore = create<KmlState>((set) => ({
  entries: [],
  selection: null,
  links: {},
  setLink: (key, state) =>
    set((s) => {
      const links = { ...s.links }
      if (state) links[key] = state
      else delete links[key]
      return { links }
    }),
  select: (selection) => set({ selection }),
  flyers: {},
  add: (entry) => set((s) => ({ entries: [...s.entries, entry] })),
  update: (id, patch) =>
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
  remove: (id) =>
    set((s) => ({
      entries: s.entries.filter((e) => e.id !== id),
      selection: s.selection?.id === id ? null : s.selection,
    })),
  registerFlyer: (engine, fn) =>
    set((s) => ({ flyers: { ...s.flyers, [engine]: fn ?? undefined } })),
}))
