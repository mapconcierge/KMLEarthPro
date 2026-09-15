import { useEffect, useRef } from 'react'
import { Map, NavigationControl, ScaleControl, GlobeControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './MapView.css'

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [0, 20],
      zoom: 2,
    })
    mapRef.current = map

    map.on('load', () => {
      map.setProjection({ type: 'globe' })
    })

    map.addControl(new NavigationControl(), 'top-right')
    map.addControl(new GlobeControl(), 'top-right')
    map.addControl(new ScaleControl(), 'bottom-right')

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="map-view" />
}
