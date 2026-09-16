import { useEffect, useRef, useState } from 'react'
import type { KmlDataSource, Viewer } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useKmlStore } from '../store/kmlStore'
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
      })
      viewerRef.current = viewer
      await addVectorLayer(viewer)

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
