import { create } from 'zustand'

export type KmlStatus = 'loading' | 'loaded' | 'error'

export interface KmlEntry {
  id: string
  name: string
  status: KmlStatus
  /** status が 'error' のときの理由 */
  message?: string
}

interface KmlState {
  entries: KmlEntry[]
  /** 読み込んだ KML の範囲へ寄る。ビューアを持つコンポーネントが登録する */
  flyTo: ((id: string) => void) | null
  add: (entry: KmlEntry) => void
  update: (id: string, patch: Partial<Omit<KmlEntry, 'id'>>) => void
  remove: (id: string) => void
  setFlyTo: (fn: ((id: string) => void) | null) => void
}

export const useKmlStore = create<KmlState>((set) => ({
  entries: [],
  flyTo: null,
  add: (entry) => set((s) => ({ entries: [...s.entries, entry] })),
  update: (id, patch) =>
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
  remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  setFlyTo: (fn) => set({ flyTo: fn }),
}))
