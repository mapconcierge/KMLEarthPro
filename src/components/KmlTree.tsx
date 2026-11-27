import { useEffect, useMemo, useRef, useState } from 'react'
import { useKmlStore } from '../store/kmlStore'
import { resolveFlyView, type FeaturePath } from '../kml/target'
import { childrenOf, type Feature, type KmlDocument } from '../kml/types'
import './KmlTree.css'

/** 1 フォルダで一度に描画する子の上限（数千件の Placemark でサイドバーが重くなるのを防ぐ） */
const MAX_CHILDREN_RENDERED = 200

interface Props {
  /** 文書の ID。地図クリックの選択（kmlStore.selection）と突き合わせる */
  entryId: string
  doc: KmlDocument
  /** null のときは飛べない（エンジン未初期化など） */
  onFly: ((path: FeaturePath) => void) | null
}

/** KML のフォルダ/Placemark の木。Placemark（やフォルダ）を選ぶとその位置へ飛ぶ */
export default function KmlTree({ entryId, doc, onFly }: Props) {
  const sel = useKmlStore((s) => s.selection)
  const selected = sel?.id === entryId ? sel.path.join('/') : null
  const setSelected = (key: string) =>
    useKmlStore.getState().select({ id: entryId, path: key === '' ? [] : key.split('/').map(Number) })
  const root = doc.root
  return (
    <ul className="kml-tree">
      <Children entryId={entryId} doc={doc} parent={root} path={[]} selected={selected} setSelected={setSelected} onFly={onFly} />
    </ul>
  )
}

interface ChildrenProps extends Props {
  parent: Feature
  path: FeaturePath
  selected: string | null
  setSelected: (key: string) => void
}

function Children({ entryId, doc, parent, path, selected, setSelected, onFly }: ChildrenProps) {
  const all = childrenOf(parent)
  const shown = all.slice(0, MAX_CHILDREN_RENDERED)
  const rest = all.length - shown.length
  return (
    <>
      {shown.map((f, i) => (
        <Node key={i} entryId={entryId} doc={doc} feature={f} path={[...path, i]} selected={selected} setSelected={setSelected} onFly={onFly} />
      ))}
      {rest > 0 && <li className="kml-tree-more">ほか {rest} 件（省略）</li>}
    </>
  )
}

interface NodeProps extends Props {
  feature: Feature
  path: FeaturePath
  selected: string | null
  setSelected: (key: string) => void
}

function Node({ entryId, doc, feature, path, selected, setSelected, onFly }: NodeProps) {
  const [open, setOpen] = useState(feature.kind !== 'Placemark' && feature.kind !== 'NetworkLink' && feature.open)
  const key = path.join('/')
  const ref = useRef<HTMLLIElement>(null)
  // 選択が自分の子孫なら開き、自分なら見える位置へスクロールする（地図クリックで選ばれたとき用）
  useEffect(() => {
    if (selected === null) return
    if (selected.startsWith(key + '/')) setOpen(true)
    else if (selected === key) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, key])
  const label = feature.name?.trim() || (feature.kind === 'Placemark' ? '(名称なし)' : feature.kind === 'NetworkLink' ? '(ネットワークリンク)' : '(フォルダ)')
  // 視点もジオメトリも無いフィーチャは飛べない
  const canFly = useMemo(() => resolveFlyView(doc, path) !== undefined, [doc, path])
  const fly = () => {
    setSelected(key)
    onFly?.(path)
  }
  const cls = `kml-tree-label ${selected === key ? 'selected' : ''} ${feature.visibility ? '' : 'hidden'}`

  if (feature.kind === 'Placemark' || feature.kind === 'NetworkLink') {
    return (
      <li className="kml-tree-item" ref={ref}>
        <button className={cls} disabled={!canFly || !onFly} onClick={fly} title={label}>
          <span className="kml-tree-icon">{feature.kind === 'NetworkLink' ? '⛓' : '●'}</span>
          {label}
        </button>
      </li>
    )
  }
  return (
    <li className="kml-tree-item">
      <div className="kml-tree-folder">
        <button
          className="kml-tree-caret"
          aria-label={open ? '閉じる' : '開く'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <button className={cls} disabled={!canFly || !onFly} onClick={fly} title={label}>
          {label}
          <span className="kml-tree-count">{childrenOf(feature).length}</span>
        </button>
      </div>
      {open && (
        <ul className="kml-tree kml-tree-nested">
          <Children entryId={entryId} doc={doc} parent={feature} path={path} selected={selected} setSelected={setSelected} onFly={onFly} />
        </ul>
      )}
    </li>
  )
}
