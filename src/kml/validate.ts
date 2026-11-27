// XSD では表せない KML の制約（要素間の整合・値の範囲）を検査する。
// 根拠は OGC 12-007r2（KML 2.3）本文の "shall" の記述。ATS（OGC 14-068）本文は入手できておらず、
// ここは ATS の全テストの実装ではない（一部の項目に絞った検査）。出典を確認できていない項目は warning とする。
// DOMParser ベースなのでブラウザ・vitest(happy-dom) の両方で動く。

export type IssueSeverity = 'error' | 'warning'

export interface KmlIssue {
  severity: IssueSeverity
  /** 規則 ID（docs/kml-conformance.csv や fixtures と対応） */
  rule: string
  message: string
  /** 該当要素の目印（例: Placemark「名前」/ Point） */
  where: string
}

export const RULES = {
  styleUrlTarget: 'KML-V001', // styleUrl の #id は文書内の Style/StyleMap の id（12-007r2 の styleUrl の記述）
  extrudeAltitude: 'KML-V002', // extrude は altitudeMode が relativeToGround か absolute のとき
  tessellateClamp: 'KML-V003', // tessellate は altitudeMode が clampToGround のとき
  pairContent: 'KML-V004', // Pair は key と、styleUrl か Style/StyleMap を持つ
  lookAtRequired: 'KML-V005', // LookAt は longitude / latitude / range を持つ
  coordinateSyntax: 'KML-V006', // coordinates は lon,lat[,alt] の組。範囲は KML の座標参照系（LonLat84）
  ringClosed: 'KML-V007', // LinearRing は 4 点以上で閉じる（出典未確認・warning）
  lineMinPoints: 'KML-V008', // LineString は 2 点以上（出典未確認・warning）
} as const

const names = (el: Element) => Array.from(el.children).map((c) => c.localName)
const child = (el: Element, n: string) => Array.from(el.children).find((c) => c.localName === n)
const text = (el: Element, n: string) => child(el, n)?.textContent?.trim()

/** 目印用: 直近の Feature の name と、要素名 */
function where(el: Element): string {
  let f: Element | null = el
  while (f && !['Placemark', 'Folder', 'Document'].includes(f.localName)) f = f.parentElement
  const label = f && text(f, 'name')
  return `${label ? `${f!.localName}「${label}」/ ` : ''}${el.localName}`
}

const inUpdate = (el: Element) => {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.localName === 'Update') return true
  return false
}

function parseTuples(raw: string): { tuples: number[][]; bad: string[] } {
  const tuples: number[][] = []
  const bad: string[] = []
  for (const t of raw.trim().split(/\s+/).filter(Boolean)) {
    const n = t.split(',').map((x) => (x.trim() === '' ? NaN : Number(x)))
    if (n.length < 2 || n.length > 3 || n.some((v) => !Number.isFinite(v))) bad.push(t)
    else tuples.push(n)
  }
  return { tuples, bad }
}

export function validateKmlSemantics(xml: string): KmlIssue[] {
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  if (dom.getElementsByTagName('parsererror')[0]) return []
  const issues: KmlIssue[] = []
  const add = (severity: IssueSeverity, rule: string, message: string, el: Element) =>
    issues.push({ severity, rule, message, where: where(el) })

  const all = Array.from(dom.getElementsByTagName('*'))
  const styleIds = new Set(
    all.filter((e) => (e.localName === 'Style' || e.localName === 'StyleMap') && e.getAttribute('id')).map((e) => e.getAttribute('id')!),
  )

  for (const el of all) {
    switch (el.localName) {
      case 'styleUrl': {
        const v = el.textContent?.trim() ?? ''
        // 外部ファイル参照（file.kml#id）は検査しない。# で始まる文書内参照だけ
        if (v.startsWith('#') && !styleIds.has(v.slice(1))) {
          add('error', RULES.styleUrlTarget, `styleUrl "${v}" の参照先の Style/StyleMap が文書内に無い`, el)
        }
        break
      }
      case 'Point':
      case 'LineString':
      case 'LinearRing':
      case 'Polygon': {
        const mode = text(el, 'altitudeMode') ?? 'clampToGround'
        const flag = (n: string) => ['1', 'true'].includes((text(el, n) ?? '').toLowerCase())
        if (flag('extrude') && mode === 'clampToGround') {
          add('error', RULES.extrudeAltitude, 'extrude=1 には altitudeMode が relativeToGround か absolute 必要（現在 clampToGround）', el)
        }
        if (flag('tessellate') && mode !== 'clampToGround') {
          add('error', RULES.tessellateClamp, `tessellate=1 には altitudeMode=clampToGround が必要（現在 ${mode}）`, el)
        }
        break
      }
      case 'Pair': {
        const hasStyle = names(el).some((n) => n === 'styleUrl' || n === 'Style' || n === 'StyleMap')
        if (!inUpdate(el) && (!child(el, 'key') || !hasStyle)) {
          add('error', RULES.pairContent, 'Pair には key と、styleUrl か Style/StyleMap が必要', el)
        }
        break
      }
      case 'LookAt': {
        if (inUpdate(el)) break
        const missing = ['longitude', 'latitude', 'range'].filter((n) => !child(el, n))
        if (missing.length) add('error', RULES.lookAtRequired, `LookAt に ${missing.join(', ')} が無い`, el)
        break
      }
      case 'coordinates': {
        const parent = el.parentElement?.localName
        if (parent === 'LatLonQuad') break
        const { tuples, bad } = parseTuples(el.textContent ?? '')
        for (const t of bad) add('error', RULES.coordinateSyntax, `座標 "${t}" は lon,lat[,alt] の形式でない`, el)
        for (const [lon, lat] of tuples) {
          if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
            add('error', RULES.coordinateSyntax, `座標 ${lon},${lat} が経度 ±180 / 緯度 ±90 の範囲外`, el)
          }
        }
        if (parent === 'LinearRing' && bad.length === 0) {
          const first = tuples[0]
          const last = tuples[tuples.length - 1]
          const closed = first && last && first[0] === last[0] && first[1] === last[1]
          if (tuples.length < 4 || !closed) {
            add('warning', RULES.ringClosed, 'LinearRing は 4 点以上で、最初と最後の点が同じ（閉じている）必要がある（出典未確認）', el)
          }
        }
        if (parent === 'LineString' && bad.length === 0 && tuples.length < 2) {
          add('warning', RULES.lineMinPoints, 'LineString は 2 点以上必要（出典未確認）', el)
        }
        break
      }
    }
  }
  return issues
}
