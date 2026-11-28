import { useEffect, useRef, useState } from 'react'
import type { Cesium3DTileset, ClippingPolygonCollection, KmlDataSource, Viewer } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { resolveAbsoluteView, VERTICAL_FOV_DEG } from '../kml/camera'
import { kmlToGeoJson } from '../adapters/maplibre-kml'
import { placemarkKeys, placemarkLocator, resolveFlyView, type FeaturePath } from '../kml/target'
import { prepareForCesium } from '../kml/cesium-prep'
import type { HeightSources } from '../kml/altitude'
import { geoidHeight } from '../adapters/geoid'
import { hasRegions, visiblePlacemarkKeys, type RegionView } from '../kml/region'
import { ingestKmlFile, KML_PATTERN } from '../kml/ingest'
import { normalizeHeading, useCameraStore } from '../store/cameraStore'
import { INITIAL_POSE } from '../store/initialCamera'
import { useEngineStore } from '../store/engineStore'
import { useKmlStore } from '../store/kmlStore'
import { useLayerStore } from '../store/layerStore'
import { FLY_DURATION_MS, PLACE_PITCH_DEG, usePlaceStore } from '../store/placeStore'
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
// これより高いと建物は見えないので読み込まない（PLATEAU・全世界共通）
const BUILDINGS_MAX_HEIGHT = 60_000
// 同時に載せる自治体数の上限。政令市が隣接する地域で際限なく増えるのを防ぐ
const PLATEAU_MAX_TILESETS = 12

// 建物は PLATEAU・全世界とも一律の明るいグレーで描く。PLATEAU の索引は
// テクスチャを持たない配信物 (_no_texture 版と LOD1) だけを選んでいるので、
// この色がそのまま出る
const BUILDING_COLOR = "color('#d6d6d6')"

// 建物に当てる平行光の強さ。シーンの太陽光 (intensity 5) は地形の起伏を
// 読ませるために強めてあり、そのまま建物に当てると日中に白飛びする
const BUILDING_LIGHT = 2
// 太陽の当たらない面に乗せる一定の環境光。
//
// Cesium は既定で DynamicEnvironmentMapManager が大気から環境光を求めるが、
// 日没後はその環境光がほぼ 0 になり、建物が真っ黒なシルエットになる
// （太陽の位置は時計に連動するので、日本の夕方以降に開くと必ずこうなる）。
// 大気由来の環境光を切り、方角と時刻に依らない一定値を与える
const BUILDING_AMBIENT = 0.35

// Re:Earth Buildings: Overture Maps 由来の全世界 3D 建物（単一の tileset.json）。
// PLATEAU が無い地域を埋める
const GLOBAL_BUILDINGS_URL = 'https://buildings.reearth.land/tileset.json'
const GLOBAL_BUILDINGS_CREDIT =
  '建物: <a href="https://buildings.reearth.land/">Re:Earth Buildings</a> | <a href="https://overturemaps.org/">Overture Maps</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// 3D Tiles の読み込みチューニング。建物は箱と屋根が主で細部が少ないため、
// 既定より粗い SSE でも見た目の損失に対して初回描画が大きく速くなる
const BUILDINGS_TILESET_OPTIONS = {
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

// 「場所」から飛んだときの伏角

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
 * 建物 3D Tiles の見えかたを揃える。PLATEAU と全世界の建物で共通。
 *
 * 一律の明るいグレーにしたうえで、平行光を弱め一定の環境光を足す。
 * こうしないと時刻によって白飛びしたり真っ黒なシルエットになったりする。
 */
async function styleBuildings(tileset: Cesium3DTileset) {
  const Cesium = await import('cesium')
  tileset.style = new Cesium.Cesium3DTileStyle({ color: BUILDING_COLOR })
  tileset.lightColor = new Cesium.Cartesian3(BUILDING_LIGHT, BUILDING_LIGHT, BUILDING_LIGHT)
  tileset.environmentMapManager.enabled = false
  // 3 次の球面調和係数。0 次だけを与えると全方向に一定の環境光になる
  const zero = () => new Cesium.Cartesian3(0, 0, 0)
  tileset.imageBasedLighting.sphericalHarmonicCoefficients = [
    new Cesium.Cartesian3(BUILDING_AMBIENT, BUILDING_AMBIENT, BUILDING_AMBIENT),
    zero(), zero(), zero(), zero(), zero(), zero(), zero(), zero(),
  ]
}

/**
 * 建物の 3D Tiles を管理する。
 *
 * PLATEAU は全国 448 自治体ぶんの tileset.json をまとめて読むことができないため、
 * 索引（名称と範囲だけの軽量な JSON）を先に引き、カメラ周辺と交差するものだけを
 * 載せる。索引自体も日本を見ていない利用者には読ませない。
 *
 * Re:Earth Buildings は全世界を 1 本の tileset.json で覆う。PLATEAU と重ねると
 * 日本の都市で建物が二重になるため、読み込み済み PLATEAU の範囲を
 * ClippingPolygonCollection で切り抜いて描画から外す。
 */
/** 高度の解決（absolute のジオイド補正・relativeToGround の標高加算）に使う、ジオイド高と地表の楕円体高 */
function cesiumHeights(Cesium: typeof import('cesium'), viewer: Viewer): HeightSources {
  return {
    geoid: geoidHeight,
    terrain: async (points) => {
      const carto = await Cesium.sampleTerrainMostDetailed(
        viewer.terrainProvider,
        points.map((p) => Cesium.Cartographic.fromDegrees(p.lng, p.lat)),
      )
      return carto.map((c) => c.height)
    },
  }
}

function watchBuildings(viewer: Viewer) {
  let index: PlateauEntry[] | null = null
  let indexPending = false
  let creditShown = false
  const loaded = new Map<string, { tileset: unknown; entry: PlateauEntry }>()
  let updating = false
  let globalTileset: Cesium3DTileset | null = null
  let globalClipping: ClippingPolygonCollection | null = null
  // 切り抜き範囲の再構築は PLATEAU の顔ぶれが変わったときだけ行う
  let clipSignature = ''
  let globalPending = false

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
      if (camera.positionCartographic.height > BUILDINGS_MAX_HEIGHT) {
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
          const tileset = await Cesium.Cesium3DTileset.fromUrl(entry.url, BUILDINGS_TILESET_OPTIONS)
          await styleBuildings(tileset)
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

  /**
   * 読み込み済み PLATEAU の範囲を切り抜き、日本の都市で建物が二重に描かれるのを防ぐ。
   *
   * ClippingPolygonCollection は tileset に代入し直しても前の collection が破棄されず
   * GPU リソースが残るため、1 つを作って中身だけ入れ替える。
   */
  const applyClipping = async () => {
    if (!globalClipping) return
    const signature = [...loaded.keys()].sort().join('|')
    if (signature === clipSignature) return
    clipSignature = signature

    const Cesium = await import('cesium')
    globalClipping.removeAll()
    for (const { entry } of loaded.values()) {
      globalClipping.add(
        new Cesium.ClippingPolygon({
          positions: Cesium.Cartesian3.fromDegreesArray([
            entry.west, entry.south,
            entry.east, entry.south,
            entry.east, entry.north,
            entry.west, entry.north,
          ]),
        }),
      )
    }
  }

  /** 全世界の建物 3D Tiles を、建物が意味を持つ縮尺に入ったときだけ載せる */
  const updateGlobal = async () => {
    const Cesium = await import('cesium')
    const wanted =
      useLayerStore.getState().globalBuildings &&
      viewer.camera.positionCartographic.height <= BUILDINGS_MAX_HEIGHT

    if (!wanted) {
      if (globalTileset) {
        // primitives.remove() が tileset ごと clippingPolygons も破棄する
        viewer.scene.primitives.remove(globalTileset)
        globalTileset = null
        globalClipping = null
        clipSignature = ''
      }
      return
    }

    if (!globalTileset) {
      if (globalPending) return
      globalPending = true
      try {
        const clipping = new Cesium.ClippingPolygonCollection()
        const tileset = await Cesium.Cesium3DTileset.fromUrl(GLOBAL_BUILDINGS_URL, {
          ...BUILDINGS_TILESET_OPTIONS,
          // inverse 既定 false = ポリゴン内側を描画から外す
          clippingPolygons: clipping,
        })
        await styleBuildings(tileset)
        viewer.scene.primitives.add(tileset)
        viewer.creditDisplay.addStaticCredit(new Cesium.Credit(GLOBAL_BUILDINGS_CREDIT, true))
        globalTileset = tileset
        globalClipping = clipping
        clipSignature = ''
      } catch (err) {
        console.error('[Re:Earth Buildings] の読み込みに失敗:', err)
        return
      } finally {
        globalPending = false
      }
    }
    await applyClipping()
  }

  const updateAll = async () => {
    await update()
    await updateGlobal()
  }

  viewer.camera.changed.addEventListener(() => void updateAll())
  // チェックボックスの切り替えでも即座に反映する
  useLayerStore.subscribe(() => void updateAll())
}

export default function CesiumView({ visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  // 動的 import を挟むため、viewerRef だけでは StrictMode の二重実行を防げない
  const initStartedRef = useRef(false)
  const sourcesRef = useRef(new Map<string, KmlDataSource>())
  const visibleRef = useRef(visible)
  visibleRef.current = visible
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
      // 初期カメラは日本の上空（真下、北が上）
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(INITIAL_POSE.lng, INITIAL_POSE.lat, INITIAL_POSE.height),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(INITIAL_POSE.pitch), roll: 0 },
      })
      // 縦画角を 3 エンジン共通の 50° にそろえる（Issue #9）。Cesium の fov は「長い辺」の画角（横長なら横）なので、
      // 縦横比に応じて毎フレーム求め直す（ウィンドウの形が変わっても縦画角が変わらない）
      const halfV = Math.tan(Cesium.Math.toRadians(VERTICAL_FOV_DEG) / 2)
      viewer.scene.preUpdate.addEventListener(() => {
        const frustum = viewer.camera.frustum as import('cesium').PerspectiveFrustum
        const aspect = viewer.canvas.clientWidth / Math.max(viewer.canvas.clientHeight, 1)
        const fov = 2 * Math.atan(halfV * Math.max(aspect, 1))
        if (Math.abs((frustum.fov ?? 0) - fov) > 1e-9) frustum.fov = fov
      })
      // エンジン切替でカメラ位置を引き継ぐための窓口（登録時に、保留されていたカメラがあれば適用される）
      useCameraStore.getState().register('3d-cesium', {
        get: () => {
          const c = viewer.camera
          const p = c.positionCartographic
          return {
            lng: Cesium.Math.toDegrees(p.longitude),
            lat: Cesium.Math.toDegrees(p.latitude),
            height: p.height,
            heading: normalizeHeading(Cesium.Math.toDegrees(c.heading)),
            pitch: Cesium.Math.toDegrees(c.pitch),
            roll: 0,
          }
        },
        set: (pose) =>
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(pose.lng, pose.lat, pose.height),
            orientation: { heading: Cesium.Math.toRadians(pose.heading), pitch: Cesium.Math.toRadians(pose.pitch), roll: 0 },
          }),
        project: (lng, lat, height) => {
          const p = viewer.scene.cartesianToCanvasCoordinates(Cesium.Cartesian3.fromDegrees(lng, lat, height))
          return p ? [p.x, p.y] : null
        },
      })

      // 地形を有効にすると地表の裏側の地物が透けて見えるため、深度テストを有効にする
      viewer.scene.globe.depthTestAgainstTerrain = true
      // 法線付きの地形に太陽光を当てて起伏を陰影で表現する。
      // 既定の SunLight (intensity 2) では日中でも地図が暗くなりすぎるため明るくする
      viewer.scene.globe.enableLighting = true
      viewer.scene.light = new Cesium.SunLight({ intensity: 5 })
      // layer.json の attribution は常時表示されないため明示的に出す
      viewer.creditDisplay.addStaticCredit(new Cesium.Credit(TERRAIN_CREDIT, true))
      await addVectorLayer(viewer)
      watchBuildings(viewer)

      usePlaceStore.getState().registerFlier('3d-cesium', (place) => {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(place.lng, place.lat, place.height),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(PLACE_PITCH_DEG),
            roll: 0,
          },
          duration: FLY_DURATION_MS / 1000,
        })
      })

      // kmlStore の文書を購読して描画する。Cesium は KmlDataSource（NetworkLink 等を含む
      // 完全実装）に原本ファイルを渡す。共通の文書モデルは保存と他エンジンの描画に使う
      // 視点（文書内の LookAt/Camera、無ければジオメトリの範囲から作った LookAt）へ飛ぶ。
      // path があればそのフォルダ/Placemark へ。
      // KML の tilt は 0=真下、Cesium の pitch は -90=真下なので tilt - 90。
      // LookAt は HeadingPitchRange（注視点 + 距離）にそのまま対応する
      const flyToKml = async (id: string, path?: FeaturePath) => {
        const ds = sourcesRef.current.get(id)
        const doc = useKmlStore.getState().entries.find((x) => x.id === id)?.doc
        const found = doc && resolveFlyView(doc, path, viewer.canvas.clientWidth / Math.max(viewer.canvas.clientHeight, 1))
        const Cesium = await import('cesium')
        const rad = Cesium.Math.toRadians
        // altitudeMode に応じて、地形（Re:Earth Terrain）の標高を足した絶対高度へ直す。
        // 取れなければ resolveAbsoluteView が標高 0 m として扱う
        const view =
          found &&
          (await resolveAbsoluteView(found, async (lng, lat) => {
            const [p] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
              Cesium.Cartographic.fromDegrees(lng, lat),
            ])
            return p?.height
          }))
        if (view?.kind === 'LookAt') {
          viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(view.longitude, view.latitude, view.altitude), 0),
            {
              offset: new Cesium.HeadingPitchRange(rad(view.heading), rad(Math.min(Math.max(view.tilt, 0), 90) - 90), view.range),
              duration: 3,
            },
          )
        } else if (view?.kind === 'Camera') {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(view.longitude, view.latitude, view.altitude),
            orientation: {
              heading: rad(view.heading),
              pitch: rad(Math.min(Math.max(view.tilt, 0), 180) - 90),
              roll: rad(view.roll),
            },
            duration: 3,
          })
        } else if (ds && !path) {
          // 共通モデルに視点も範囲も無い（NetworkLink だけの KML など）ときは Cesium のデータ範囲へ
          void viewer.flyTo(ds)
        }
      }
      // エンティティ（KmlDataSource）の最初の座標（経度, 緯度）。文書モデルの Placemark へ戻すのに使う
      const entityLonLat = (entity: import('cesium').Entity): [number, number] | undefined => {
        const time = viewer.clock.currentTime
        const pos =
          entity.position?.getValue(time) ??
          entity.polyline?.positions?.getValue(time)?.[0] ??
          entity.polygon?.hierarchy?.getValue(time)?.positions?.[0]
        if (!pos) return undefined
        const c = Cesium.Cartographic.fromCartesian(pos)
        return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)]
      }
      // Region（Lod）による表示切替。Cesium の KmlDataSource は Placemark の Region を処理しない（警告を出して無視）ので、
      // 読み込み後にエンティティ → kmlPath の対応を 1 度作り、カメラが止まるたびに entity.show を切り替える。
      // 表示範囲は camera.computeViewRectangle() の外接矩形（傾きがあると近似）。
      // 対応づけは名前 + 最初の座標のため、同名・同座標の Placemark が複数あると区別できない
      const entityKeys = new Map<string, Map<import('cesium').Entity, string>>()
      const lastKeys: Record<string, Set<string>> = {}
      const engineIsCesium = () => useEngineStore.getState().engine === '3d-cesium'
      const currentView = (): RegionView | null => {
        const w = viewer.canvas.clientWidth
        const h = viewer.canvas.clientHeight
        if (!engineIsCesium() || w === 0 || h === 0) return null
        const r = viewer.camera.computeViewRectangle()
        if (!r) return null
        const west = Cesium.Math.toDegrees(r.west)
        const east = Cesium.Math.toDegrees(r.east)
        const wrap = r.west > r.east // 日付変更線をまたぐ範囲は全経度とする
        return {
          west: wrap ? -180 : west,
          south: Cesium.Math.toDegrees(r.south),
          east: wrap ? 180 : east,
          north: Cesium.Math.toDegrees(r.north),
          widthPx: w,
          heightPx: h,
        }
      }
      const indexEntities = (id: string, ds: KmlDataSource) => {
        const doc = useKmlStore.getState().entries.find((e) => e.id === id)?.doc
        if (!doc || !hasRegions(doc)) return
        const locate = placemarkLocator(doc)
        const map = new Map<import('cesium').Entity, string>()
        for (const entity of ds.entities.values) {
          const ll = entityLonLat(entity)
          const path = ll && locate(entity.name ?? '', ll[0], ll[1])
          if (path) map.set(entity, path.join('/'))
        }
        entityKeys.set(id, map)
      }
      const applyRegions = () => {
        const rv = currentView()
        if (!rv) return
        const entries = useKmlStore.getState().entries
        for (const [id, map] of entityKeys) {
          const doc = entries.find((e) => e.id === id)?.doc
          if (!doc) continue
          const keys = visiblePlacemarkKeys(doc, rv)
          const prev = lastKeys[id]
          if (prev && prev.size === keys.size && [...keys].every((k) => prev.has(k))) continue
          lastKeys[id] = keys
          for (const [entity, key] of map) entity.show = keys.has(key)
        }
      }
      // 表示中のエンジンだけが公開する（非表示のエンジンが null で上書きしない）
      const publishView = () => {
        if (engineIsCesium()) useKmlStore.getState().setView(currentView())
      }
      const onMoved = () => {
        applyRegions()
        publishView()
      }
      let viewTimer: ReturnType<typeof setTimeout> | undefined
      viewer.camera.moveEnd.addEventListener(() => {
        clearTimeout(viewTimer)
        viewTimer = setTimeout(onMoved, 150)
      })
      useEngineStore.subscribe(() => {
        clearTimeout(viewTimer)
        // 表示の切替直後は寸法が確定してから測る
        viewTimer = setTimeout(onMoved, 400)
      })
      const loading = new Set<string>()
      const syncKml = () => {
        const entries = useKmlStore.getState().entries
        for (const e of entries) {
          if (e.status !== 'loaded' || !e.file || sourcesRef.current.has(e.id) || loading.has(e.id)) continue
          loading.add(e.id)
          void (async () => {
            try {
              const Cesium = await import('cesium')
              // camera / canvas は KML の NetworkLink (viewRefreshMode) が参照する。
              // clampToGround で地表に沿わせないと地形から浮いたり埋まったりする
              const ds: KmlDataSource = await Cesium.KmlDataSource.load(await prepareForCesium(e.file!, cesiumHeights(Cesium, viewer)), {
                camera: viewer.camera,
                canvas: viewer.canvas,
                clampToGround: true,
              })
              await viewer.dataSources.add(ds)
              sourcesRef.current.set(e.id, ds)
              indexEntities(e.id, ds)
              applyRegions()
              // NetworkLink（onRegion）の更新では飛ばない
              if (visibleRef.current && e.autoFly !== false) void flyToKml(e.id)
            } catch (err: unknown) {
              console.error('[Cesium] KML load failed:', err instanceof Error ? err.message : err)
            } finally {
              loading.delete(e.id)
            }
          })()
        }
        for (const [id, ds] of sourcesRef.current) {
          if (!entries.some((e) => e.id === id)) {
            viewer.dataSources.remove(ds, true)
            sourcesRef.current.delete(id)
            entityKeys.delete(id)
            delete lastKeys[id]
          }
        }
      }
      useKmlStore.subscribe(syncKml)
      syncKml()
      // 地図クリックで Placemark を選ぶ。KmlDataSource のエンティティは文書モデルと別物なので、
      // 名前と最初の座標で文書モデルの Placemark へ戻す
      // KML の説明は共通の Balloon で出すので、Cesium 標準の情報パネルは KML のエンティティでは出さない
      // （PLATEAU など 3D Tiles のフィーチャは従来どおり標準パネル）
      viewer.selectedEntityChanged.addEventListener((entity) => {
        if (entity && ([...sourcesRef.current.values()].some((d) => d.entities.contains(entity)) || highlightDs?.entities.contains(entity))) {
          viewer.selectedEntity = undefined
        }
      })
      // 選択中のフィーチャの強調（共通モデルから GeoJSON を作って別データソースで描く）
      let highlightDs: import('cesium').GeoJsonDataSource | null = null
      let highlightSeq = 0
      const applyHighlight = async () => {
        const seq = ++highlightSeq
        const { selection, entries } = useKmlStore.getState()
        const doc = selection && entries.find((e) => e.id === selection.id)?.doc
        let next: import('cesium').GeoJsonDataSource | null = null
        if (doc && selection) {
          const keys = new Set(placemarkKeys(doc, selection.path))
          const features = kmlToGeoJson(doc).features.filter((f) => keys.has(String((f.properties as { kmlPath?: string }).kmlPath)))
          if (features.length) {
            const hl = Cesium.Color.fromCssColorString('#00e5ff')
            next = await Cesium.GeoJsonDataSource.load(
              { type: 'FeatureCollection', features } as never,
              { stroke: hl, strokeWidth: 6, fill: hl.withAlpha(0.35), markerColor: hl, markerSize: 56, clampToGround: true },
            )
          }
        }
        if (seq !== highlightSeq) return // 読み込み中にさらに選択が変わった
        if (highlightDs) viewer.dataSources.remove(highlightDs, true)
        highlightDs = next
        if (next) await viewer.dataSources.add(next)
      }
      useKmlStore.subscribe((state, prev) => {
        if (state.selection !== prev.selection) void applyHighlight().catch((e: unknown) => console.warn('[Cesium] highlight failed:', e))
      })
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas)
      handler.setInputAction((ev: { position: import('cesium').Cartesian2 }) => {
        const entity = (viewer.scene.pick(ev.position) as { id?: import('cesium').Entity } | undefined)?.id
        const select = useKmlStore.getState().select
        if (entity && highlightDs?.entities.contains(entity)) return // 強調表示そのものは選択対象にしない
        const ds = entity && [...sourcesRef.current].find(([, d]) => d.entities.contains(entity))
        if (!entity || !ds) return select(null)
        const ll = entityLonLat(entity)
        const doc = useKmlStore.getState().entries.find((x) => x.id === ds[0])?.doc
        const path = doc && ll ? placemarkLocator(doc)(entity.name ?? '', ll[0], ll[1]) : undefined
        select(path ? { id: ds[0], path } : null)
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
      useKmlStore.getState().registerFlyer('3d-cesium', (id, path) => void flyToKml(id, path))
      setInitState('ready')
    }

    init().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Cesium] init failed:', msg)
      setErrorMsg(msg)
      setInitState('error')
    })
  }, [visible])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    for (const file of Array.from(e.dataTransfer.files)) {
      if (KML_PATTERN.test(file.name)) void ingestKmlFile(file)
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
