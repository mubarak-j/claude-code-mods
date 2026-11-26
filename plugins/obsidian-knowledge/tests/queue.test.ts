import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { allCursors, dropItem, enqueue, enqueueMove, isDropped, loadQueue, setCursor, targetOf } from '../hooks/queue'
import type { DraftItem } from '../types'

const up = (path: string, quote: string) => ({ kind: 'update' as const, path, addition: 'x', related: [], evidence: [{ quote, source: 'Bash' }], baseHash: 'h' })
const nw = (folder: string, title: string) => ({ kind: 'new' as const, folder, title, body: 'b', tags: [], related: [], evidence: [{ quote: 'q', source: 'Bash' }] })

test('two drafts for one note fold into one item', async () => {
  const f = fake()
  await enqueue(f.$, '/v/C', [up('ArgoCD/Sync.md', 'a')], 's1', 1)
  expect(await enqueue(f.$, '/v/C', [up('ArgoCD/Sync.md', 'b')], 's2', 2)).toBe(1)
  const [item] = await loadQueue(f.$, '/v/C')
  expect(item.kind).toBe('update')
  expect((item as DraftItem).ops.length).toBe(2)
  expect((item as DraftItem).sources).toEqual(['s1', 's2'])
})

test('a new note targets its folder and title', () => {
  expect(targetOf(nw('ArgoCD', 'Sync'))).toBe('ArgoCD/Sync.md')
  expect(targetOf(nw('', 'Sync'))).toBe('Sync.md')
})

test('a dropped fact is remembered', async () => {
  const f = fake()
  await enqueue(f.$, '/v/C', [nw('ArgoCD', 'Sync')], 's1', 1)
  const [item] = await loadQueue(f.$, '/v/C')
  await dropItem(f.$, '/v/C', item.id)
  expect(await loadQueue(f.$, '/v/C')).toEqual([])
  expect(await isDropped(f.$, '/v/C', nw('ArgoCD', 'sync'))).toBe(true)
})

test('a second split proposal for one folder is skipped', async () => {
  const f = fake()
  await enqueueMove(f.$, '/v/C', { kind: 'split', folder: 'ArgoCD', moves: [] }, 1)
  expect(await enqueueMove(f.$, '/v/C', { kind: 'split', folder: 'ArgoCD', moves: [] }, 2)).toBe(1)
})

test('cursors keep the 200 newest', async () => {
  const f = fake()
  for (let i = 0; i < 205; i++) await setCursor(f.$, `s${i}`, { uuid: null, project: '/p', transcriptPath: '', seen: i })
  const all = await allCursors(f.$)
  expect(Object.keys(all).length).toBe(200)
  expect(all.s0).toBeUndefined()
  expect(all.s204?.seen).toBe(204)
})
