import MapView from './components/MapView'
import NavaraView from './components/NavaraView'
import CesiumView from './components/CesiumView'
import Sidebar from './components/Sidebar'
import Statusbar from './components/Statusbar'
import { useEngineStore } from './store/engineStore'
import './App.css'

export default function App() {
  const engine = useEngineStore((s) => s.engine)

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="map-area">
        {/* MapLibre は常にマウント、非表示時は display:none */}
        <div className={engine === '2d-maplibre' ? 'engine-visible' : 'engine-hidden'}>
          <MapView />
        </div>
        {/* Navara は選択時のみ初期化 */}
        <NavaraView visible={engine === '3d-navara'} />
        {/* Cesium も選択時のみ初期化 */}
        <CesiumView visible={engine === '3d-cesium'} />
      </main>
      <Statusbar />
    </div>
  )
}
