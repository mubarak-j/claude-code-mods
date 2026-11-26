import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { DraftItem, QueueItem } from '../types'
import { approve } from './apply'
import { applyMoves } from './growth'
import { day, renderNote } from './note'
import { dropItem, loadQueue, removeItem, replaceItem } from './queue'
import { openVault } from './vault'

type $ = EngineInterface

export const PANE = 'vault-review'
// Change the tag when the fields change: it declines what an earlier version stored.
export const review = atom({ plugin: 'obsidian-knowledge', key: 'review' } as const, { index: 0, editing: false, rev: 0 }, { shape: 'review-1' })

export const FAILED = 'Approve failed. The item stays in the queue.'
export const REQUEUED = 'The note changed. A new draft is in the queue.'
let notice = '' // The last approve result, shown until the next action.
export const currentNotice = () => notice

async function bump($: $, patch: { index?: number; editing?: boolean } = {}) {
  await update($, review, (r) => ({ ...r, ...patch, rev: r.rev + 1 }))
}

export function itemView(item: QueueItem): { heading: string; text: string } {
  if (!('ops' in item)) return { heading: `[${item.kind}] ${item.folder}`, text: item.moves.map((m) => `${m.from} -> ${m.to}`).join('\n') }
  const heading = `[${item.kind}] ${item.target}`
  const evidence = item.ops.flatMap((o) => o.evidence.map((e) => `- ${e.source}: "${e.quote}"`))
  const first = item.ops[0]
  if (item.kind === 'new' && first?.kind === 'new') {
    const title = first.title
    const text = renderNote({ title, topic: first.folder, learned: '', updated: '', sources: item.sources, tags: first.tags, body: first.body, evidence, related: first.related })
    return { heading, text }
  }
  return { heading, text: [...item.ops.map((o) => (o.kind === 'update' ? o.addition : o.body)), '', 'Evidence:', ...evidence].join('\n') }
}

// shortcut: Edit changes the first op only, upgrade if a folded item needs per-op edits.
const bodyOf = (item: DraftItem) => {
  const op = item.ops[0]
  return op?.kind === 'new' ? op.body : (op?.addition ?? '')
}

export async function approveAt($: $, vaultFolder: string, id: string): Promise<void> {
  const v = await openVault($, vaultFolder)
  const item = (await loadQueue($, v.root)).find((i) => i.id === id)
  if (!item) return
  if ('ops' in item) {
    const r = await approve($, v, item, day(await $.clock.now()))
    notice = r === 'failed' ? FAILED : r === 'requeued' ? REQUEUED : ''
  } else {
    await applyMoves($, v, item)
    await removeItem($, v.root, item.id)
    notice = ''
  }
  await bump($)
}

export async function dropAt($: $, vaultFolder: string, id: string): Promise<void> {
  const v = await openVault($, vaultFolder)
  const item = (await loadQueue($, v.root)).find((i) => i.id === id)
  if (item) await dropItem($, v.root, item.id)
  notice = ''
  await bump($)
}

export async function saveEdit($: $, vaultFolder: string, id: string, body: string): Promise<void> {
  const v = await openVault($, vaultFolder)
  const item = (await loadQueue($, v.root)).find((i) => i.id === id)
  const op = item && 'ops' in item ? item.ops[0] : undefined
  if (item && 'ops' in item && op) await replaceItem($, v.root, { ...item, ops: [op.kind === 'new' ? { ...op, body } : { ...op, addition: body }, ...item.ops.slice(1)] as DraftItem['ops'] })
  notice = ''
  await bump($, { editing: false })
}

export async function startEdit($: $) {
  notice = ''
  await bump($, { editing: true })
}

export async function advance($: $, index: number) {
  notice = ''
  await bump($, { index, editing: false })
}

export function unavailable($: $, e: Parameters<$['ui']['resolve']>[0]) {
  const { Text } = $.ui.resolve(e)
  return <Text dimColor>Vault review is unavailable.</Text>
}

export async function renderPane($: $, e: Parameters<$['ui']['resolve']>[0], vaultFolder: string) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const queue = await loadQueue($, (await openVault($, vaultFolder)).root)
  const state = await read($, review)
  if (queue.length === 0) return <Text dimColor>No vault drafts pending.</Text>
  const index = Math.min(state.index, queue.length - 1)
  const item = queue[index] as QueueItem
  const { heading, text } = itemView(item)
  const editable = 'ops' in item
  return (
    <Box flexDirection="column">
      <Text dimColor>{queue.length} pending</Text>
      <Text bold>{heading}</Text>
      {state.editing && editable ? <Input key="body" value={bodyOf(item as DraftItem)} rows={12} onSubmit={(v) => void saveEdit($, vaultFolder, item.id, v)} /> : <Text>{text}</Text>}
      {notice !== '' && <Text dimColor>{notice}</Text>}
      <Box>
        <Button key="approve" label="Approve" hotkey="a" variant="primary" onPress={() => void approveAt($, vaultFolder, item.id)} />
        {editable && <Button key="edit" label="Edit" hotkey="e" onPress={() => void startEdit($)} />}
        <Button key="drop" label="Drop" hotkey="d" onPress={() => void dropAt($, vaultFolder, item.id)} />
        <Button key="next" label="Next" hotkey="n" onPress={() => void advance($, (index + 1) % queue.length)} />
      </Box>
    </Box>
  )
}
