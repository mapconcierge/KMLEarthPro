import { useEffect, useRef, useState } from 'react'
import ThreeView, { TERRARIUM_ELEVATION_DECODER, type Source } from '@navaramap/three'
import { DefaultPlugin, type DefaultDescriptions } from '@navaramap/three-default-plugin'
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

// Re:Earth Buildings: Overture Maps 由来のグローバル 3D 建物（3D Tiles）。
// 常時載せるとタイル読み込みを占有し、基図と地形の取得が止まる
// （実測: 建物ありで Papers は z2 止まり、建物なしで z15 まで到達）。
// 建物が意味を持つ縮尺に入ったときだけ載せ、離れたら外す。
// 閾値に幅を持たせて境界での付け外しの往復を防ぐ。
const BUILDINGS_TILESET = 'https://buildings.reearth.land/tileset.json'
const BUILDINGS_ADD_ZOOM = 14
const BUILDINGS_REMOVE_ZOOM = 12

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

      // 標高タイルを地球表面として描画する
      const dem = view.addSource({
        type: 'raster-dem',
        url: TERRAIN_TILES,
        elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
        tileSize: 512,
        maxZoom: TERRAIN_MAX_ZOOM,
      })
      view.addLayer({ type: 'terrain', source: dem })

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
