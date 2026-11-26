import { useMemo } from 'react'
import { expandBalloonText, sanitizeHtml } from '../kml/sanitize'
import { resolveStyle } from '../kml/style'
import { featureAtPath } from '../kml/target'
import { useKmlStore } from '../store/kmlStore'
import './Balloon.css'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** 選択中のフィーチャの名前・説明（BalloonStyle の text があればそれ）を地図の上に出す */
export default function Balloon() {
  const sel = useKmlStore((s) => s.selection)
  const entry = useKmlStore((s) => (sel ? s.entries.find((e) => e.id === sel.id) : undefined))
  const content = useMemo(() => {
    if (!sel || !entry?.doc) return null
    const f = featureAtPath(entry.doc, sel.path)
    if (!f) return null
    const name = f.name ?? ''
    const desc = f.description ?? ''
    const tpl = resolveStyle(entry.doc, f)?.balloon?.text
    // フォルダは説明か BalloonStyle がある時だけ出す（ツリーで選んだだけでは出さない）
    if (f.kind !== 'Placemark' && !desc && !tpl) return null
    if (!name && !desc && !tpl) return null
    const html = tpl
      ? sanitizeHtml(expandBalloonText(tpl, escapeHtml(name), desc))
      : `${name ? `<h3>${escapeHtml(name)}</h3>` : ''}${sanitizeHtml(desc)}`
    // タグの無い説明は改行を保つ
    return { html, plain: !/<[a-z][\s\S]*>/i.test(tpl ?? desc) }
  }, [sel, entry])

  if (!content) return null
  return (
    <aside className="kml-balloon" role="dialog" aria-label="Placemark の情報">
      <button className="kml-balloon-close" aria-label="閉じる" onClick={() => useKmlStore.getState().select(null)}>
        ×
      </button>
      <div className={`kml-balloon-body ${content.plain ? 'plain' : ''}`} dangerouslySetInnerHTML={{ __html: content.html }} />
    </aside>
  )
}
