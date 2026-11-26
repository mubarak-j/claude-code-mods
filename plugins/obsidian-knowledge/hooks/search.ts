import type { EngineInterface } from 'claude-code'
import { parseFrontmatter } from './note'
import { type NoteFile, type Vault, folders, listNotes } from './vault'

type E = EngineInterface
export type Hit = { title: string; path: string; excerpt: string; learned?: string; updated?: string; sources: string[] }

export async function search($: E, v: Vault, query: string, limit = 8): Promise<Hit[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const found: (Hit & { inTitle: boolean })[] = []
  for (const n of (await listNotes($, v)).filter((n) => !n.isHub)) {
    let text: string
    try {
      text = await $.fs.read(`${v.root}/${n.path}`)
    } catch {
      continue // An unreadable note is skipped.
    }
    const low = text.toLowerCase()
    const title = n.title.toLowerCase()
    if (!words.every((w) => title.includes(w) || low.includes(w))) continue
    const at = Math.max(0, low.indexOf(words.find((w) => low.includes(w)) ?? ''))
    const fm = parseFrontmatter(text)
    found.push({
      title: n.title,
      path: n.path,
      excerpt: text.slice(Math.max(0, at - 60), at + 140).replace(/\s+/g, ' ').trim(),
      learned: fm.learned,
      updated: fm.updated,
      sources: fm.sources,
      inTitle: words.some((w) => title.includes(w)),
    })
  }
  // Array.sort is stable, so equal ranks keep list order.
  return found.sort((a, b) => Number(b.inTitle) - Number(a.inTitle)).slice(0, limit).map(({ inTitle: _, ...h }) => h)
}

export function formatHits(hits: Hit[]): string {
  if (!hits.length) return 'No notes found.'
  return hits
    .map((h) => `${h.title} (${h.path})\nlearned ${h.learned ?? 'unknown'}, updated ${h.updated ?? 'unknown'}; sources: ${h.sources.join('; ') || 'none'}\n${h.excerpt}`)
    .join('\n\n')
}

export function topics(notes: NoteFile[]): string[] {
  return [...new Set(folders(notes).flatMap((f) => { const p = f.split('/'); return [p[0]!, p.slice(0, 2).join('/')] }))].sort()
}

export const toolDescription = (t: string[]) =>
  `Searches the knowledge vault that obsidian-knowledge keeps in Obsidian. Topics: ${t.length ? t.join(', ') : 'none yet'}. Each result is a lead to re-check, not a settled fact. It shows when the fact was learned and the session it came from.`
