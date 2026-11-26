import { useKmlStore } from '../store/kmlStore'
import { readKmlFile } from './kmz'
import { parseKml } from './parse'

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
    const { kml, resources } = await readKmlFile(file)
    const doc = parseKml(kml)
    if (doc.warnings.length) console.warn(`[KML] ${file.name}:`, doc.warnings)
    update(id, { status: 'loaded', name: doc.root.name ?? file.name, doc, resources })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[KML] load failed:', msg)
    update(id, { status: 'error', message: msg })
  }
}
