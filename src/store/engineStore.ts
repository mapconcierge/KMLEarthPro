import { create } from 'zustand'

export type Engine = '2d-maplibre' | '3d-navara'

interface EngineState {
  engine: Engine
  setEngine: (engine: Engine) => void
}

export const useEngineStore = create<EngineState>((set) => ({
  engine: '2d-maplibre',
  setEngine: (engine) => set({ engine }),
}))
