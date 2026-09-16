import { useEffect, useRef, useState } from 'react'
import type { KmlDataSource, Viewer } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useKmlStore } from '../store/kmlStore'
import { useLayerStore } from '../store/layerStore'
import { MvtImageryProvider } from './MvtImageryProvider'
import './CesiumView.css'

type InitState = 'idle' | 'loading' | 'ready' | 'error'

interface Props {
  visible: boolean
}

const OFM_NATURAL_EARTH = 'https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'
// planet のタイル URL は配信バージョンがパスに含まれ随時更新されるため、
// ハードコードせず TileJSON から実行時に解決する
const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const OFM_CREDIT =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> | <a href="https://openmaptiles.org/">OpenMapTiles</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
// Re:Earth Terrain の CesiumJS 向けエンドポイント（quantized-mesh）。
// Mapterhorn を EGM2008 ジオイドで補正したグローバル標高で z0-14。
// octvertexnormals 拡張を持つので、法線を要求すれば地形の陰影も得られる
const TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid'
const TERRAIN_CREDIT =
  '<a href="https://terrain.reearth.land/">Re:Earth Terrain</a> | <a href="https://mapterhorn.com/">Mapterhorn</a> | <a href="https://earth-info.nga.mil/">EGM2008 (NGA)</a>'

const PLATEAU_CREDIT =
  '建築物モデル: <a href="https://www.mlit.go.jp/plateau/">PLATEAU</a>（国土交通省, CC BY 4.0）'
// scripts/fetch-plateau-index.mjs が生成する全国 448 自治体の索引
const PLATEAU_INDEX_URL = `${import.meta.env.BASE_URL}plateau-buildings.json`
// これより高いと建物は見えないので読み込まない
const PLATEAU_MAX_HEIGHT = 60_000
// 同時に載せる自治体数の上限。政令市が隣接する地域で際限なく増えるのを防ぐ
const PLATEAU_MAX_TILESETS = 12

// 建物は一律の明るいグレーで描く。索引はテクスチャを持たない配信物
// (_no_texture 版と LOD1) だけを選んでいるので、この色がそのまま出る
const PLATEAU_BUILDING_COLOR = "color('#d6d6d6')"

// 3D Tiles の読み込みチューニング。建物は箱と屋根が主で細部が少ないため、
// 既定より粗い SSE でも見た目の損失に対して初回描画が大きく速くなる
const PLATEAU_TILESET_OPTIONS = {
  // 既定 16。大きいほど要求タイルが減る
  maximumScreenSpaceError: 24,
  // 中間 LOD を飛ばして必要な解像度に直接到達させる
  skipLevelOfDetail: true,
  baseScreenSpaceError: 1024,
  // 画面中央を優先し、粗い層を先に敷いてから精細化する
  foveatedScreenSpaceError: true,
  progressiveResolutionHeightFraction: 0.5,
}

interface PlateauEntry {
  name: string
  url: string
  west: number
  south: number
  east: number
  north: number
}

const KML_PATTERN = /\.(kml|kmz)$/i

/**
 * OpenFreeMap のベクタータイルを Cesium のイメージャリレイヤーとして重ねる。
 * planet のタイル URL は配信バージョンがパスに含まれるため TileJSON から解決する。
 */
async function addVectorLayer(viewer: Viewer) {
  const Cesium = await import('cesium')
  const tileJson = await fetch(OFM_TILEJSON).then((r) => r.json())
  const provider = new MvtImageryProvider({
    urlTemplate: tileJson.tiles[0],
    maximumLevel: tileJson.maxzoom,
    credit: OFM_CREDIT,
  })
  viewer.imageryLayers.add(new Cesium.ImageryLayer(provider, {}))
}

/**
 * カメラの視野に入った自治体の PLATEAU 建築物 3D Tiles を読み込み、
 * 視野から外れたものは破棄する。
 *
 * 全国 448 自治体ぶんの tileset.json をまとめて読むことはできないため、
 * 索引（名称と範囲だけの軽量な JSON）を先に引き、視野と交差するものだけを
 * 載せる。索引自体も日本を見ていない利用者には読ませない。
 */
function watchPlateau(viewer: Viewer) {
  let index: PlateauEntry[] | null = null
  let indexPending = false
  let creditShown = false
  const loaded = new Map<string, { tileset: unknown; entry: PlateauEntry }>()
  let updating = false

  const intersects = (e: PlateauEntry, view: { west: number; south: number; east: number; north: number }) =>
    e.west <= view.east && e.east >= view.west && e.south <= view.north && e.north >= view.south

  const unloadAll = () => {
    for (const { tileset } of loaded.values()) {
      viewer.scene.primitives.remove(tileset)
    }
    loaded.clear()
  }

  const update = async () => {
    if (updating) return
    updating = true
    try {
      const Cesium = await import('cesium')
      const camera = viewer.camera

      if (!useLayerStore.getState().plateau) {
        unloadAll()
        return
      }
      if (camera.positionCartographic.height > PLATEAU_MAX_HEIGHT) {
        unloadAll()
        return
      }

      // computeViewRectangle() はカメラを傾けると地平線まで含む巨大な矩形を返し、
      // 遠方の自治体で枠が埋まってしまう。カメラ直下を中心に高度から決めた
      // 範囲で判定する
      const pos = camera.positionCartographic
      const lng = Cesium.Math.toDegrees(pos.longitude)
      const lat = Cesium.Math.toDegrees(pos.latitude)
      // 読み込みは視野より広めに取り、隣接自治体を先読みする。
      // 保持はさらに広く取って、境界付近での読み込みと破棄の往復を防ぐ
      const box = (radiusKm: number) => {
        const dLat = radiusKm / 111
        const dLng = dLat / Math.max(0.2, Math.cos(pos.latitude))
        return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat }
      }
      const loadRadiusKm = Math.max(4, (pos.height / 1000) * 3)
      const loadArea = box(loadRadiusKm)
      const keepArea = box(loadRadiusKm * 1.6)

      if (!index) {
        if (indexPending) return
        indexPending = true
        index = (await fetch(PLATEAU_INDEX_URL).then((r) => r.json())) as PlateauEntry[]
      }

      // 保持範囲から外れたものを先に外し、上限の枠を空ける
      for (const [url, { tileset, entry }] of loaded) {
        if (!intersects(entry, keepArea)) {
          viewer.scene.primitives.remove(tileset)
          loaded.delete(url)
        }
      }

      const wanted = index.filter((e) => intersects(e, loadArea) && !loaded.has(e.url))
      for (const entry of wanted.slice(0, PLATEAU_MAX_TILESETS - loaded.size)) {
        try {
          const tileset = await Cesium.Cesium3DTileset.fromUrl(entry.url, PLATEAU_TILESET_OPTIONS)
          tileset.style = new Cesium.Cesium3DTileStyle({ color: PLATEAU_BUILDING_COLOR })
          // 読み込み中に範囲から外れていたら捨てる
          if (!intersects(entry, keepArea)) continue
          viewer.scene.primitives.add(tileset)
          loaded.set(entry.url, { tileset, entry })
          if (!creditShown) {
            viewer.creditDisplay.addStaticCredit(new Cesium.Credit(PLATEAU_CREDIT, true))
            creditShown = true
          }
        } catch (err) {
          console.error(`[PLATEAU] ${entry.name} の読み込みに失敗:`, err)
        }
      }
    } finally {
      updating = false
    }
  }

  viewer.camera.changed.addEventListener(() => void update())
  // チェックボックスの切り替えでも即座に反映する
  useLayerStore.subscribe(() => void update())
}

export default function CesiumView({ visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  // 動的 import を挟むため、viewerRef だけでは StrictMode の二重実行を防げない
  const initStartedRef = useRef(false)
  const sourcesRef = useRef(new Map<string, KmlDataSource>())
  const [initState, setInitState] = useState<InitState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!visible || !containerRef.current || initStartedRef.current) return
    initStartedRef.current = true
    setInitState('loading')

    const init = async () => {
      // Cesium は Workers/Assets を実行時に CESIUM_BASE_URL からの相対パスで取得する。
      // モジュール評価より前に設定する必要があるため動的 import で順序を保証する
      // （初期バンドルから 7MB 超の Cesium を切り離す効果もある）
      window.CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`
      const Cesium = await import('cesium')

      // Cesium ion は使わない。既定の地形・衛星画像と ion 依存のウィジェットを外し、
      // 画像は 2.75D / 3D と同じ OpenFreeMap の Natural Earth ラスターを使う
      const viewer = new Cesium.Viewer(containerRef.current!, {
        baseLayer: new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: OFM_NATURAL_EARTH,
            maximumLevel: 6,
            credit: new Cesium.Credit(OFM_CREDIT, true),
          }),
        ),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        timeline: true,
        animation: true,
        terrain: new Cesium.Terrain(
          Cesium.CesiumTerrainProvider.fromUrl(TERRAIN_URL, {
            // 法線がないと地形が平坦に陰影づけされ起伏が読めない
            requestVertexNormals: true,
          }),
        ),
      })
      viewerRef.current = viewer

      // 地形を有効にすると地表の裏側の地物が透けて見えるため、深度テストを有効にする
      viewer.scene.globe.depthTestAgainstTerrain = true
      // 法線付きの地形に太陽光を当てて起伏を陰影で表現する。
      // 既定の SunLight (intensity 2) では日中でも地図が暗くなりすぎるため明るくする
      viewer.scene.globe.enableLighting = true
      viewer.scene.light = new Cesium.SunLight({ intensity: 5 })
      // layer.json の attribution は常時表示されないため明示的に出す
      viewer.creditDisplay.addStaticCredit(new Cesium.Credit(TERRAIN_CREDIT, true))
      await addVectorLayer(viewer)
      watchPlateau(viewer)

      useKmlStore.getState().setFlyTo((id) => {
        const source = sourcesRef.current.get(id)
        if (source) void viewer.flyTo(source)
      })
      setInitState('ready')
    }

    init().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Cesium] init failed:', msg)
      setErrorMsg(msg)
      setInitState('error')
    })
  }, [visible])

  const loadKml = async (file: File) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const { add, update } = useKmlStore.getState()
    const id = crypto.randomUUID()
    add({ id, name: file.name, status: 'loading' })

    try {
      const Cesium = await import('cesium')
      // camera / canvas は KML の NetworkLink (viewRefreshMode) が参照する。
      // clampToGround で地表に沿わせないと地形から浮いたり埋まったりする
      const dataSource: KmlDataSource = await Cesium.KmlDataSource.load(file, {
        camera: viewer.camera,
        canvas: viewer.canvas,
        clampToGround: true,
      })
      await viewer.dataSources.add(dataSource)
      sourcesRef.current.set(id, dataSource)
      await viewer.flyTo(dataSource)
      update(id, { status: 'loaded', name: dataSource.name || file.name })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Cesium] KML load failed:', msg)
      update(id, { status: 'error', message: msg })
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    for (const file of Array.from(e.dataTransfer.files)) {
      if (KML_PATTERN.test(file.name)) void loadKml(file)
    }
  }

  return (
    <div
      className={`cesium-view ${visible ? '' : 'cesium-hidden'} ${dragging ? 'cesium-dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div ref={containerRef} className="cesium-container" />
      {initState === 'loading' && (
        <div className="cesium-overlay">
          <span className="cesium-spinner" />
          <span>Cesium を初期化中…</span>
        </div>
      )}
      {initState === 'error' && (
        <div className="cesium-overlay cesium-error">
          <strong>Cesium 初期化エラー</strong>
          <code>{errorMsg}</code>
        </div>
      )}
      {dragging && <div className="cesium-drophint">KML / KMZ をドロップして読み込み</div>}
    </div>
  )
}
