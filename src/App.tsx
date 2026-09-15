import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import Statusbar from './components/Statusbar'
import './App.css'

export default function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="map-area">
        <MapView />
      </main>
      <Statusbar />
    </div>
  )
}
