import type { Evidence, UpdateOp } from '../types'

export type NoteData = { title: string; topic: string; learned: string; updated: string; sources: string[]; tags: string[]; body: string; evidence: string[]; related: string[] }

export const HUB_START = '<!-- obsidian-knowledge:start -->'
export const HUB_END = '<!-- obsidian-knowledge:end -->'

const links = (names: string[]) => names.map((n) => `[[${n}]]`).join(', ')

export function renderNote(n: NoteData): string {
  const head = ['---', `topic: ${n.topic}`, `learned: ${n.learned}`, `updated: ${n.updated}`, 'sources:', ...n.sources.map((s) => `  - ${s}`), `tags: [${n.tags.join(', ')}]`, '---']
  const related = n.related.length ? `\n\n## Related\n\n${links(n.related)}` : ''
  return `${head.join('\n')}\n\n# ${n.title}\n\n${n.body}\n\n## Evidence\n\n${n.evidence.join('\n')}${related}\n`
}

export function parseFrontmatter(text: string): { topic?: string; learned?: string; updated?: string; sources: string[]; tags: string[] } {
  const out: { topic?: string; learned?: string; updated?: string; sources: string[]; tags: string[] } = { sources: [], tags: [] }
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1]
  if (!block) return out
  let inSources = false
  for (const line of block.split('\n')) {
    const item = /^\s+- (.*)$/.exec(line)
    if (inSources && item) {
      out.sources.push(item[1]!.trim())
      continue
    }
    inSources = false
    const kv = /^(\w+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]!
    const value = kv[2]!
    if (key === 'sources') inSources = true
    else if (key === 'tags') out.tags = value.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim()).filter(Boolean)
    else if (key === 'topic' || key === 'learned' || key === 'updated') out[key] = value
  }
  return out
}

export function evidenceLine(e: Evidence, date: string): string {
  return `- ${e.source}: "${e.quote}" (${date})`
}

export function applyUpdate(text: string, op: UpdateOp, date: string, source: string): string {
  let t = text
  if (/^---\n[\s\S]*?\n---/.test(t)) {
    t = t.replace(/^updated: .*$/m, `updated: ${date}`)
    // Add the source after the last item of the sources list.
    t = t.replace(/^(sources:\n(?:  - .*\n)*)/m, `$1  - ${source}\n`)
  }
  const lines = op.evidence.map((e) => evidenceLine(e, date)).join('\n')
  const at = t.indexOf('\n## Evidence\n')
  if (at < 0) {
    const related = op.related.length ? `\n\n## Related\n\n${links(op.related)}` : ''
    return `${t.trimEnd()}\n\n${op.addition}\n\n## Evidence\n\n${lines}${related}\n`
  }
  const before = t.slice(0, at).trimEnd()
  const rest = t.slice(at + 1)
  const rel = rest.indexOf('\n## Related')
  const evidence = (rel < 0 ? rest : rest.slice(0, rel)).trimEnd()
  let related = rel < 0 ? '' : rest.slice(rel + 1).trimEnd()
  const fresh = op.related.filter((r) => !related.includes(`[[${r}]]`))
  if (fresh.length) related = related ? `${related}, ${links(fresh)}` : `## Related\n\n${links(fresh)}`
  return `${before}\n\n${op.addition}\n\n${evidence}\n${lines}${related ? `\n\n${related}` : ''}\n`
}

export function renderHubBlock(notes: string[], subfolders: string[]): string {
  const item = (n: string) => `- [[${n}]]`
  return [HUB_START, ...[...subfolders].sort().map(item), ...[...notes].sort().map(item), HUB_END].join('\n')
}

export function withHubBlock(existing: string | undefined, title: string, block: string): string {
  if (existing === undefined) return `# ${title}\n\n${block}\n`
  const start = existing.indexOf(HUB_START)
  const end = existing.indexOf(HUB_END)
  if (start >= 0 && end > start) return existing.slice(0, start) + block + existing.slice(end + HUB_END.length)
  return `${existing.trimEnd()}\n\n${block}\n`
}

export function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
