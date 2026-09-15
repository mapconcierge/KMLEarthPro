import { useEffect, useRef, useState } from 'react'
import ThreeView, { Color, TERRARIUM_ELEVATION_DECODER, type Source } from '@navaramap/three'
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

// Mapterhorn のグローバル標高タイル（terrarium エンコーディング、tileSize 512、
// z16 まで提供。配信形式は PNG ではなく WebP）
const MAPTERHORN_DEM = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'
const MAPTERHORN_MAX_ZOOM = 16

const hex = (value: number) => new Color().setHex(value)

type VectorLayerStyle = {
  sourceLayers: string[]
  polygon?: { color: Color }
  polyline?: { color: Color; width: number }
}

// Navara の vector レイヤーは属性フィルタを持たず、ソースレイヤー単位で 1 スタイル
// しか割り当てられない。landcover は森林・氷河・農地などを 1 レイヤーに含むため、
// 単色で塗ると地形の上に意味のない斑模様が乗る。featureCreated で class を読んで
// 色を決め、未知の class は描画しない。
//
// landuse と park も同様に多 class だが、こちらは市街地の区分が主で地形表現の
// 邪魔になるうえジオメトリ量が最大級のため、レイヤーごと描画しない。
const LANDCOVER_COLORS: Record<string, number> = {
  wood: 0x8fae74,
  grass: 0xb3cf95,
  farmland: 0xd4d8a0,
  ice: 0xf0f4f8,
  rock: 0xb8b2a8,
  sand: 0xe4d9b8,
  wetland: 0x9fc0ad,
}

const VECTOR_LAYERS: VectorLayerStyle[] = [
  { sourceLayers: ['water'], polygon: { color: hex(0x5b91c4) } },
  { sourceLayers: ['waterway'], polyline: { color: hex(0x5b91c4), width: 1 } },
  { sourceLayers: ['transportation'], polyline: { color: hex(0x9a9184), width: 1 } },
  { sourceLayers: ['boundary'], polyline: { color: hex(0x8f7a9c), width: 1 } },
  { sourceLayers: ['building'], polygon: { color: hex(0x9c9184) } },
]

// clampToGround の地物はグローブのドレープテクスチャにベイクされ、その解像度は
// グローブのタイル分割深度に律速される。分割深度は最も深いソースが決めるため、
// Natural Earth ラスター（maxZoom 6）だけでは大縮尺で z6 相当に潰れる。
// Mapterhorn の DEM（z16）を terrain として与えることで分割が深くなり解決する。
// overscaledMaxZoom や maxSse では分割深度は変わらない。
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

      // 標高タイルを地球表面として描画する。地形表現に加えて、グローブの
      // タイル分割が DEM の深度（z16）まで細かくなるため、clampToGround の
      // ベクター地物がベイクされる解像度も大縮尺まで確保される。
      const dem = view.addSource({
        type: 'raster-dem',
        url: MAPTERHORN_DEM,
        elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
        tileSize: 512,
        maxZoom: MAPTERHORN_MAX_ZOOM,
      })
      view.addLayer({ type: 'terrain', source: dem })

      // 低ズームの地球儀外観は Natural Earth ラスター（zoom 0-6）が担当し、
      // 拡大時はベクタータイルのレイヤーが詳細を描く
      const base = view.addSource({ type: 'raster-tile', url: OFM_NATURAL_EARTH, maxZoom: 6 })
      view.addLayer({ type: 'raster', source: base })

      // 同じ DEM から陰影を描く。terrain メッシュの起伏は俯瞰（pitch -90）では
      // 読み取れないため、真上からでも地形が分かるようにする。
      // ベクター地物より先に追加して注記や道路を隠さないようにする
      view.addLayer({ type: 'raster', source: dem, hillshade: { exaggeration: 0.3 } })

      const tileJson = await fetch(OFM_TILEJSON).then((r) => r.json())
      const vector = view.addSource({
        type: 'vector-tile',
        url: tileJson.tiles[0],
        minZoom: tileJson.minzoom,
        maxZoom: tileJson.maxzoom,
      })
      const landcover = view.addLayer({
        type: 'vector',
        source: vector,
        sourceLayers: ['landcover'],
        polygon: { clampToGround: true },
      })
      landcover.on('featureCreated', ({ evaluator }) => {
        evaluator.evaluate(({ properties }) => {
          const value = LANDCOVER_COLORS[String(properties?.['class'])]
          return value === undefined ? { show: false } : { color: hex(value) }
        })
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
        { attribution: '© Mapterhorn', attributionUrl: 'https://mapterhorn.com/attribution' },
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
