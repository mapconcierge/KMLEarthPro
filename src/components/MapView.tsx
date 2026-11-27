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
import { addKmlToMap, kmlLayerIds, removeKmlFromMap, setKmlHighlight, setKmlVisibleKeys } from '../adapters/maplibre-kml'
import { geoidHeight, geoidHeightCached } from '../adapters/geoid'
import { centerZoomToPose, poseToCenterZoom, resolveAbsoluteView, VERTICAL_FOV_DEG, viewToCenterZoom } from '../kml/camera'
import { parseFeaturePath, placemarkKeys, resolveFlyView, type FeaturePath } from '../kml/target'
import { ingestKmlFile, KML_PATTERN } from '../kml/ingest'
import { hasRegions, visiblePlacemarkKeys, type RegionView } from '../kml/region'
import { useEngineStore } from '../store/engineStore'
import { useCameraStore } from '../store/cameraStore'
import { INITIAL_POSE } from '../store/initialCamera'
import { useKmlStore } from '../store/kmlStore'
import { FLY_DURATION_MS, placeToPose, usePlaceStore } from '../store/placeStore'
import './MapView.css'

// MapLibre 6 が既定で組み立てるワーカー URL はバンドル後に解決できず
// (dist/assets に実体が出力されない)、ワーカーが起動しないまま
// スタイル読み込みが完了せず地図が空になる。public/ の実体を明示的に指す。
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`)

// TileJSON から tiles/tileSize/encoding(terrarium)/attribution をまとめて取得する
const MAPTERHORN_TILEJSON = 'https://tiles.mapterhorn.com/tilejson.json'
const TERRAIN_SOURCE = 'mapterhorn'

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // 初期カメラは 3 エンジン共通のカメラ位置（日本の上空）から換算する（Issue #9）
    const initial = poseToCenterZoom(INITIAL_POSE, containerRef.current.clientHeight)
    const map = new Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: initial.center,
      zoom: initial.zoom,
      // 既定の 60° では地形を横から見渡せないため引き上げる
      maxPitch: 85,
    })
    // 縦画角を Navara / Cesium と同じ 50° にそろえる（既定は 36.87°）
    map.setVerticalFieldOfView(VERTICAL_FOV_DEG)
    mapRef.current = map

    map.on('load', () => {
      map.setProjection({ type: 'globe' })
      // 傾けたとき、遠方ほど低いズームのタイルが選ばれ、建物（OpenMapTiles の building は z13 以上にしか無い）が
      // 描かれなくなる（3D 建物の消失。Navara / Cesium は地平線まで描く）。画面内のズームの差を 1 段階に抑えて遠方も
      // 近いズームで読む。読み込むタイル数の上限は最小の 4 倍まで（既定は 3 倍。8 倍でも見え方は同じで、要求が増えるだけだった）。ベクタータイルのソースだけに適用する
      map.setSourceTileLodParams(1, 4, 'openmaptiles')

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

    // 3 エンジンのカメラ位置をそろえるための換算（kml/camera.ts の poseToCenterZoom / centerZoomToPose）。
    // 地面の楕円体高 = MapLibre の地形標高（ジオイド基準）+ ジオイド高 N。N は取得済みのものを使い、無ければ直前の値
    let lastGeoid = 0
    const groundAt = (n: number) => (lng: number, lat: number) => {
      try {
        return (map.queryTerrainElevation([lng, lat]) ?? 0) + n
      } catch {
        return n
      }
    }
    const prefetchGeoid = () => {
      const c = map.getCenter()
      void geoidHeight(c.lng, c.lat).then((v) => {
        if (v !== undefined) lastGeoid = v
      })
    }
    // 表示領域の高さが決まるまで待つ（エンジン切替の直後は 0 のことがある）
    const waitForSize = async () => {
      for (let i = 0; i < 90 && map.getContainer().clientHeight === 0; i++) await new Promise((r) => requestAnimationFrame(r))
      map.resize()
      return map.getContainer().clientHeight
    }
    const geoidOrZero = async (lng: number, lat: number) =>
      (await Promise.race([geoidHeight(lng, lat), new Promise<undefined>((r) => setTimeout(r, 2500))])) ?? lastGeoid
    // 地形（DEM）が読み込まれてから、引けた標高で同じカメラ位置を置き直す（利用者が動かした後は何もしない）。
    // DEM が未取得のあいだは標高を 0 m として換算するため、最初の換算は地面の高さの分だけずれる
    const refineWhenIdle = (pose: Parameters<typeof poseToCenterZoom>[0], h: number, n: number, first: ReturnType<typeof poseToCenterZoom>) => {
      map.once('idle', () => {
        const c = map.getCenter()
        const unmoved =
          Math.abs(c.lng - first.center[0]) < 1e-4 && Math.abs(c.lat - first.center[1]) < 1e-4 && Math.abs(map.getZoom() - first.zoom) < 0.01
        if (!unmoved) return
        const v = poseToCenterZoom(pose, h, groundAt(n), 85)
        map.jumpTo({ center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch })
      })
    }
    useCameraStore.getState().register('2d-maplibre', {
      get: () => {
        const h = map.getContainer().clientHeight
        if (!h) return null
        const c = map.getCenter()
        const n = geoidHeightCached(c.lng, c.lat) ?? lastGeoid
        return centerZoomToPose(
          { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
          h,
          groundAt(n),
        )
      },
      set: async (pose) => {
        const h = await waitForSize()
        if (!h) return
        const n = await geoidOrZero(pose.lng, pose.lat)
        const first = poseToCenterZoom(pose, h, groundAt(n), 85)
        map.jumpTo({ center: first.center, zoom: first.zoom, bearing: first.bearing, pitch: first.pitch })
        refineWhenIdle(pose, h, n, first)
      },
    })
    map.on('moveend', prefetchGeoid)

    usePlaceStore.getState().registerFlier('2d-maplibre', async (place) => {
      const pose = placeToPose(place)
      const [h, n] = await Promise.all([waitForSize(), geoidOrZero(pose.lng, pose.lat)])
      const v = poseToCenterZoom(pose, h, groundAt(n), 85)
      map.flyTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, duration: FLY_DURATION_MS })
      map.once('moveend', () => refineWhenIdle(pose, h, n, v))
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
    // Region（Lod）による表示切替: 表示範囲が変わるたびに、見える Placemark だけを地図のソースへ入れ直す。
    // 地図へ最初に入れた全地物を保持し、前回の集合と同じなら入れ直さない
    const fullData: Record<string, Awaited<ReturnType<typeof addKmlToMap>>> = {}
    const lastKeys: Record<string, Set<string>> = {}
    const currentView = (): RegionView | null => {
      const c = map.getContainer()
      if (c.clientWidth === 0 || c.clientHeight === 0) return null // 非表示（2D 以外のエンジン表示中）
      const b = map.getBounds()
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(), widthPx: c.clientWidth, heightPx: c.clientHeight }
    }
    const applyRegions = () => {
      const view = currentView()
      if (!view) return
      const entries = useKmlStore.getState().entries
      for (const [id, full] of Object.entries(fullData)) {
        const doc = entries.find((e) => e.id === id)?.doc
        if (!doc || !hasRegions(doc)) continue
        const keys = visiblePlacemarkKeys(doc, view)
        const prev = lastKeys[id]
        if (prev && prev.size === keys.size && [...keys].every((k) => prev.has(k))) continue
        lastKeys[id] = keys
        setKmlVisibleKeys(map, id, full, keys)
      }
    }
    // 他のコンポーネント（NetworkLink の更新）が参照する表示範囲。2D を表示しているときだけ公開する
    const publishView = () => {
      const is2d = useEngineStore.getState().engine === '2d-maplibre'
      useKmlStore.getState().setView(is2d ? currentView() : null)
    }
    map.on('moveend', () => {
      applyRegions()
      publishView()
    })
    const unsubscribeEngine = useEngineStore.subscribe(() => {
      // 2D へ戻った直後は寸法が確定してから測る
      requestAnimationFrame(() => {
        map.resize()
        applyRegions()
        publishView()
      })
    })
    // 選択中のフィーチャを強調する（選択した文書以外は消す）
    const applyHighlight = () => {
      const { selection, entries } = useKmlStore.getState()
      for (const id of Object.keys(rendered)) {
        const doc = entries.find((e) => e.id === id)?.doc
        setKmlHighlight(map, id, doc && selection?.id === id ? placemarkKeys(doc, selection.path) : [])
      }
    }
    const syncKml = () => {
      if (!ready) return
      const entries = useKmlStore.getState().entries
      for (const e of entries) {
        if (e.doc && !(e.id in rendered)) {
          // アイコン読み込み中の重複登録を防ぐため先に印を付ける
          rendered[e.id] = true
          const entryId = e.id
          void addKmlToMap(map, entryId, e.doc, e.resources).then((fc) => {
            // 読み込み中に削除されていたら後始末する
            if (!useKmlStore.getState().entries.some((x) => x.id === entryId)) {
              removeKmlFromMap(map, entryId)
              delete rendered[entryId]
              return
            }
            rendered[entryId] = true
            fullData[entryId] = fc
            delete lastKeys[entryId]
            applyRegions()
            applyHighlight()
            if (e.autoFly !== false) flyToKml(entryId, undefined, 1500)
          })
        }
      }
      for (const id of Object.keys(rendered)) {
        if (!entries.some((e) => e.id === id)) {
          removeKmlFromMap(map, id)
          delete rendered[id]
          delete fullData[id]
          delete lastKeys[id]
        }
      }
    }
    map.on('load', () => {
      // 初期カメラは、表示領域の高さが確定したこの時点の値で置き直す（コンストラクタの時点では未確定のことがある）
      if (map.getZoom() === initial.zoom) {
        const v = poseToCenterZoom(INITIAL_POSE, map.getContainer().clientHeight)
        map.jumpTo({ center: v.center, zoom: v.zoom })
      }
      ready = true
      publishView()
      syncKml()
    })
    const unsubscribeKml = useKmlStore.subscribe((state, prev) => {
      syncKml()
      if (state.selection !== prev.selection) applyHighlight()
    })

    // 地図クリックで Placemark を選ぶ（サイドバーの木が追従する）。何もない所をクリックしたら選択解除
    const kmlFeaturesAt = (point: { x: number; y: number }) => {
      const layers = Object.keys(rendered).flatMap(kmlLayerIds).filter((l) => map.getLayer(l))
      return layers.length ? map.queryRenderedFeatures([point.x, point.y], { layers }) : []
    }
    map.on('click', (e) => {
      for (const f of kmlFeaturesAt(e.point)) {
        const path = parseFeaturePath(f.properties?.kmlPath)
        const id = typeof f.source === 'string' ? f.source.replace(/^kml-/, '') : ''
        if (path && id in rendered) {
          useKmlStore.getState().select({ id, path })
          return
        }
      }
      useKmlStore.getState().select(null)
    })
    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = kmlFeaturesAt(e.point).length ? 'pointer' : ''
    })
    useKmlStore.getState().registerFlyer('2d-maplibre', (id, path) => flyToKml(id, path, FLY_DURATION_MS / 2))

    // 2D/3D 切替の display:none や、レイアウト確定前の初期化で
    // コンテナが 0x0 のまま固定されるのを防ぐ
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      unsubscribeKml()
      unsubscribeEngine()
      useKmlStore.getState().setView(null)
      useKmlStore.getState().registerFlyer('2d-maplibre', null)
      useCameraStore.getState().register('2d-maplibre', null)
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
