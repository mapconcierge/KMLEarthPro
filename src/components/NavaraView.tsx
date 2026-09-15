import { useEffect, useRef, useState } from 'react'
import ThreeView, { Color, type Source } from '@navaramap/three'
import { DefaultPlugin, type DefaultDescriptions } from '@navaramap/three-default-plugin'
import './NavaraView.css'

type InitState = 'idle' | 'loading' | 'ready' | 'error' | 'needs-reload'

interface Props {
  visible: boolean
}

// OpenFreeMap の planet タイル URL は配信バージョンがパスに含まれ随時更新されるため、
// ハードコードせず TileJSON から実行時に解決する
const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const OFM_NATURAL_EARTH = 'https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'

const hex = (value: number) => new Color().setHex(value)

type VectorLayerStyle = {
  sourceLayers: string[]
  polygon?: { color: Color }
  polyline?: { color: Color; width: number }
}

// OpenMapTiles スキーマのソースレイヤーを描画順に定義。
// Navara の vector レイヤーは属性フィルタを持たないため、
// ソースレイヤー単位で 1 スタイルを割り当てる。
const VECTOR_LAYERS: VectorLayerStyle[] = [
  { sourceLayers: ['landcover'], polygon: { color: hex(0xc8dcb4) } },
  { sourceLayers: ['landuse'], polygon: { color: hex(0xe6ddd0) } },
  { sourceLayers: ['park'], polygon: { color: hex(0xb2d492) } },
  { sourceLayers: ['water'], polygon: { color: hex(0x7fb0dc) } },
  { sourceLayers: ['waterway'], polyline: { color: hex(0x7fb0dc), width: 1 } },
  { sourceLayers: ['transportation'], polyline: { color: hex(0x8a8175), width: 1 } },
  { sourceLayers: ['boundary'], polyline: { color: hex(0x9a7fa8), width: 1 } },
  { sourceLayers: ['building'], polygon: { color: hex(0xa89c8c) } },
]

// clampToGround の地物はグローブのドレープテクスチャにベイクされ、その解像度は
// ラスターソースの実データ深度に律速される。ベースの Natural Earth は maxZoom 6
// のため、大縮尺ではベクター地物まで z6 相当に潰れてぼやける（overscaledMaxZoom
// では解決しない）。
//
// clampToGround: false なら解像度非依存に描画されるが、小縮尺では地球全体の線が
// 重なって球面と Z ファイティングを起こし、別ソースで重ねる構成は描画負荷が
// 二重になる。大縮尺の解像度を上げるには深い標高/ラスターソースを与えて
// グローブの分割自体を細かくする必要がある（overscaledMaxZoom では不可）。

const buildLayer = (style: VectorLayerStyle, source: Source, clampToGround: boolean) => ({
  type: 'vector' as const,
  source,
  sourceLayers: style.sourceLayers,
  ...(style.polygon ? { polygon: { ...style.polygon, clampToGround } } : {}),
  ...(style.polyline ? { polyline: { ...style.polyline, clampToGround } } : {}),
})

export default function NavaraView({ visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ThreeView<DefaultDescriptions> | null>(null)
  // init() は非同期のため viewRef だけでは StrictMode の二重実行を防げない
  const initStartedRef = useRef(false)
  const [initState, setInitState] = useState<InitState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

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

      // pitch は nose up positive → -90 で真下（地球俯瞰）、heading 0 で北が上
      view.setCamera({ lng: 0, lat: 20, height: 8_000_000, pitch: -90, heading: 0 })

      // 低ズームの地球儀外観は Natural Earth ラスター（zoom 0-6）が担当し、
      // 拡大時はベクタータイルのレイヤーが詳細を描く
      const base = view.addSource({ type: 'raster-tile', url: OFM_NATURAL_EARTH, maxZoom: 6 })
      view.addLayer({ type: 'raster', source: base })

      const tileJson = await fetch(OFM_TILEJSON).then((r) => r.json())
      const vector = view.addSource({
        type: 'vector-tile',
        url: tileJson.tiles[0],
        minZoom: tileJson.minzoom,
        maxZoom: tileJson.maxzoom,
      })
      for (const style of VECTOR_LAYERS) {
        view.addLayer(buildLayer(style, vector, true))
      }

      // OSM 由来データのため ODbL に基づく帰属表示が必須
      view.attribution?.add([
        { attribution: 'OpenFreeMap', attributionUrl: 'https://openfreemap.org/' },
        { attribution: 'OpenMapTiles', attributionUrl: 'https://openmaptiles.org/' },
        {
          attribution: '© OpenStreetMap contributors',
          attributionUrl: 'https://www.openstreetmap.org/copyright',
        },
      ])

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
          <button className="navara-retry-btn" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </div>
      )}
    </div>
  )
}
