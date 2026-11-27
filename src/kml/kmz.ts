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
  /**
   * KMZ 内のメイン文書以外のファイルの中身（相対パス → バイト列）。画像以外（モデル・別の .kml など）も含む。
   * KMZ として保存し直すときにそのまま書き戻す（Blob URL からは元のバイト列を復元できないため保持する）
   */
  files: Record<string, Uint8Array>
}

/** .kml / .kmz を読み、KML 文字列と同梱リソースを返す */
export async function readKmlFile(file: File): Promise<KmlSource> {
  const buf = new Uint8Array(await file.arrayBuffer())
  // ZIP のシグネチャ "PK" で判定（拡張子偽装に強い）
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return { kml: strFromU8(buf), resources: {}, files: {} }

  const entries = unzipSync(buf)
  const names = Object.keys(entries)
  // メイン文書はアーカイブのルート直下の .kml（通常は doc.kml）。複数あれば最初のエントリ（OGC 12-007r2 付録 C.1）。
  // サブフォルダ内の .kml（NetworkLink 先など）はメインにしない
  const rootKml = names.filter((n) => !n.includes('/') && /\.kml$/i.test(n))
  const main = rootKml.find((n) => n.toLowerCase() === 'doc.kml') ?? rootKml[0]
  if (!main) throw new Error('KMZ に .kml が含まれていません')

  const resources: Record<string, string> = {}
  const files: Record<string, Uint8Array> = {}
  for (const n of names) {
    if (n === main || n.endsWith('/')) continue
    files[n] = entries[n]
    const mime = ICON_MIME[n.split('.').pop()?.toLowerCase() ?? '']
    if (mime) resources[n] = URL.createObjectURL(new Blob([entries[n] as BlobPart], { type: mime }))
  }
  return { kml: strFromU8(entries[main]), resources, files }
}

/** 圧縮済み形式は再圧縮しても縮まないので、無圧縮で格納する */
const STORED = /\.(png|jpe?g|gif|webp|zip|kmz)$/i

/**
 * KML 文字列を doc.kml として KMZ 化する。files（読み込んだ KMZ の同梱ファイル）はそのまま書き戻す。
 * doc.kml を先頭に置く（KMZ の仕様: 最初の .kml がメイン文書）。files に doc.kml があっても KML 文字列を優先する
 */
export function writeKmz(kml: string, files: Record<string, Uint8Array> = {}): Uint8Array {
  const zip: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { 'doc.kml': strToU8(kml) }
  for (const [name, data] of Object.entries(files)) {
    if (name === 'doc.kml') continue
    zip[name] = STORED.test(name) ? [data, { level: 0 }] : data
  }
  return zipSync(zip as never)
}
