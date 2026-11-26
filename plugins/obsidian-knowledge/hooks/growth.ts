import type { EngineInterface } from 'claude-code'
import type { Move, MoveItem } from '../types'
import { MODEL } from './draft'
import { refreshHubs } from './apply'
import { droppedKey, enqueueMove, loadQueue, moveFingerprint } from './queue'
import { type NoteFile, type Vault, folders, listNotes, moveFile, safeRel } from './vault'

type $ = EngineInterface

export const SPLIT_AT = 12
export const MAX_DEPTH = 3

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const lastOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function crowded(notes: NoteFile[]): string[] {
  return folders(notes).filter((f) => notes.filter((n) => n.folder === f && !n.isHub).length > SPLIT_AT)
}

export function checkMoves(moves: Move[], notes: NoteFile[]): Move[] | undefined {
  const tos = new Set<string>()
  for (const m of moves) {
    if (!notes.some((n) => n.path === m.from) || lastOf(m.to) !== lastOf(m.from) || safeRel(m.to) === undefined) return undefined
    if (dirOf(m.to).split('/').length > MAX_DEPTH || tos.has(m.to)) return undefined
    tos.add(m.to)
  }
  return moves.length ? moves : undefined
}

async function ask($: $, prompt: string): Promise<{ moves?: Move[]; parent?: unknown } | undefined> {
  const r = await $.model.complete({ model: MODEL, maxTokens: 4000, prompt })
  if (!r.isAnswered) return undefined
  try {
    const body = /\{[\s\S]*\}/.exec(r.text)?.[0] ?? ''
    return JSON.parse(body) as { moves?: Move[]; parent?: unknown }
  } catch {
    return undefined
  }
}

const list = (notes: NoteFile[]) => notes.map((n) => n.path).join('\n')

export async function proposeSplit($: $, folder: string, notes: NoteFile[]): Promise<Omit<MoveItem, 'id'> | undefined> {
  const own = notes.filter((n) => n.folder === folder && !n.isHub)
  const reply = (await ask($, `The folder "${folder}" holds too many notes. Group them into subfolders by subject. Reply with only JSON: {"moves": [{"from": "<path>", "to": "${folder}/<Subfolder>/<same file name>"}]}. Keep every file name. Notes:\n${list(own)}`))
  const moves = Array.isArray(reply?.moves) ? checkMoves(reply.moves, own) : undefined
  return moves?.every((m) => m.to.startsWith(`${folder}/`)) ? { kind: 'split', folder, moves } : undefined
}

// `notes` is the whole vault listing, needed to check the moves; the brief's signature gains this fourth argument.
export async function proposeParent($: $, siblings: string[], base: string, notes: NoteFile[]): Promise<Omit<MoveItem, 'id'> | undefined> {
  const pre = base ? `${base}/` : ''
  const inSiblings = (n: NoteFile) => siblings.some((s) => n.folder === s || n.folder.startsWith(`${s}/`))
  const reply = await ask($, `These sibling folders sit side by side: ${siblings.join(', ')}. If three or more share one subject, name a parent folder and move their notes under it. Reply with only JSON: {"parent": "<name>", "moves": [{"from": "<path>", "to": "${pre}<name>/<old folder>/<same file name>"}]}, or {"parent": null}. Keep every file name. Notes:\n${list(notes.filter(inSiblings))}`)
  const name = reply?.parent
  if (typeof name !== 'string' || !name || name.includes('/') || !Array.isArray(reply?.moves)) return undefined
  const moves = checkMoves(reply.moves, notes)
  if (!moves) return undefined
  const grouped = new Set(moves.map((m) => m.from.slice(pre.length).split('/')[0]))
  if (grouped.size < 3 || [...grouped].some((g) => !siblings.includes(`${pre}${g}`)) || moves.some((m) => !m.to.startsWith(`${pre}${name}/`))) return undefined
  return { kind: 'parent', folder: `${pre}${name}`, moves }
}

export async function applyMoves($: $, v: Vault, item: MoveItem): Promise<void> {
  try {
    for (const m of item.moves) await moveFile($, v, m.from, m.to)
  } finally {
    // Hubs follow the moves already done, even when a later one fails.
    await refreshHubs($, v, [...new Set(item.moves.flatMap((m) => [dirOf(m.from), dirOf(m.to)]))].filter(Boolean))
  }
}

export async function afterWrite($: $, v: Vault, created: string | undefined, now: number): Promise<void> {
  const notes = await listNotes($, v)
  const queue = await loadQueue($, v.root)
  const dropped = ((await $.store.get(droppedKey(v.root))) as string[] | undefined) ?? []
  // A split here would be refused anyway, so spare the model call.
  const settled = (folder: string) =>
    folder.split('/').length >= MAX_DEPTH || dropped.includes(moveFingerprint({ kind: 'split', folder })) || queue.some((i) => !('ops' in i) && i.folder === folder)
  for (const folder of crowded(notes).filter((f) => !settled(f))) {
    const p = await proposeSplit($, folder, notes)
    if (p) await enqueueMove($, v.root, p, now)
  }
  if (!created) return
  const tops = folders(notes).filter((f) => !f.includes('/'))
  if (!tops.includes(created) || tops.length < 3) return
  const p = await proposeParent($, tops, '', notes)
  if (p) await enqueueMove($, v.root, p, now)
}
