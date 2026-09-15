import './Statusbar.css'

export default function Statusbar() {
  return (
    <footer className="statusbar">
      <span className="status-item">経度: —</span>
      <span className="status-item">緯度: —</span>
      <span className="status-item">標高: —</span>
      <span className="status-sep" />
      <span className="status-item engine-label">2D: MapLibre GL JS</span>
    </footer>
  )
}
