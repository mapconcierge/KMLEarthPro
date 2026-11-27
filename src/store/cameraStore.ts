import { create } from 'zustand'
import type { CameraPose } from '../kml/camera'
import { useEngineStore, type Engine } from './engineStore'

/**
 * エンジン間でカメラ位置を受け渡すための窓口（Issue #9）。
 * 各ビューが、いまのカメラを共通のカメラ位置（経度・緯度・楕円体高・方位・伏角）で返す get と、
 * そのカメラ位置に置く set を登録する。切り替えたとき、切替前のエンジンの get を切替先の set へ渡す。
 */
export interface CameraAccess {
  /** いまのカメラ。表示中でないなど、測れないときは null。切替の瞬間に同期で呼ぶので同期で返す */
  get: () => CameraPose | null
  /** カメラをその位置へ（アニメーションなしで）置く。非同期でもよい */
  set: (pose: CameraPose) => void | Promise<void>
  /**
   * 地点（経度・緯度・楕円体高）が画面のどこに映るか（キャンバス左上からの CSS px）。見えない（背後など）ときは null。
   * エンジン間の画面座標の一致を測る E2E テスト用（アプリ本体は使わない）。
   * MapLibre は高さを使わず、地形があればその標高を含めた位置を返す
   */
  project?: (lng: number, lat: number, height: number) => [number, number] | null
}

interface CameraState {
  access: Partial<Record<Engine, CameraAccess>>
  /** まだ初期化されていないエンジンへ、初期化後に適用するカメラ */
  pending: Partial<Record<Engine, CameraPose>>
  register: (engine: Engine, access: CameraAccess | null) => void
}

export const useCameraStore = create<CameraState>((set, get) => ({
  access: {},
  pending: {},
  register: (engine, access) => {
    set((s) => ({ access: { ...s.access, [engine]: access ?? undefined } }))
    // 登録前に切り替えられていたら、保留していたカメラをここで適用する
    const pose = get().pending[engine]
    if (access && pose) {
      set((s) => ({ pending: { ...s.pending, [engine]: undefined } }))
      void access.set(pose)
    }
  },
}))

/** 方位を 0〜360 に正規化（Navara は 360 を返すことがある） */
export const normalizeHeading = (h: number) => ((h % 360) + 360) % 360

/** エンジンの切り替えを監視して、カメラ位置を引き継ぐ。アプリ起動時に 1 度だけ呼ぶ */
export function startCameraSync(): () => void {
  return useEngineStore.subscribe((state, prev) => {
    if (state.engine === prev.engine) return
    const { access } = useCameraStore.getState()
    // 切替前のエンジンはまだ画面に出ている（描画の更新前）ので、寸法が取れる
    const pose = access[prev.engine]?.get()
    if (!pose) return
    const next = access[state.engine]
    if (next) void next.set(pose)
    else useCameraStore.setState((s) => ({ pending: { ...s.pending, [state.engine]: pose } }))
  })
}

// E2E テスト用の窓口（開発サーバーのときだけ。本番ビルドには出さない）
if (import.meta.env.DEV) (globalThis as unknown as { __kmlEarthPro?: unknown }).__kmlEarthPro = { camera: useCameraStore }
