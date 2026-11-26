import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { FAILED, REQUEUED, advance, approveAt, currentNotice, dropAt, itemView, review, saveEdit, startEdit } from '../hooks/pane'
import { enqueue, enqueueMove, loadQueue } from '../hooks/queue'
import { read } from 'claude-code'

const PANE = {
  plugin: 'obsidian-knowledge',
  component: 'Pane',
  requestId: 'vault-review',
  props: { title: 'Vault review', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const V = '/v/C'
const nw = (title: string) => ({ kind: 'new' as const, folder: 'ArgoCD', title, body: 'old body', tags: [], related: [], evidence: [{ quote: 'OutOfSync', source: 'Bash' }] })
const firstId = async (f: { $: any }) => ((await loadQueue(f.$, V))[0] as { id: string }).id
const queued = async (...titles: string[]) => {
  const f = fake({ files: { '/v/.obsidian/x': '' }, now: Date.UTC(2026, 10, 25), replies: ['{"addition":"merged"}'] })
  for (const [i, t] of titles.entries()) await enqueue(f.$, V, [nw(t)], 's1', i + 1)
  return f
}

// The kit answers the engine nouns beneath the mounted pane; this one backs the file queue.
function queueHooks(on: (name: any, fn: (...a: any[]) => unknown) => void, names: string[], item: unknown) {
  on('env.get', () => ({ value: '/home' }))
  on('fs.stat', () => ({ value: { realPath: V } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: names.map((name) => ({ name })) }))
  on('fs.read', () => ({ value: JSON.stringify(item) }))
}

test('the pane shows the first pending item, on every surface', async ($, on) => {
  const item = { id: 'a', kind: 'new', target: 'ArgoCD/Sync.md', ops: [nw('Sync')], sources: ['s1'] }
  queueHooks(on, ['000000000000001-a.json'], item)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /\[new\] ArgoCD\/Sync.md/ }))?.text).toBe('[new] ArgoCD/Sync.md')
    expect((await ui.find({ type: 'Text', text: /pending/ }))?.text).toBe('1 pending')
    for (const key of ['approve', 'edit', 'drop', 'next']) expect(await ui.find({ key })).toBeDefined()
    await ui.press({ key: 'edit' })
    expect((await ui.find({ key: 'body' }))?.type).toBe('Input')
    await ui.unmount()
  }
})

test('an empty queue says so, on every surface', async ($, on) => {
  queueHooks(on, [], undefined)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('No vault drafts pending.')
    await ui.unmount()
  }
})

test('approve writes the note and leaves the next item', async () => {
  const f = await queued('Sync', 'Health')
  await approveAt(f.$, V, await firstId(f))
  expect(f.files.has('/v/C/ArgoCD/Sync.md')).toBe(true)
  const left = await loadQueue(f.$, V)
  expect(left.map((i) => itemView(i).heading)).toEqual(['[new] ArgoCD/Health.md'])
})

test('approve of a changed note says a new draft waits', async () => {
  const f = await queued('Sync')
  f.files.set('/v/C/ArgoCD/Sync.md', 'user text')
  await approveAt(f.$, V, await firstId(f))
  expect(currentNotice()).toBe(REQUEUED)
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toBe('user text')
  expect((await loadQueue(f.$, V)).length).toBe(1)
})

test('a failed approve keeps the item', async () => {
  const f = await queued('Sync')
  const denied = fake({ files: Object.fromEntries(f.files), denied: '/v/C/ArgoCD', now: 1 })
  await enqueue(denied.$, V, [nw('Sync')], 's1', 1)
  await approveAt(denied.$, V, await firstId(denied))
  expect((await loadQueue(denied.$, V)).length).toBe(1)
  expect(denied.files.has('/v/C/ArgoCD/Sync.md')).toBe(false)
  expect(currentNotice()).toBe(FAILED)
})

test('next and edit clear the notice', async () => {
  const f = await queued('Sync')
  f.files.set('/v/C/ArgoCD/Sync.md', 'user text')
  await approveAt(f.$, V, await firstId(f))
  expect(currentNotice()).toBe(REQUEUED)
  await advance(f.$, 0)
  expect(currentNotice()).toBe('')
  await approveAt(f.$, V, await firstId(f))
  await startEdit(f.$)
  expect(currentNotice()).toBe('')
})

test('an action keys on the item id, not its place', async () => {
  const f = await queued('Sync', 'Health')
  const [first] = await loadQueue(f.$, V)
  await dropAt(f.$, V, (first as { id: string }).id)
  await dropAt(f.$, V, (first as { id: string }).id)
  expect((await loadQueue(f.$, V)).map((i) => itemView(i).heading)).toEqual(['[new] ArgoCD/Health.md'])
})

test('drop removes the item and remembers its fact', async () => {
  const f = await queued('Sync')
  await dropAt(f.$, V, await firstId(f))
  expect(await loadQueue(f.$, V)).toEqual([])
  expect((f.store.get(`dropped:${V}`) as string[]).length).toBe(1)
})

test('drop of a move is remembered and not proposed again', async () => {
  const f = fake()
  const split = { kind: 'split' as const, folder: 'ArgoCD', moves: [{ from: 'ArgoCD/A.md', to: 'ArgoCD/S/A.md' }] }
  await enqueueMove(f.$, V, split, 1)
  await dropAt(f.$, V, await firstId(f))
  expect(f.store.get(`dropped:${V}`)).toEqual(['move:split:ArgoCD'])
  expect(await enqueueMove(f.$, V, split, 2)).toBe(0)
  expect(await loadQueue(f.$, V)).toEqual([])
})

test('approve of a move applies it and removes the item', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/A.md': '# A' } })
  await enqueueMove(f.$, V, { kind: 'split', folder: 'ArgoCD', moves: [{ from: 'ArgoCD/A.md', to: 'ArgoCD/S/A.md' }] }, 1)
  await approveAt(f.$, V, await firstId(f))
  expect(f.files.has('/v/C/ArgoCD/S/A.md')).toBe(true)
  expect(await loadQueue(f.$, V)).toEqual([])
})

test('a failed move says so, keeps the item, and updates hubs for moves done', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/A.md': '# A' } })
  const moves = [{ from: 'ArgoCD/A.md', to: 'ArgoCD/S/A.md' }, { from: 'ArgoCD/Gone.md', to: 'ArgoCD/S/Gone.md' }]
  await enqueueMove(f.$, V, { kind: 'split', folder: 'ArgoCD', moves }, 1)
  await approveAt(f.$, V, await firstId(f))
  expect(currentNotice()).toBe(FAILED)
  expect((await loadQueue(f.$, V)).length).toBe(1)
  expect(f.files.get('/v/C/ArgoCD/S/S.md')).toContain('- [[A]]')
})

test('edit saves the new body and leaves edit mode', async () => {
  const f = await queued('Sync')
  await saveEdit(f.$, V, await firstId(f), 'new body')
  const [item] = await loadQueue(f.$, V)
  expect(itemView(item as never).text).toContain('new body')
  expect((await read(f.$, review)).editing).toBe(false)
})

test('item views name the kind and target', () => {
  expect(itemView({ id: 'm', kind: 'split', folder: 'ArgoCD', moves: [{ from: 'ArgoCD/A.md', to: 'ArgoCD/S/A.md' }] })).toEqual({ heading: '[split] ArgoCD', text: 'ArgoCD/A.md -> ArgoCD/S/A.md' })
  const up = { id: 'u', kind: 'update' as const, target: 'ArgoCD/Sync.md', sources: ['s1'], ops: [{ kind: 'update' as const, path: 'ArgoCD/Sync.md', addition: 'more', related: [], evidence: [{ quote: 'q', source: 'Bash' }], baseHash: 'h' }] }
  expect(itemView(up).heading).toBe('[update] ArgoCD/Sync.md')
  expect(itemView(up).text).toContain('more')
  expect(itemView(up).text).toContain('- Bash: "q"')
})
