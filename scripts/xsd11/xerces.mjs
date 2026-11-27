// Apache Xerces-J 2.12.2（XML Schema 1.1 版）を取得・検証して、Java で KML の XSD 1.1 検証を行う。
// jar は Git に入れず、.cache/ へ取得する（配布元のチェックサムで検証してから展開）。
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const XERCES_DIR = join(root, '.cache/xerces-2.12.2-xsd11')
const ZIP = 'Xerces-J-bin.2.12.2-xml-schema-1.1.zip'
const BASE = 'https://archive.apache.org/dist/xerces/j/binaries/'
/** XSD 1.1 の検証に必要な jar（サンプル・シリアライザは不要） */
// xercesSamples.jar は検証ツール jaxp.SourceValidator のため。xml-apis.jar は JDK 8 以前向けで JDK 9 以降では不要
const JARS = ['xercesImpl.jar', 'xercesSamples.jar', 'resolver.jar', 'icu4j.jar', 'cupv10k-runtime.jar']
const isJar = (n) => JARS.includes(n) || /^org\.eclipse\.wst\.xml\.xpath2\.processor_.*\.jar$/.test(n)

export const SCHEMAS = {
  '2.3': join(root, 'fixtures/schemas/kml23/ogckml23.xsd'),
  '2.2': join(root, 'fixtures/schemas/ogckml22.xsd'),
}

export function hasJava() {
  return spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0
}

export function hasXerces() {
  return existsSync(join(XERCES_DIR, 'xercesImpl.jar'))
}

/** 配布元の .sha512（"ファイル名: 8 桁ずつ区切りの 16 進"）を、小文字の 16 進へ */
function parseSha512(text) {
  return text.slice(text.indexOf(':') + 1).replace(/\s+/g, '').toLowerCase()
}

/** Xerces を取得して .cache/ へ展開する（取得済みなら何もしない）。チェックサム不一致なら例外 */
export async function ensureXerces() {
  if (hasXerces()) return XERCES_DIR
  const get = async (name) => {
    const res = await fetch(BASE + name)
    if (!res.ok) throw new Error(`${BASE + name}: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const [zip, sum] = await Promise.all([get(ZIP), get(`${ZIP}.sha512`)])
  const expected = parseSha512(new TextDecoder().decode(sum))
  const actual = createHash('sha512').update(zip).digest('hex')
  if (actual !== expected) throw new Error(`チェックサム不一致: 期待 ${expected.slice(0, 16)}… 実際 ${actual.slice(0, 16)}…`)
  mkdirSync(XERCES_DIR, { recursive: true })
  let n = 0
  for (const [path, data] of Object.entries(unzipSync(zip))) {
    const name = path.split('/').pop()
    if (name && isJar(name)) {
      writeFileSync(join(XERCES_DIR, name), data)
      n += 1
    }
  }
  if (!hasXerces()) throw new Error('xercesImpl.jar が見つかりません')
  writeFileSync(join(XERCES_DIR, 'SOURCE.txt'), `${BASE}${ZIP}\nsha512 ${actual}\n${n} jars\n`)
  return XERCES_DIR
}

/**
 * 1 ファイルを XSD 1.1 で検証する。{file, valid, errors[]} を返す。
 *
 * 検証には Xerces 同梱のサンプル jaxp.SourceValidator（-xsd11）を使う。JRE だけの環境（javac が無い）でも動かすため、
 * 自前の Java コードはコンパイルしない。
 * ファイルごとに別の JVM で実行する: 複数ファイルを 1 回で渡すと、xs:ID の記録が文書をまたいで持ち越され、
 * 別のファイルで同じ id を使っただけで「重複」と誤判定される（実際に起きた）
 */
function validateOne(file, xsd) {
  return new Promise((resolve, reject) => {
    // エラー（標準エラー）とファイル行（標準出力）の順序が大事なので、sh で 2>&1 にして 1 本の出力として読む
    // （引数は "$@" で渡すのでクォートの問題は起きない）
    const p = spawn('sh', [
      '-c', 'exec "$@" 2>&1', 'sh',
      'java', '-cp', join(XERCES_DIR, '*'), 'jaxp.SourceValidator', '-xsd11', '-a', pathToFileURL(xsd).href, '-i', pathToFileURL(file).href,
    ])
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', reject)
    p.on('close', () => {
      const errors = out
        .split('\n')
        .filter((l) => /^\[(Error|Fatal Error)\]/.test(l))
        .map((l) => l.replace(/^\[[^\]]+\]\s*/, ''))
      // 「file:///…: N ms」の行が無いのは、検証が完了しなかったということ（スキーマが読めない等）。成功扱いにしない
      if (!/^file:\S+: \d+ ms$/m.test(out)) {
        reject(new Error(`XSD 1.1 の検証が完了しませんでした（${file}）: ${out.trim().slice(0, 600)}`))
        return
      }
      resolve({ file, valid: errors.length === 0, errors })
    })
  })
}

/**
 * 複数ファイルを XSD 1.1 で検証する（files と同じ順の [{file, valid, errors[]}]）。並列数は 4。
 * schema: KML のバージョン（'2.3' | '2.2'）または XSD のパス
 */
export async function validateXsd11(files, schema = '2.3') {
  if (!hasXerces()) throw new Error('Xerces が未取得です（pnpm xsd11:setup）')
  const xsd = SCHEMAS[schema] ?? schema
  const results = new Array(files.length)
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const i = next++
      results[i] = await validateOne(files[i], xsd)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker))
  return results
}
