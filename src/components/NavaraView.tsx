import { useEffect, useRef, useState } from 'react'
import ThreeView, { geodeticToVector3, TERRARIUM_ELEVATION_DECODER, type Source } from '@navaramap/three'
import { DefaultPlugin, type DefaultDescriptions } from '@navaramap/three-default-plugin'
import { addKmlToNavara, addNavaraHighlight, flyToNavaraView, removeKmlFromNavara, setNavaraVisibleKeys, type NavaraKml } from '../adapters/navara-kml'
import { navaraRegionView } from '../adapters/navara-view'
import { hasRegions, visiblePlacemarkKeys, type RegionView } from '../kml/region'
import { parseFeaturePath, placemarkKeys, resolveFlyView, type FeaturePath } from '../kml/target'
import { ingestKmlFile, KML_PATTERN } from '../kml/ingest'
import { VERTICAL_FOV_DEG } from '../kml/camera'
import { normalizeHeading, useCameraStore } from '../store/cameraStore'
import { INITIAL_POSE } from '../store/initialCamera'
import { useEngineStore } from '../store/engineStore'
import { useKmlStore } from '../store/kmlStore'
import { FLY_DURATION_MS, PLACE_PITCH_DEG, usePlaceStore } from '../store/placeStore'
import './NavaraView.css'

type InitState = 'idle' | 'loading' | 'ready' | 'error' | 'needs-reload'

interface Props {
  visible: boolean
}

// Re:Earth Papers: OpenStreetMap (Protomaps) から描画済みのラスター基図。
// z0-22 と深いため、地球儀から街区まで 1 ソースで賄える。
// 自前でベクタータイルを配色する必要がなくなり、グローブのタイル分割深度も
// このラスターが決めるのでドレープ解像度の問題も起きない。
const PAPERS_TILES = 'https://papers.reearth.land/styles/papers-light/tile/{z}/{x}/{y}.webp'
const PAPERS_MAX_ZOOM = 22

// Re:Earth Terrain: Mapterhorn を EGM2008 ジオイドで補正したグローバル標高。
// terrarium エンコーディング、配信形式は WebP
const TERRAIN_TILES = 'https://terrain.reearth.land/mapterhorn-egm08/terrarium/ellipsoid/{z}/{x}/{y}.webp'
const TERRAIN_MAX_ZOOM = 14
// NOTE: z0 タイル (.../ellipsoid/0/0/0.webp) は配信側が 500 を返す（z1 以降は正常）。
// コンソールに 1 件エラーが出るが描画への影響はない。minZoom: 1 で回避しようとすると
// グローブ表面が描画されなくなるため、設定しない

// Re:Earth Buildings: Overture Maps 由来のグローバル 3D 建物（3D Tiles）。
// 常時載せるとタイル読み込みを占有し、基図と地形の取得が止まる
// （実測: 建物ありで Papers は z2 止まり、建物なしで z15 まで到達）。
// 建物が意味を持つ縮尺に入ったときだけ載せ、離れたら外す。
// 閾値に幅を持たせて境界での付け外しの往復を防ぐ。
const BUILDINGS_TILESET = 'https://buildings.reearth.land/tileset.json'
// 地形（terrain レイヤー）は大縮尺になってから載せる。地球全体が見える縮尺で実際の標高を使うと、
// 地表のメッシュに黒い筋や欠けが出る（Navara 0.1.1 / 0.3.1 で確認。KMLEarthPro の Issue #8）。
// 外している間は粗い楕円体メッシュになり、地球の輪郭が多面体に見える。標高 0 m のタイルなら出ないことと、
// 標高データの値自体に異常が無いことは確認済みだが、メッシュ側の原因は未特定。閾値に幅を持たせて付け外しの往復を防ぐ
const TERRAIN_ADD_ZOOM = 10
const TERRAIN_REMOVE_ZOOM = 9
const BUILDINGS_ADD_ZOOM = 14
const BUILDINGS_REMOVE_ZOOM = 12
// 夜側で建物が黒く潰れないように足す環境光の強さ
const BUILDING_AMBIENT_INTENSITY = 0.6


export default function NavaraView({ visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ThreeView<DefaultDescriptions> | null>(null)
  // init() は非同期のため viewRef だけでは StrictMode の二重実行を防げない
  const initStartedRef = useRef(false)
  const [initState, setInitState] = useState<InitState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // Navara の worker pool はページ内で一度しか初期化できないため、
    // 2D/3D 切替では view を破棄せず初回のみ生成して使い回す
    if (!visible || !containerRef.current || initStartedRef.current) return

    if (!window.crossOriginIsolated) {
      setInitState('needs-reload')
      return
    }

    initStartedRef.current = true
    setInitState('loading')

    const init = async () => {
      const view = new ThreeView<DefaultDescriptions>({
        container: containerRef.current!,
        shadow: true,
      })

      const defaultPlugin = new DefaultPlugin()
      view.addPlugin(defaultPlugin)

      await view.init()
      viewRef.current = view

      defaultPlugin.addDefaultPhotorealScene()

      // 建物 3D Tiles はシーンの光で陰影がつくが、太陽は実時刻に追従するため
      // 日没後は光が当たらず真っ黒なシルエットになる（ラスターの基図は光を
      // 受けないので明るいまま残り、建物だけが黒く沈む）。
      // 一定の環境光を足して、時刻に依らず建物がグレーで読めるようにする。
      // 昼は太陽光が主になるので陰影はそのまま残る
      view.addLight({ ambient: { intensity: BUILDING_AMBIENT_INTENSITY } })

      // pitch は nose up positive → -90 で真下（地球俯瞰）、heading 0 で北が上
      view.camera.fov = VERTICAL_FOV_DEG // 縦画角は 3 エンジン共通（Issue #9）
      view.setCamera({ lng: INITIAL_POSE.lng, lat: INITIAL_POSE.lat, height: INITIAL_POSE.height, pitch: INITIAL_POSE.pitch, heading: INITIAL_POSE.heading })
      // エンジン切替でカメラ位置を引き継ぐための窓口（登録時に、保留されていたカメラがあれば適用される）
      useCameraStore.getState().register('3d-navara', {
        get: () => {
          // 初期化直後はカメラの位置がまだ無く、positionGeographic が例外を投げる
          try {
            const g = view.camera.positionGeographic
            const o = view.camera.orientation
            if (o.pitch === undefined || o.heading === undefined) return null
            return { lng: g.lng, lat: g.lat, height: g.height, heading: normalizeHeading(o.heading), pitch: o.pitch, roll: 0 }
          } catch {
            return null
          }
        },
        set: (pose) => view.setCamera({ lng: pose.lng, lat: pose.lat, height: pose.height, pitch: pose.pitch, heading: pose.heading }),
        project: (lng, lat, height) => {
          const r = view.canvas.getBoundingClientRect()
          const ndc = geodeticToVector3({ lng, lat, height }).project(view.camera.raw)
          if (ndc.z < -1 || ndc.z > 1) return null
          return [((ndc.x + 1) / 2) * r.width, ((1 - ndc.y) / 2) * r.height]
        },
      })

      // 標高タイルを地球表面として描画する
      const dem = view.addSource({
        type: 'raster-dem',
        url: TERRAIN_TILES,
        elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
        tileSize: 512,
        maxZoom: TERRAIN_MAX_ZOOM,
      })
      // terrain レイヤーはズームに応じて付け外しする（TERRAIN_ADD_ZOOM のコメント参照）。
      // ソース（dem）は常に持つので、標高の取得（sampleTerrainMostDetailed）はレイヤー無しでも使える
      let terrainLayerId: string | null = null
      view.on('postUpdate', () => {
        const zoom = view.camera.zoom
        if (zoom === undefined) return
        if (!terrainLayerId && zoom >= TERRAIN_ADD_ZOOM) terrainLayerId = view.addLayer({ type: 'terrain', source: dem }).id
        else if (terrainLayerId && zoom < TERRAIN_REMOVE_ZOOM) {
          view.deleteLayerById(terrainLayerId)
          terrainLayerId = null
        }
      })

      // NOTE: terrain レイヤーと hillshade レイヤーは併用できない。併用すると
      // グローブ表面が一切描画されず画面が真っ暗になる（DEM を別ソースに分けても同じ）。
      // 地形の陰影は terrain メッシュがシーンの太陽光から受ける陰影が担当する。

      const basemap = view.addSource({
        type: 'raster-tile',
        url: PAPERS_TILES,
        maxZoom: PAPERS_MAX_ZOOM,
      })
      view.addLayer({ type: 'raster', source: basemap })

      let buildings: { source: Source; layerId: string } | null = null
      view.on('postUpdate', () => {
        const zoom = view.camera.zoom
        if (zoom === undefined) return

        if (!buildings && zoom >= BUILDINGS_ADD_ZOOM) {
          const source = view.addSource({ type: '3d-tiles', url: BUILDINGS_TILESET })
          const layer = view.addLayer({ type: '3d-tiles', source })
          buildings = { source, layerId: layer.id }
        } else if (buildings && zoom < BUILDINGS_REMOVE_ZOOM) {
          // レイヤーが参照している間はソースを消せないので順序を守る
          view.deleteLayerById(buildings.layerId)
          buildings.source.delete()
          buildings = null
        }
      })

      // 各 TileJSON / tileset.json が要求する帰属表示
      view.attribution?.add([
        { attribution: 'Re:Earth Papers', attributionUrl: 'https://papers.reearth.land/attribution' },
        { attribution: 'Re:Earth Terrain', attributionUrl: 'https://terrain.reearth.land/' },
        { attribution: 'Re:Earth Buildings', attributionUrl: 'https://buildings.reearth.land/' },
        { attribution: 'Mapterhorn', attributionUrl: 'https://mapterhorn.com/' },
        { attribution: 'Overture Maps', attributionUrl: 'https://overturemaps.org/' },
        {
          attribution: '© OpenStreetMap contributors',
          attributionUrl: 'https://www.openstreetmap.org/copyright',
        },
      ])

      usePlaceStore.getState().registerFlier('3d-navara', (place) => {
        // 割り込まれると false で解決する。巡回では想定内なので結果は見ない
        void view.flyTo(
          { lng: place.lng, lat: place.lat, height: place.height, pitch: PLACE_PITCH_DEG, heading: 0 },
          { duration: FLY_DURATION_MS },
        )
      })

      // kmlStore の文書を購読して描画する（エンジン切替で Navara が後から初期化されても
      // 読み込み済みの KML がここで描かれる）
      // 地形（DEM ソース）の標高。取得できなければ undefined（呼び出し側が 0 m 扱い）
      const sampleTerrain = async (lng: number, lat: number) =>
        (await view.sampleTerrainMostDetailed(dem, [{ lat, lng }]))[0]?.height
      const pending: NavaraKml = { parts: [] }
      const rendered: Record<string, NavaraKml> = {}
      // path 無しは文書全体、あればそのフォルダ/Placemark へ（視点の決め方は resolveFlyView）
      const flyToKml = (id: string, path?: FeaturePath) => {
        const doc = useKmlStore.getState().entries.find((x) => x.id === id)?.doc
        const box = containerRef.current
        const target = doc && resolveFlyView(doc, path, box ? box.clientWidth / Math.max(box.clientHeight, 1) : undefined)
        if (target) void flyToNavaraView(view, target, FLY_DURATION_MS / 2, sampleTerrain)
      }
      // Region（Lod）による表示切替と、他のコンポーネント（NetworkLink）へ表示範囲を渡す。
      // 3D では表示範囲が近似（navaraRegionView）。Navara を表示しているときだけ公開する
      const lastKeys: Record<string, Set<string>> = {}
      const engineIsNavara = () => useEngineStore.getState().engine === '3d-navara'
      const applyRegions = (rv: RegionView | null = engineIsNavara() ? navaraRegionView(view) : null) => {
        if (!rv) return
        const entries = useKmlStore.getState().entries
        for (const [id, k] of Object.entries(rendered)) {
          if (k === pending) continue
          const doc = entries.find((e) => e.id === id)?.doc
          if (!doc || !hasRegions(doc)) continue
          const keys = visiblePlacemarkKeys(doc, rv)
          const prev = lastKeys[id]
          if (prev && prev.size === keys.size && [...keys].every((x) => prev.has(x))) continue
          lastKeys[id] = keys
          setNavaraVisibleKeys(k, keys)
        }
      }
      // 表示中のエンジンだけが公開する（非表示のエンジンが null で上書きしない）
      let viewTimer: ReturnType<typeof setTimeout> | undefined
      const onMoved = (retry = 0) => {
        if (!engineIsNavara()) return
        const rv = navaraRegionView(view)
        if (!rv) {
          // 地形レイヤーを付けた直後などは、メッシュができるまで地表を引けない。少し待って測り直す
          if (retry < 8) viewTimer = setTimeout(() => onMoved(retry + 1), 500)
          return
        }
        applyRegions(rv)
        useKmlStore.getState().setView(rv)
      }
      // 動きが止まってから測る（イベントは動いている間に連続して出るため、短く待って 1 回にまとめる）
      const scheduleMoved = () => {
        clearTimeout(viewTimer)
        viewTimer = setTimeout(onMoved, 250)
      }
      // camera の move 系イベントは setCamera では出ないことがあるため、postUpdate でカメラ位置の変化を検出する
      let lastCam = ''
      view.on('postUpdate', () => {
        const g = view.camera.positionGeographic
        const o = view.camera.orientation
        const k = [g.lng, g.lat, g.height, o.heading, o.pitch, view.camera.zoom].map((x) => (typeof x === 'number' ? x.toFixed(5) : x)).join(',')
        if (k === lastCam) return
        lastCam = k
        scheduleMoved()
      })
      useEngineStore.subscribe(() => {
        clearTimeout(viewTimer)
        // 表示の切替直後は寸法が確定してから測る
        viewTimer = setTimeout(onMoved, 400)
      })
      const syncKml = () => {
        const entries = useKmlStore.getState().entries
        for (const e of entries) {
          if (!e.doc || e.id in rendered) continue
          // 非同期（フォント取得）の間に重複登録されないよう先に印を付ける
          rendered[e.id] = pending
          void addKmlToNavara(view, e.doc, e.resources)
            .then((k) => {
              if (!useKmlStore.getState().entries.some((x) => x.id === e.id)) {
                removeKmlFromNavara(view, k)
                delete rendered[e.id]
                return
              }
              rendered[e.id] = k
              applyRegions()
              if (e.autoFly !== false) flyToKml(e.id)
            })
            .catch((err: unknown) => {
              delete rendered[e.id]
              console.error('[Navara] KML render failed:', err instanceof Error ? err.message : err)
            })
        }
        for (const id of Object.keys(rendered)) {
          if (!entries.some((e) => e.id === id) && rendered[id] !== pending) {
            removeKmlFromNavara(view, rendered[id])
            delete rendered[id]
            delete lastKeys[id]
          }
        }
      }
      // 選択中のフィーチャの強調（別レイヤ。選択が変わるたびに作り直す）
      let highlight: NavaraKml | null = null
      const applyHighlight = () => {
        if (highlight) removeKmlFromNavara(view, highlight)
        highlight = null
        const { selection, entries } = useKmlStore.getState()
        const doc = selection && entries.find((e) => e.id === selection.id)?.doc
        if (doc && selection) highlight = addNavaraHighlight(view, doc, placemarkKeys(doc, selection.path))
      }
      useKmlStore.subscribe((state, prev) => {
        syncKml()
        if (state.selection !== prev.selection) applyHighlight()
      })
      syncKml()
      viewTimer = setTimeout(onMoved, 1000) // 初回の表示範囲
      // 地図クリックで Placemark を選ぶ。プロパティの kmlPath と、レイヤ → 文書の対応で特定する
      view.on('featureClick', (info) => {
        const path = parseFeaturePath(info?.properties?.kmlPath)
        const id = Object.keys(rendered).find((k) => rendered[k].parts.some((p) => p.layerId === info?.layerId))
        useKmlStore.getState().select(path && id ? { id, path } : null)
      })
      useKmlStore.getState().registerFlyer('3d-navara', (id, path) => {
        // 描画の準備ができていない（フォント取得中など）間は飛ばない
        if (rendered[id] && rendered[id] !== pending) flyToKml(id, path)
      })

      setInitState('ready')
    }

    init().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Navara] init failed:', msg)
      setErrorMsg(msg)
      setInitState('error')
    })
  }, [visible])

  return (
    <div
      ref={containerRef}
      className={`navara-view ${visible ? '' : 'navara-hidden'}`}
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
      {dragging && <div className="navara-drophint">KML / KMZ をドロップして読み込み</div>}
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
          <button className="navara-retry-btn" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </div>
      )}
    </div>
  )
}
