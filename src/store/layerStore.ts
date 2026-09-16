import { create } from 'zustand'

interface LayerState {
  /** PLATEAU の建築物モデル（CesiumJS のみ） */
  plateau: boolean
  setPlateau: (visible: boolean) => void
}

export const useLayerStore = create<LayerState>((set) => ({
  plateau: true,
  setPlateau: (plateau) => set({ plateau }),
}))
