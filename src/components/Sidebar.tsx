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
import './Sidebar.css'

const ENGINES: { id: Engine; label: string; badge: string }[] = [
  { id: '2d-maplibre', label: 'MapLibre GL JS', badge: '2.75D' },
  { id: '3d-navara', label: 'Navara 3D', badge: '3D' },
  { id: '3d-cesium', label: 'CesiumJS', badge: '3D' },
]

export default function Sidebar() {
  const { engine, setEngine } = useEngineStore()
  const kmlEntries = useKmlStore((s) => s.entries)
  const flyToKml = useKmlStore((s) => s.flyTo)
  const plateauVisible = useLayerStore((s) => s.plateau)
  const setPlateauVisible = useLayerStore((s) => s.setPlateau)
  const globalBuildingsVisible = useLayerStore((s) => s.globalBuildings)
  const setGlobalBuildingsVisible = useLayerStore((s) => s.setGlobalBuildings)
  const fliers = usePlaceStore((s) => s.fliers)
  const touring = usePlaceStore((s) => s.touring)
  const currentPlaceId = usePlaceStore((s) => s.currentId)
  const setTouring = usePlaceStore((s) => s.setTouring)
  const [favoritesOpen, setFavoritesOpen] = useState(true)

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
        <h1 className="app-title">KML Earth Pro</h1>
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
              CesiumJS に KML/KMZ ファイルをドロップして開く
            </p>
          ) : (
            <ul className="kml-list">
              {kmlEntries.map((e) => (
                <li key={e.id} className={`kml-item kml-${e.status}`} title={e.message ?? e.name}>
                  <button
                    className="kml-name"
                    disabled={e.status !== 'loaded' || !flyToKml}
                    onClick={() => flyToKml?.(e.id)}
                  >
                    {e.name}
                  </button>
                  {e.status === 'loading' && <span className="kml-state">読込中</span>}
                  {e.status === 'error' && <span className="kml-state">エラー</span>}
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
        <p className="phase-badge">Phase 0 — 基盤構築中</p>
      </div>
    </aside>
  )
}
