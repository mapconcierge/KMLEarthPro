import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const ICON_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

export interface KmlSource {
  kml: string
  /** KMZ 内の相対パス → Blob URL（アイコン等）。KML 単体では空 */
  resources: Record<string, string>
}

/** .kml / .kmz を読み、KML 文字列と同梱リソースを返す */
export async function readKmlFile(file: File): Promise<KmlSource> {
  const buf = new Uint8Array(await file.arrayBuffer())
  // ZIP のシグネチャ "PK" で判定（拡張子偽装に強い）
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return { kml: strFromU8(buf), resources: {} }

  const entries = unzipSync(buf)
  const names = Object.keys(entries)
  // KMZ の仕様では最初の .kml がメイン文書（通常は doc.kml）
  const main = names.find((n) => n.toLowerCase() === 'doc.kml') ?? names.find((n) => /\.kml$/i.test(n))
  if (!main) throw new Error('KMZ に .kml が含まれていません')

  const resources: Record<string, string> = {}
  for (const n of names) {
    if (n === main || n.endsWith('/')) continue
    const mime = ICON_MIME[n.split('.').pop()?.toLowerCase() ?? '']
    if (mime) resources[n] = URL.createObjectURL(new Blob([entries[n] as BlobPart], { type: mime }))
  }
  return { kml: strFromU8(entries[main]), resources }
}

/** KML 文字列を doc.kml として KMZ 化する（同梱リソースは今回未対応） */
export function writeKmz(kml: string): Uint8Array {
  return zipSync({ 'doc.kml': strToU8(kml) })
}
