import { create } from 'zustand'

interface LayerState {
  /** PLATEAU の建築物モデル（CesiumJS のみ） */
  plateau: boolean
  /** Re:Earth Buildings の全世界建物（CesiumJS のみ） */
  globalBuildings: boolean
  setPlateau: (visible: boolean) => void
  setGlobalBuildings: (visible: boolean) => void
}

export const useLayerStore = create<LayerState>((set) => ({
  plateau: true,
  globalBuildings: true,
  setPlateau: (plateau) => set({ plateau }),
  setGlobalBuildings: (globalBuildings) => set({ globalBuildings }),
}))
