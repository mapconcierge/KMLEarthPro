import { useEffect, useRef, useState } from 'react'
import ThreeView from '@navaramap/three'
import { DefaultPlugin, type DefaultDescriptions } from '@navaramap/three-default-plugin'
import './NavaraView.css'

type InitState = 'idle' | 'loading' | 'ready' | 'error' | 'needs-reload'

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

    if (!window.crossOriginIsolated) {
      setInitState('needs-reload')
      return
    }

    let cancelled = false
    setInitState('loading')

    const init = async () => {
      const view = new ThreeView<DefaultDescriptions>({
        container: containerRef.current!,
        shadow: true,
      })

      const defaultPlugin = new DefaultPlugin()
      view.addPlugin(defaultPlugin)

      await view.init()

      if (cancelled) {
        containerRef.current?.querySelector('canvas')?.remove()
        return
      }

      viewRef.current = view

      defaultPlugin.addDefaultPhotorealScene()

      // pitch: 0 = 真下（地球俯瞰）, heading: 0 = 北が上
      view.setCamera({ lng: 0, lat: 20, height: 8_000_000, pitch: 0, heading: 0 })

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
      {initState === 'needs-reload' && (
        <div className="navara-overlay navara-error">
          <strong>ページを再読み込みしています…</strong>
          <span>セキュリティポリシーを適用中です</span>
        </div>
      )}
      {initState === 'error' && (
        <div className="navara-overlay navara-error">
          <strong>Navara 初期化エラー</strong>
          <code>{errorMsg}</code>
          <button className="navara-retry-btn" onClick={() => { setInitState('idle'); setErrorMsg('') }}>
            再試行
          </button>
        </div>
      )}
    </div>
  )
}
