import { useEngineStore, type Engine } from '../store/engineStore'
import './Sidebar.css'

const ENGINES: { id: Engine; label: string; badge: string }[] = [
  { id: '2d-maplibre', label: 'MapLibre GL JS', badge: '2D' },
  { id: '3d-navara', label: 'Navara 3D', badge: '3D' },
]

export default function Sidebar() {
  const { engine, setEngine } = useEngineStore()

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
          <p className="placeholder-text">KML/KMZ ファイルをドロップして開く</p>
        </section>
        <section className="nav-section">
          <h2>レイヤー</h2>
          <ul className="layer-list">
            <li>
              <label>
                <input type="checkbox" defaultChecked /> OpenFreeMap
              </label>
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
