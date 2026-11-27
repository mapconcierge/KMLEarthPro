// KML 2.2 の XSD（fixtures/schemas。OGC 配布物。xAL の参照だけローカルパスに書き換え。KML 2.3 は同じ名前空間で、2.3 の XSD は XSD 1.1 のため libxml2 では読めない）で検証する。
// Node 専用（xmllint-wasm = libxml2 の WASM）。アプリ本体のバンドルには含めない。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateXML } from 'xmllint-wasm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const schemaDir = join(root, 'fixtures/schemas')
const read = (n: string) => readFileSync(join(schemaDir, n), 'utf8')
// 主スキーマを先頭に、依存を preload へ
const schema = [{ fileName: 'ogckml22.xsd', contents: read('ogckml22.xsd') }]
const preload = ['atom-author-link.xsd', 'xAL.xsd'].map((n) => ({ fileName: n, contents: read(n) }))

export interface XsdResult {
  valid: boolean
  errors: string[]
}

export async function validateKmlXsd(xml: string, fileName = 'doc.kml'): Promise<XsdResult> {
  const r = await validateXML({ xml: [{ fileName, contents: xml }], schema, preload })
  return { valid: r.valid, errors: r.errors.map((e) => e.message) }
}

export const fixtureDir = join(root, 'fixtures/kml')
export const listKml = (dir: string) =>
  readdirSync(join(fixtureDir, dir))
    .filter((f) => f.endsWith('.kml'))
    .sort()
    .map((f) => ({ name: f, path: join(fixtureDir, dir, f), text: readFileSync(join(fixtureDir, dir, f), 'utf8') }))
