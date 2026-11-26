import type { KmlEntry } from '../store/kmlStore'
import { writeKmz } from './kmz'
import { serializeKml } from './serialize'

/** 文書モデルを .kml / .kmz としてダウンロードする（KMZ 内の同梱リソースは未対応） */
export function saveKml(entry: KmlEntry, format: 'kml' | 'kmz'): void {
  if (!entry.doc) return
  const kml = serializeKml(entry.doc)
  const blob =
    format === 'kml'
      ? new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' })
      : new Blob([writeKmz(kml) as BlobPart], { type: 'application/vnd.google-earth.kmz' })
  const base = (entry.name || 'kml').replace(/\.(kml|kmz)$/i, '').replace(/[\\/:*?"<>|]/g, '_')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${base}.${format}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
