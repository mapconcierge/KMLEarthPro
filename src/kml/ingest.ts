import { useKmlStore } from '../store/kmlStore'
import { readKmlFile } from './kmz'
import { parseKml } from './parse'
import { validateKmlSemantics } from './validate'

export const KML_PATTERN = /\.(kml|kmz)$/i

/**
 * ファイルを読み込み、共通の文書モデルとして kmlStore へ登録する。
 * 描画は各エンジンのビューが store を購読して行う（エンジンを切り替えても文書は残る）。
 */
export async function ingestKmlFile(file: File): Promise<void> {
  const { add, update } = useKmlStore.getState()
  const id = crypto.randomUUID()
  add({ id, name: file.name, status: 'loading', file })
  try {
    const { kml, resources, files } = await readKmlFile(file)
    const doc = parseKml(kml)
    if (doc.warnings.length) console.warn(`[KML] ${file.name}:`, doc.warnings)
    // 仕様上の制約の検査（描画は止めず、問題をコンソールへ出すだけ）
    const issues = validateKmlSemantics(kml)
    if (issues.length) {
      console.warn(`[KML] ${file.name}: 仕様の検査で ${issues.length} 件`, issues.map((i) => `${i.rule} [${i.severity}] ${i.where}: ${i.message}`))
    }
    // KMZ 内の文書は、NetworkLink の相対 href を同梱ファイルから解決する（dir はアーカイブ内のルート）
    const base = /\.kmz$/i.test(file.name) ? { dir: '' } : {}
    update(id, { status: 'loaded', name: doc.root.name ?? file.name, doc, resources, files, base, depth: 0 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[KML] load failed:', msg)
    update(id, { status: 'error', message: msg })
  }
}
