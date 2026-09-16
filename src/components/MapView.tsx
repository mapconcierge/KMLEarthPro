import { useEffect, useRef } from 'react'
import {
  Map,
  NavigationControl,
  ScaleControl,
  GlobeControl,
  TerrainControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FLY_DURATION_MS, usePlaceStore } from '../store/placeStore'
import './MapView.css'

// MapLibre 6 が既定で組み立てるワーカー URL はバンドル後に解決できず
// (dist/assets に実体が出力されない)、ワーカーが起動しないまま
// スタイル読み込みが完了せず地図が空になる。public/ の実体を明示的に指す。
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`)

// TileJSON から tiles/tileSize/encoding(terrarium)/attribution をまとめて取得する
const MAPTERHORN_TILEJSON = 'https://tiles.mapterhorn.com/tilejson.json'
const TERRAIN_SOURCE = 'mapterhorn'

// 「場所」から飛んだときの見えかた。3D エンジンの高度 1,500m・伏角 35° に
// おおよそ合わせる（MapLibre の pitch は真下が 0 なので 90 から引く）
const PLACE_ZOOM = 15
const PLACE_PITCH = 55

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
      // 既定の 60° では地形を横から見渡せないため引き上げる
      maxPitch: 85,
    })
    mapRef.current = map

    map.on('load', () => {
      map.setProjection({ type: 'globe' })

      map.addSource(TERRAIN_SOURCE, { type: 'raster-dem', url: MAPTERHORN_TILEJSON })
      map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1 })

      // terrain のメッシュは俯瞰（pitch 0）では起伏が読めないため、
      // 同じ DEM から陰影を描いて真上からでも地形が分かるようにする。
      // ラベルより下に差し込んで注記が隠れないようにする
      const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
      map.addLayer(
        {
          id: 'mapterhorn-hillshade',
          type: 'hillshade',
          source: TERRAIN_SOURCE,
          paint: { 'hillshade-exaggeration': 0.3 },
        },
        firstSymbol,
      )
    })

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new GlobeControl(), 'top-right')
    map.addControl(new TerrainControl({ source: TERRAIN_SOURCE, exaggeration: 1 }), 'top-right')
    map.addControl(new ScaleControl(), 'bottom-right')

    usePlaceStore.getState().registerFlier('2d-maplibre', (place) => {
      map.flyTo({
        center: [place.lng, place.lat],
        zoom: PLACE_ZOOM,
        pitch: PLACE_PITCH,
        bearing: 0,
        duration: FLY_DURATION_MS,
      })
    })

    // 2D/3D 切替の display:none や、レイアウト確定前の初期化で
    // コンテナが 0x0 のまま固定されるのを防ぐ
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      usePlaceStore.getState().registerFlier('2d-maplibre', null)
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="map-view" />
}
