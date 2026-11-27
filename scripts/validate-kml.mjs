// 使い方: pnpm validate:kml <file.kml>...   KML の XSD（KML 2.2 の XSD。名前空間は 2.3 と共通）で検証する
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateXML } from 'xmllint-wasm'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/schemas')
const read = (n) => readFileSync(join(dir, n), 'utf8')
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: pnpm validate:kml <file.kml>...')
  process.exit(2)
}
let failed = 0
for (const f of files) {
  const r = await validateXML({
    xml: [{ fileName: f, contents: readFileSync(f, 'utf8') }],
    schema: [{ fileName: 'ogckml22.xsd', contents: read('ogckml22.xsd') }],
    preload: ['atom-author-link.xsd', 'xAL.xsd'].map((n) => ({ fileName: n, contents: read(n) })),
  })
  console.log(`${r.valid ? 'OK  ' : 'NG  '} ${f}`)
  for (const e of r.errors) console.log(`      ${e.message}`)
  if (!r.valid) failed += 1
}
process.exit(failed ? 1 : 0)
