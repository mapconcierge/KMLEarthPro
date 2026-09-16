import { useEngineStore } from '../store/engineStore'
import './Statusbar.css'

const ENGINE_LABELS = {
  '2d-maplibre': '2.75D: MapLibre GL JS',
  '3d-navara': '3D: Navara 0.1.1',
  '3d-cesium': '3D: CesiumJS',
}

export default function Statusbar() {
  const engine = useEngineStore((s) => s.engine)

  return (
    <footer className="statusbar">
      <span className="status-item">経度: —</span>
      <span className="status-item">緯度: —</span>
      <span className="status-item">標高: —</span>
      <span className="status-sep" />
      <span className="status-item engine-label">{ENGINE_LABELS[engine]}</span>
    </footer>
  )
}
