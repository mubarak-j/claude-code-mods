import type { EngineInterface } from 'claude-code'
import type { DraftItem, DraftOp, NewOp, UpdateOp } from '../types'
import { MODEL } from './draft'
import { applyUpdate, evidenceLine, renderHubBlock, renderNote, withHubBlock } from './note'
import { removeItem, replaceItem } from './queue'
import { type NoteFile, type Vault, hash, insidePath, listNotes, outsideTitles, uniqueTitle } from './vault'

type $ = EngineInterface

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const lastOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const titleOf = (path: string) => lastOf(path).replace(/\.md$/, '')
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const uniq = (xs: string[]) => [...new Set(xs)]

async function must($: $, v: Vault, rel: string): Promise<string> {
  const abs = await insidePath($, v, rel)
  if (abs === undefined) throw new Error(`outside the mod folder: ${rel}`)
  return abs
}

async function write($: $, v: Vault, rel: string, text: string) {
  const abs = await must($, v, rel)
  const r = await $.process.run(['mkdir', '-p', abs.slice(0, abs.lastIndexOf('/'))])
  if (r.exitCode !== 0) throw new Error(`mkdir failed: ${r.stderr}`)
  await $.fs.write(abs, text)
}

export async function redraft($: $, v: Vault, item: DraftItem, current: string, path: string): Promise<DraftItem | undefined> {
  const facts = item.ops.map((o) => (o.kind === 'new' ? o.body : o.addition)).join('\n\n')
  const prompt = `Merge these new facts into the note below. Reply with only JSON: {"addition": "..."}. The addition is plain sentences to append to the note body. Leave out anything the note already says.\n\nNew facts:\n${facts}\n\nCurrent note:\n${current}`
  const r = await $.model.complete({ model: MODEL, maxTokens: 4000, prompt })
  if (!r.isAnswered) return undefined
  try {
    const body = /\{[\s\S]*\}/.exec(r.text)?.[0] ?? ''
    const addition = (JSON.parse(body) as { addition?: unknown }).addition
    if (typeof addition !== 'string' || !addition.trim()) return undefined
    const op: UpdateOp = { kind: 'update', path, addition, related: uniq(item.ops.flatMap((o) => o.related)), evidence: item.ops.flatMap((o) => o.evidence), baseHash: hash(current) }
    return { id: item.id, kind: 'update', target: path, ops: [op], sources: item.sources }
  } catch {
    return undefined
  }
}

async function requeue($: $, v: Vault, item: DraftItem, current: string, path: string) {
  const next = await redraft($, v, item, current, path)
  if (!next) return 'failed' as const
  await replaceItem($, v.root, next)
  return 'requeued' as const
}

const hubTitle = (notes: NoteFile[], folder: string, taken: Set<string>) =>
  notes.find((n) => n.folder === folder && n.isHub)?.title ?? uniqueTitle(lastOf(folder), taken)

export async function refreshHubs($: $, v: Vault, folders: string[]): Promise<void> {
  const notes = await listNotes($, v)
  const taken = await outsideTitles($, v)
  const targets = uniq(folders.flatMap((f) => [f, dirOf(f)])).filter(Boolean)
  for (const folder of targets) {
    const own = notes.filter((n) => n.folder === folder && !n.isHub).map((n) => n.title)
    const subs = uniq(notes.map((n) => n.folder).filter((f) => f.startsWith(`${folder}/`)).map((f) => `${folder}/${f.slice(folder.length + 1).split('/')[0]}`))
    const hub = notes.find((n) => n.folder === folder && n.isHub)
    const title = hubTitle(notes, folder, taken)
    const path = hub?.path ?? `${folder}/${title}.md`
    const abs = await must($, v, path)
    const existing = hub ? await $.fs.read(abs) : undefined
    await write($, v, path, withHubBlock(existing, title, renderHubBlock(own, subs.map((s) => hubTitle(notes, s, taken)))))
  }
}

async function writeNew($: $, v: Vault, folder: string, title: string, ops: DraftOp[], sources: string[], today: string) {
  const note = renderNote({
    title,
    topic: folder,
    learned: today,
    updated: today,
    sources,
    tags: uniq(ops.flatMap((o) => (o.kind === 'new' ? o.tags : []))),
    body: ops.map((o) => (o.kind === 'new' ? o.body : o.addition)).join('\n\n'),
    evidence: ops.flatMap((o) => o.evidence.map((e) => evidenceLine(e, today))),
    related: uniq(ops.flatMap((o) => o.related)),
  })
  await write($, v, folder ? `${folder}/${title}.md` : `${title}.md`, note)
}

export async function approve($: $, v: Vault, item: DraftItem, today: string): Promise<'written' | 'requeued' | 'failed'> {
  let folder: string
  try {
    const notes = await listNotes($, v)
    if (item.kind === 'new') {
      const op = item.ops[0] as NewOp
      folder = op.folder
      if (folder) await must($, v, folder)
      // A title equal to its folder name would read as the hub.
      const last = lastOf(folder)
      const title = last && [last, `${last} (Claude)`].some((t) => same(t, op.title)) ? `${op.title} overview` : op.title
      const clash = notes.find((n) => !n.isHub && same(n.title, title))
      if (clash) {
        return await requeue($, v, item, await $.fs.read(await must($, v, clash.path)), clash.path)
      }
      const taken = await outsideTitles($, v)
      for (const n of notes) if (n.isHub) taken.add(n.title.toLowerCase())
      await writeNew($, v, folder, uniqueTitle(title, taken), item.ops, item.sources, today)
    } else {
      let path = item.target
      let abs = await must($, v, path)
      if (!(await $.fs.exists(abs))) {
        const moved = notes.find((n) => !n.isHub && same(n.title, titleOf(path)))
        if (moved) {
          path = moved.path
          abs = await must($, v, path)
        }
      }
      folder = dirOf(path)
      if (await $.fs.exists(abs)) {
        const current = await $.fs.read(abs)
        if (hash(current) !== (item.ops[0] as UpdateOp).baseHash) return await requeue($, v, item, current, path)
        // shortcut: every op records the first source, upgrade if per-op sources matter.
        const text = item.ops.reduce((t, o) => applyUpdate(t, o as UpdateOp, today, item.sources[0] ?? ''), current)
        await $.fs.write(abs, text)
      } else {
        await writeNew($, v, folder, titleOf(path), item.ops, item.sources, today)
      }
    }
    await removeItem($, v.root, item.id)
  } catch {
    return 'failed'
  }
  // The note is written and the item gone, so a hub failure must not report failure; the next approval rebuilds the hub.
  await refreshHubs($, v, [folder]).catch(() => {})
  return 'written'
}
