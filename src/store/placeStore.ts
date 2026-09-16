import { create } from 'zustand'
import type { Engine } from './engineStore'

export interface Place {
  id: string
  name: string
  lng: number
  lat: number
  /** 楕円体高（m）。2D エンジンはこれを使わずズームで寄る */
  height: number
}

/**
 * レンダリングの動作確認用に固定で持つ「お気に入り」。
 *
 * PLATEAU のある都市（東京・大阪）と、全世界の建物データだけが載る都市
 * （ニューヨーク・ミラノ・パリ）を混ぜてあるので、巡回すれば建物・地形・
 * ベクタータイルの描画をひと通り見比べられる。
 */
export const FAVORITE_PLACES: Place[] = [
  { id: 'tokyo', name: '東京', lng: 139.7671, lat: 35.6812, height: 1500 },
  { id: 'osaka', name: '大阪', lng: 135.4959, lat: 34.7025, height: 1500 },
  { id: 'new-york', name: 'ニューヨーク', lng: -74.006, lat: 40.7128, height: 1500 },
  { id: 'milan', name: 'ミラノ', lng: 9.1917, lat: 45.464, height: 1500 },
  { id: 'paris', name: 'パリ', lng: 2.2945, lat: 48.8584, height: 1500 },
]

/** カメラ移動にかける時間 */
export const FLY_DURATION_MS = 3000
/** 巡回で 1 か所に留まる時間。タイルが出そろうまでの余裕を見て長めに取る */
export const TOUR_INTERVAL_MS = 12_000

type Flier = (place: Place) => void

interface PlaceState {
  /**
   * エンジンごとのカメラ移動関数。各ビューが初期化時に登録する。
   * エンジンは切り替わるので、呼ぶ側は現在のエンジンのものを引く
   */
  fliers: Partial<Record<Engine, Flier>>
  /** 巡回中かどうか */
  touring: boolean
  /** 直近に飛んだ場所 */
  currentId: string | null
  registerFlier: (engine: Engine, fly: Flier | null) => void
  setTouring: (touring: boolean) => void
  setCurrentId: (id: string | null) => void
}

export const usePlaceStore = create<PlaceState>((set) => ({
  fliers: {},
  touring: false,
  currentId: null,
  registerFlier: (engine, fly) =>
    set((s) => ({ fliers: { ...s.fliers, [engine]: fly ?? undefined } })),
  setTouring: (touring) => set({ touring }),
  setCurrentId: (currentId) => set({ currentId }),
}))
