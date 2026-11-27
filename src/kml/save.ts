import type { KmlEntry } from '../store/kmlStore'
import { writeKmz } from './kmz'
import { serializeKml } from './serialize'

/** 文書モデルを .kml / .kmz としてダウンロードする。KMZ では読み込み時の同梱ファイル（アイコン画像など）も書き戻す。KML 単体では同梱できない */
export function saveKml(entry: KmlEntry, format: 'kml' | 'kmz'): void {
  if (!entry.doc) return
  const kml = serializeKml(entry.doc)
  const blob =
    format === 'kml'
      ? new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' })
      : new Blob([writeKmz(kml, entry.files) as BlobPart], { type: 'application/vnd.google-earth.kmz' })
  const base = (entry.name || 'kml').replace(/\.(kml|kmz)$/i, '').replace(/[\\/:*?"<>|]/g, '_')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${base}.${format}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
