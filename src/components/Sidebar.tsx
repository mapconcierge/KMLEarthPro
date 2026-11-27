import { useEffect, useState } from 'react'
import { useEngineStore, type Engine } from '../store/engineStore'
import { useKmlStore } from '../store/kmlStore'
import { useLayerStore } from '../store/layerStore'
import {
  FAVORITE_PLACES,
  TOUR_INTERVAL_MS,
  usePlaceStore,
  type Place,
} from '../store/placeStore'
import { saveKml } from '../kml/save'
import KmlTree from './KmlTree'
import './Sidebar.css'

const ENGINES: { id: Engine; label: string; badge: string; version: string }[] = [
  { id: '2d-maplibre', label: 'MapLibre GL JS', badge: '2.75D', version: __ENGINE_VERSIONS__.maplibre },
  { id: '3d-navara', label: 'Navara 3D', badge: '3D', version: __ENGINE_VERSIONS__.navara },
  { id: '3d-cesium', label: 'CesiumJS', badge: '3D', version: __ENGINE_VERSIONS__.cesium },
]

export default function Sidebar() {
  const { engine, setEngine } = useEngineStore()
  const allEntries = useKmlStore((s) => s.entries)
  // NetworkLink から取得した派生エントリは一覧に出さず、親のツリーの NetworkLink の下に出す
  const kmlEntries = allEntries.filter((e) => !e.parent)
  const flyToKml = useKmlStore((s) => s.flyers[engine])
  const plateauVisible = useLayerStore((s) => s.plateau)
  const setPlateauVisible = useLayerStore((s) => s.setPlateau)
  const globalBuildingsVisible = useLayerStore((s) => s.globalBuildings)
  const setGlobalBuildingsVisible = useLayerStore((s) => s.setGlobalBuildings)
  const fliers = usePlaceStore((s) => s.fliers)
  const touring = usePlaceStore((s) => s.touring)
  const currentPlaceId = usePlaceStore((s) => s.currentId)
  const setTouring = usePlaceStore((s) => s.setTouring)
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  // KML ごとのフォルダ/Placemark 一覧の開閉
  const [treeOpen, setTreeOpen] = useState<Record<string, boolean>>({})
  // 地図クリックで選ばれた文書のツリーが閉じていれば開く
  const selectedId = useKmlStore((s) => s.selection?.id)
  useEffect(() => {
    if (!selectedId) return
    // 選択が NetworkLink の派生文書のときは、一覧に出ている根の文書まで遡って開く
    const entries = useKmlStore.getState().entries
    let rootId = selectedId
    for (let e = entries.find((x) => x.id === rootId); e?.parent; e = entries.find((x) => x.id === rootId)) rootId = e.parent.id
    setTreeOpen((t) => (t[rootId] ? t : { ...t, [rootId]: true }))
  }, [selectedId])

  // 現在のエンジンがカメラ移動関数を登録していなければ飛べない
  // （Navara / CesiumJS は選択されるまで初期化されない）
  const canFly = fliers[engine] !== undefined

  const flyToPlace = (place: Place) => {
    usePlaceStore.getState().setCurrentId(place.id)
    usePlaceStore.getState().fliers[engine]?.(place)
  }

  // 巡回。エンジンを切り替えても続くよう、毎回その時点のエンジンから引く
  useEffect(() => {
    if (!touring) return

    let index = 0
    const go = () => {
      const place = FAVORITE_PLACES[index % FAVORITE_PLACES.length]
      index += 1
      const { setCurrentId, fliers: current } = usePlaceStore.getState()
      setCurrentId(place.id)
      current[useEngineStore.getState().engine]?.(place)
    }

    go()
    const timer = setInterval(go, TOUR_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [touring])

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="app-title-row">
          <h1 className="app-title">KML Earth Pro</h1>
          <span className="app-version">v{__APP_VERSION__}</span>
        </div>
        <p className="app-subtitle">Digital Earth Browser</p>
      </div>
      <nav className="sidebar-nav">
        <section className="nav-section">
          <h2>エンジン</h2>
          <div className="engine-list">
            {ENGINES.map((e) => (
              <button
                key={e.id}
                className={`engine-btn ${engine === e.id ? 'active' : ''}`}
                onClick={() => setEngine(e.id)}
              >
                <span className="engine-badge">{e.badge}</span>
                {e.label}
                <span className="engine-version">{e.version}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="nav-section">
          <h2>検索</h2>
          <input type="search" placeholder="場所を検索..." className="search-input" aria-label="場所を検索" />
        </section>
        <section className="nav-section">
          <h2>場所</h2>
          <div className="folder">
            <button
              className="folder-header"
              onClick={() => setFavoritesOpen((open) => !open)}
              aria-expanded={favoritesOpen}
            >
              <span className="folder-caret">{favoritesOpen ? '▾' : '▸'}</span>
              お気に入り
            </button>
            <button
              className={`tour-btn ${touring ? 'active' : ''}`}
              onClick={() => setTouring(!touring)}
              disabled={!canFly && !touring}
              title={
                canFly
                  ? `${TOUR_INTERVAL_MS / 1000} 秒ごとに次の場所へ移動します`
                  : 'このエンジンはまだ初期化されていません'
              }
            >
              {touring ? '■ 停止' : '▶ 巡回'}
            </button>
          </div>
          {favoritesOpen && (
            <ul className="place-list">
              {FAVORITE_PLACES.map((place) => (
                <li key={place.id}>
                  <button
                    className={`place-name ${currentPlaceId === place.id ? 'active' : ''}`}
                    onClick={() => flyToPlace(place)}
                    disabled={!canFly}
                  >
                    {place.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {kmlEntries.length === 0 ? (
            <p className="placeholder-text">
              KML/KMZ ファイルを地図へドロップして開く
            </p>
          ) : (
            <ul className="kml-list">
              {kmlEntries.map((e) => (
                <li key={e.id} className="kml-entry">
                  <div className={`kml-item kml-${e.status}`} title={e.message ?? e.name}>
                    {e.status === 'loaded' && e.doc ? (
                      <button
                        className="kml-tree-caret"
                        aria-label={treeOpen[e.id] ? 'フォルダ一覧を閉じる' : 'フォルダ一覧を開く'}
                        aria-expanded={!!treeOpen[e.id]}
                        onClick={() => setTreeOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                      >
                        {treeOpen[e.id] ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="kml-tree-caret" />
                    )}
                    <button
                      className="kml-name"
                      disabled={e.status !== 'loaded' || !flyToKml}
                      onClick={() => flyToKml?.(e.id)}
                    >
                      {e.name}
                    </button>
                    {e.status === 'loaded' && e.doc && (
                      <>
                        <button className="kml-save" title="KML で保存" onClick={() => saveKml(e, 'kml')}>
                          KML
                        </button>
                        <button className="kml-save" title="KMZ で保存" onClick={() => saveKml(e, 'kmz')}>
                          KMZ
                        </button>
                      </>
                    )}
                    {e.status === 'loading' && <span className="kml-state">読込中</span>}
                    {e.status === 'error' && <span className="kml-state">エラー</span>}
                  </div>
                  {treeOpen[e.id] && e.doc && (
                    <KmlTree entryId={e.id} doc={e.doc} onFly={flyToKml ? (path) => flyToKml(e.id, path) : null} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="nav-section">
          <h2>レイヤー</h2>
          <ul className="layer-list">
            <li>
              <label>
                <input type="checkbox" defaultChecked /> OpenFreeMap
              </label>
            </li>
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={plateauVisible}
                  onChange={(e) => setPlateauVisible(e.target.checked)}
                />{' '}
                PLATEAU 建築物
              </label>
              <span className="layer-note">CesiumJS のみ</span>
            </li>
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={globalBuildingsVisible}
                  onChange={(e) => setGlobalBuildingsVisible(e.target.checked)}
                />{' '}
                建物（全世界）
              </label>
              <span className="layer-note">CesiumJS のみ・PLATEAU 範囲は除外</span>
            </li>
          </ul>
        </section>
      </nav>
      <div className="sidebar-footer">
        <p className="phase-badge">Phase 1 — KML/KMZ 基本経路を実装中</p>
      </div>
    </aside>
  )
}
