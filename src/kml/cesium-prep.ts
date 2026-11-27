import { readKmlFile, writeKmz } from './kmz'

// Cesium の KmlDataSource に渡す前の下ごしらえ。
// KmlDataSource は viewRefreshMode=onRegion の NetworkLink を警告つきで無視し、onStop は取得できるものの、
// 実測では URL の BBOX が常に全世界（-180,-90,180,90）で、表示範囲が反映されなかった（原因は未特定）。
// そこで表示範囲に連動する 2 つのモードは Cesium に渡さず取り除き、linkManager が取得して派生エントリとして描かせる。

/** 表示範囲に連動する viewRefreshMode（linkManager が担当するもの） */
export const VIEW_DRIVEN_MODES = ['onStop', 'onRegion']

/** 名前空間に依らず、子孫のうち localName が一致する最初の要素 */
const child = (el: Element, name: string) => Array.from(el.getElementsByTagName('*')).find((e) => e.localName === name)

/**
 * NetworkLink のうち viewRefreshMode が onStop / onRegion のものを取り除いた KML 文字列。
 * 該当が無ければ null（呼び出し側は元のファイルをそのまま使う）
 */
export function stripViewDrivenLinks(kml: string): string | null {
  const doc = new DOMParser().parseFromString(kml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  let removed = 0
  for (const nl of Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'NetworkLink')) {
    const link = child(nl, 'Link') ?? child(nl, 'Url')
    const mode = link && child(link, 'viewRefreshMode')?.textContent?.trim()
    if (mode && VIEW_DRIVEN_MODES.includes(mode)) {
      nl.parentNode?.removeChild(nl)
      removed++
    }
  }
  return removed ? new XMLSerializer().serializeToString(doc) : null
}

/** Cesium に渡すファイル。取り除く NetworkLink が無ければ元のファイルのまま。KMZ は同梱ファイルを保って組み直す */
export async function prepareForCesium(file: File): Promise<File> {
  const { kml, files } = await readKmlFile(file)
  const stripped = stripViewDrivenLinks(kml)
  if (stripped === null) return file
  const isKmz = Object.keys(files).length > 0 || /\.kmz$/i.test(file.name)
  return isKmz
    ? new File([writeKmz(stripped, files) as BlobPart], file.name.replace(/\.[^.]*$/, '') + '.kmz')
    : new File([stripped], file.name)
}
