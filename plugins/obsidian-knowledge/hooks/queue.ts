import type { EngineInterface } from 'claude-code'
import type { Cursor, DraftItem, DraftOp, MoveItem, QueueItem } from '../types'
import { hash } from './vault'

type $ = EngineInterface

export const CURSORS = 'cursors'
export const queueKey = (root: string) => `queue:${root}`
export const droppedKey = (root: string) => `dropped:${root}`

// The probe showed $.store loses updates across processes (97 and 56 of 100), so each queue item is its own file.
const dirOf = (root: string) => `${root}/.obsidian-knowledge`
const stamp = (n: number) => String(n).padStart(15, '0')

export const targetOf = (op: DraftOp): string => (op.kind === 'update' ? op.path : op.folder ? `${op.folder}/${op.title}.md` : `${op.title}.md`)

export const fingerprint = (op: DraftOp): string => hash(`${targetOf(op).toLowerCase()}\n${(op.evidence[0]?.quote ?? '').replace(/\s+/g, ' ').trim()}`)

type Entry = { path: string; item: QueueItem }

async function entries($: $, root: string): Promise<Entry[]> {
  const dir = dirOf(root)
  const names = await $.fs.list(dir).then((l) => l.map((e) => e.name), () => [] as string[])
  const out: Entry[] = []
  for (const name of names.filter((n) => /^\d+-.+\.json$/.test(n)).sort()) {
    try {
      out.push({ path: `${dir}/${name}`, item: JSON.parse(await $.fs.read(`${dir}/${name}`)) as QueueItem })
    } catch {
      // A half-written or removed file is skipped.
    }
  }
  return out
}

async function put($: $, root: string, path: string, item: QueueItem) {
  await $.process.run(['mkdir', '-p', dirOf(root)])
  await $.fs.write(path, JSON.stringify(item))
}

export async function loadQueue($: $, root: string): Promise<QueueItem[]> {
  return (await entries($, root)).map((e) => e.item)
}

export async function enqueue($: $, root: string, ops: DraftOp[], source: string, now: number): Promise<number> {
  for (const op of ops) {
    const target = targetOf(op)
    const found = (await entries($, root)).find((e) => 'ops' in e.item && e.item.target === target)
    if (found) {
      const item = found.item as DraftItem
      item.ops.push(op)
      if (!item.sources.includes(source)) item.sources.push(source)
      await put($, root, found.path, item)
    } else {
      const id = hash(`${target}:${now}`)
      const item: DraftItem = { id, kind: op.kind, target, ops: [op], sources: [source] }
      await put($, root, `${dirOf(root)}/${stamp(now)}-${id}.json`, item)
    }
  }
  return (await entries($, root)).length
}

export async function enqueueMove($: $, root: string, item: Omit<MoveItem, 'id'>, now: number): Promise<number> {
  const all = await entries($, root)
  if (!all.some((e) => !('ops' in e.item) && e.item.folder === item.folder)) {
    const id = hash(`${item.kind}:${item.folder}:${now}`)
    await put($, root, `${dirOf(root)}/${stamp(now)}-${id}.json`, { ...item, id })
    return all.length + 1
  }
  return all.length
}

export async function replaceItem($: $, root: string, item: QueueItem): Promise<void> {
  const found = (await entries($, root)).find((e) => e.item.id === item.id)
  if (found) await put($, root, found.path, item)
}

export async function removeItem($: $, root: string, id: string): Promise<void> {
  const found = (await entries($, root)).find((e) => e.item.id === id)
  if (found) await $.process.run(['rm', found.path])
}

export async function dropItem($: $, root: string, id: string): Promise<void> {
  const found = (await loadQueue($, root)).find((i) => i.id === id)
  if (!found) return
  if ('ops' in found) {
    const seen = ((await $.store.get(droppedKey(root))) as string[] | undefined) ?? []
    await $.store.set(droppedKey(root), [...new Set([...seen, ...found.ops.map(fingerprint)])])
  }
  await removeItem($, root, id)
}

export async function isDropped($: $, root: string, op: DraftOp): Promise<boolean> {
  return (((await $.store.get(droppedKey(root))) as string[] | undefined) ?? []).includes(fingerprint(op))
}

export const allCursors = async ($: $): Promise<Record<string, Cursor>> => ((await $.store.get(CURSORS)) as Record<string, Cursor> | undefined) ?? {}

export const getCursor = async ($: $, session: string): Promise<Cursor | undefined> => (await allCursors($))[session]

export async function setCursor($: $, session: string, c: Cursor): Promise<void> {
  const all = await allCursors($) // Re-read right before the write to keep the lost-update window small.
  all[session] = c
  const keep = Object.entries(all).sort((a, b) => b[1].seen - a[1].seen).slice(0, 200)
  await $.store.set(CURSORS, Object.fromEntries(keep))
}
