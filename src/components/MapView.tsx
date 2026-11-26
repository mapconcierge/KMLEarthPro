import { useEffect, useRef, useState } from 'react'
import {
  Map,
  NavigationControl,
  ScaleControl,
  GlobeControl,
  TerrainControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addKmlToMap, geoJsonBounds, removeKmlFromMap } from '../adapters/maplibre-kml'
import { findInitialView, viewToCenterZoom } from '../kml/camera'
import { ingestKmlFile, KML_PATTERN } from '../kml/ingest'
import { useKmlStore } from '../store/kmlStore'
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
  const [dragging, setDragging] = useState(false)

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

    // KML: kmlStore の文書を購読して描画する。エンジン切替後も文書は store に残るので、
    // MapLibre が後から初期化されても、すでに読み込まれた KML がここで描かれる
    const rendered: Record<string, ReturnType<typeof geoJsonBounds>> = {}
    // 文書に LookAt / Camera があればその視点へ、無ければ範囲全体へ寄る
    const flyToKml = (id: string, duration: number) => {
      const doc = useKmlStore.getState().entries.find((x) => x.id === id)?.doc
      const view = doc && findInitialView(doc)
      if (view) {
        // 自由カメラ API は使わず中心+ズームへ換算する（理由は viewToCenterZoom のコメント）
        const h = map.getContainer().clientHeight
        map.flyTo({ ...viewToCenterZoom(view, h), duration })
        return
      }
      const bounds = rendered[id]
      if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration })
    }
    // isStyleLoaded() はタイル読み込み中に false を返し続けるため、初回の load を基準にする。
    // （未ロードのまま return すると、次に store が変わるまで KML が描かれず飛行もしない）
    let ready = false
    const syncKml = () => {
      if (!ready) return
      const entries = useKmlStore.getState().entries
      for (const e of entries) {
        if (e.doc && !(e.id in rendered)) {
          // アイコン読み込み中の重複登録を防ぐため先に印を付ける
          rendered[e.id] = undefined
          const entryId = e.id
          void addKmlToMap(map, entryId, e.doc, e.resources).then((fc) => {
            // 読み込み中に削除されていたら後始末する
            if (!useKmlStore.getState().entries.some((x) => x.id === entryId)) {
              removeKmlFromMap(map, entryId)
              delete rendered[entryId]
              return
            }
            rendered[entryId] = geoJsonBounds(fc)
            flyToKml(entryId, 1500)
          })
        }
      }
      for (const id of Object.keys(rendered)) {
        if (!entries.some((e) => e.id === id)) {
          removeKmlFromMap(map, id)
          delete rendered[id]
        }
      }
    }
    map.on('load', () => {
      ready = true
      syncKml()
    })
    const unsubscribeKml = useKmlStore.subscribe(syncKml)
    useKmlStore.getState().registerFlyer('2d-maplibre', (id) => flyToKml(id, FLY_DURATION_MS / 2))

    // 2D/3D 切替の display:none や、レイアウト確定前の初期化で
    // コンテナが 0x0 のまま固定されるのを防ぐ
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      unsubscribeKml()
      useKmlStore.getState().registerFlyer('2d-maplibre', null)
      usePlaceStore.getState().registerFlier('2d-maplibre', null)
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div
      className="map-view"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        for (const f of Array.from(e.dataTransfer.files)) if (KML_PATTERN.test(f.name)) void ingestKmlFile(f)
      }}
    >
      <div ref={containerRef} className="map-view-canvas" />
      {dragging && <div className="map-drophint">KML / KMZ をドロップして読み込み</div>}
    </div>
  )
}
