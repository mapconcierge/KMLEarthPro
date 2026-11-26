import { create } from 'zustand'
import type { FeaturePath } from '../kml/target'
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
  /** 読み込んだ原本。Cesium の KmlDataSource（NetworkLink 等の完全実装）へ渡す */
  file?: File
}

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
