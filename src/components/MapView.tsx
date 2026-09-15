import { useEffect, useRef } from 'react'
import { Map, NavigationControl, ScaleControl, GlobeControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './MapView.css'

// MapLibre 6 が既定で組み立てるワーカー URL はバンドル後に解決できず
// (dist/assets に実体が出力されない)、ワーカーが起動しないまま
// スタイル読み込みが完了せず地図が空になる。public/ の実体を明示的に指す。
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`)

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [0, 20],
      zoom: 2,
    })
    mapRef.current = map

    map.on('load', () => {
      map.setProjection({ type: 'globe' })
    })

    map.addControl(new NavigationControl(), 'top-right')
    map.addControl(new GlobeControl(), 'top-right')
    map.addControl(new ScaleControl(), 'bottom-right')

    // 2D/3D 切替の display:none や、レイアウト確定前の初期化で
    // コンテナが 0x0 のまま固定されるのを防ぐ
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="map-view" />
}
