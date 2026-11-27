// 使い方: pnpm validate:kml:xsd11 [--schema 2.2|2.3] <file.kml>...
// Java の Apache Xerces-J（XSD 1.1）で KML 2.3 の XSD（既定）または 2.2 の XSD に対して検証する。要 Java（JRE 11 以上。javac は不要）。
import { ensureXerces, hasJava, validateXsd11 } from './xsd11/xerces.mjs'

const args = process.argv.slice(2)
let schema = '2.3'
const i = args.indexOf('--schema')
if (i >= 0) schema = args.splice(i, 2)[1]
if (args.length === 0) {
  console.error('usage: pnpm validate:kml:xsd11 [--schema 2.2|2.3] <file.kml>...')
  process.exit(2)
}
if (!hasJava()) {
  console.error('java が見つかりません（JRE 11 以上が必要です）')
  process.exit(2)
}
await ensureXerces()
const results = await validateXsd11(args, schema)
for (const r of results) {
  console.log(`${r.valid ? 'OK  ' : 'NG  '} ${r.file}`)
  for (const e of r.errors) console.log(`      ${e}`)
}
process.exit(results.every((r) => r.valid) ? 0 : 1)
