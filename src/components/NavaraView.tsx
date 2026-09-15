import { useEffect, useRef, useState } from 'react'
import ThreeView from '@navaramap/three'
import { DefaultPlugin, type DefaultDescriptions } from '@navaramap/three-default-plugin'
import './NavaraView.css'

type InitState = 'idle' | 'loading' | 'ready' | 'error'

interface Props {
  visible: boolean
}

export default function NavaraView({ visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ThreeView<DefaultDescriptions> | null>(null)
  const [initState, setInitState] = useState<InitState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!visible || !containerRef.current || viewRef.current) return

    let cancelled = false
    setInitState('loading')

    const init = async () => {
      // 1. ThreeView を構築 — container に渡すと canvas が自動追加される
      const view = new ThreeView<DefaultDescriptions>({
        container: containerRef.current!,
        shadow: true,
      })

      // 2. init() より前にプラグインを登録（後から追加不可）
      const defaultPlugin = new DefaultPlugin()
      view.addPlugin(defaultPlugin)

      // 3. 非同期初期化（WASM + workers + pipeline）
      await view.init()

      if (cancelled) {
        containerRef.current?.querySelector('canvas')?.remove()
        return
      }

      viewRef.current = view

      // 4. フォトリアルシーン（大気・太陽・星）を追加
      defaultPlugin.addDefaultPhotorealScene()

      // 5. 初期カメラ位置（経度 0, 緯度 20, 高度 8000km）
      view.setCamera({ lng: 0, lat: 20, height: 8_000_000, pitch: -90 })

      // 6. OpenFreeMap ラスタータイルを追加
      const src = view.addSource({
        type: 'raster-tile',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maxZoom: 19,
      })
      view.addLayer({ type: 'raster', source: src })

      if (!cancelled) setInitState('ready')
    }

    init().catch((err: unknown) => {
      if (cancelled) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Navara] init failed:', msg)
      setErrorMsg(msg)
      setInitState('error')
    })

    return () => {
      cancelled = true
      // canvas を DOM から除去（ThreeView に公式 dispose なし）
      containerRef.current?.querySelectorAll('canvas').forEach(c => c.remove())
      viewRef.current = null
    }
  }, [visible])

  return (
    <div ref={containerRef} className={`navara-view ${visible ? '' : 'navara-hidden'}`}>
      {initState === 'loading' && (
        <div className="navara-overlay">
          <span className="navara-spinner" />
          <span>Navara 3D を初期化中…</span>
        </div>
      )}
      {initState === 'error' && (
        <div className="navara-overlay navara-error">
          <strong>Navara 初期化エラー</strong>
          <code>{errorMsg}</code>
        </div>
      )}
    </div>
  )
}
