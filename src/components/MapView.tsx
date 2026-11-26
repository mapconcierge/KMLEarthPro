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
import { addKmlToMap, removeKmlFromMap } from '../adapters/maplibre-kml'
import { resolveAbsoluteView, viewToCenterZoom } from '../kml/camera'
import { resolveFlyView, type FeaturePath } from '../kml/target'
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
    const rendered: Record<string, true> = {}
    // path 無しは文書全体（最初の視点、無ければ全体の範囲）、あればそのフォルダ/Placemark（自身の視点、
    // 無ければ配下の範囲）へ飛ぶ。範囲は LookAt に直されるので、視点の有無で処理は分かれない
    const flyToKml = (id: string, path: FeaturePath | undefined, duration: number) => {
      const doc = useKmlStore.getState().entries.find((x) => x.id === id)?.doc
      const container = map.getContainer()
      const view = doc && resolveFlyView(doc, path, container.clientWidth / Math.max(container.clientHeight, 1))
      if (!view) return
      // 自由カメラ API は使わず中心+ズームへ換算する（理由は viewToCenterZoom のコメント）。
      // 地形標高は DEM タイルが読み込まれていないと引けないため二段階にする:
      //  1) いまの標高（未取得なら 0 m）で飛ぶ
      //  2) 飛行が終わり DEM が読み込まれた（idle）後に、引けた標高で同じ視点を再設定する
      //     （MapLibre は標高が分かった後に中心を指定し直すと、注視点が地形上の画面中央に来る）
      const elevation = (lng: number, lat: number) => map.queryTerrainElevation([lng, lat]) ?? undefined
      const target = async () => {
        const resolved = await resolveAbsoluteView(view, elevation)
        const ground = elevation(view.longitude, view.latitude) ?? 0
        return viewToCenterZoom(resolved, map.getContainer().clientHeight, 85, ground)
      }
      void target().then((first) => {
        map.flyTo({ ...first, duration })
        map.once('moveend', () =>
          map.once('idle', () => {
            void target().then((refined) => {
              // 利用者が動かした後は上書きしない（飛行先から離れていれば何もしない）
              const c = map.getCenter()
              const moved =
                Math.abs(c.lng - first.center[0]) > 1e-4 ||
                Math.abs(c.lat - first.center[1]) > 1e-4 ||
                Math.abs(map.getZoom() - first.zoom) > 0.01
              if (!moved) map.jumpTo(refined)
            })
          }),
        )
      })
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
          rendered[e.id] = true
          const entryId = e.id
          void addKmlToMap(map, entryId, e.doc, e.resources).then(() => {
            // 読み込み中に削除されていたら後始末する
            if (!useKmlStore.getState().entries.some((x) => x.id === entryId)) {
              removeKmlFromMap(map, entryId)
              delete rendered[entryId]
              return
            }
            rendered[entryId] = true
            flyToKml(entryId, undefined, 1500)
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
    useKmlStore.getState().registerFlyer('2d-maplibre', (id, path) => flyToKml(id, path, FLY_DURATION_MS / 2))

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
