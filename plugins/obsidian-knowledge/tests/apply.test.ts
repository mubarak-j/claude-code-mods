import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { approve, refreshHubs } from '../hooks/apply'
import { enqueue, loadQueue } from '../hooks/queue'
import { hash } from '../hooks/vault'
import type { DraftItem, DraftOp } from '../types'

const v = { root: '/v/C', vaultRoot: '/v' }
const ev = [{ quote: 'q', source: 'Bash' }]
const nwOp = (folder: string, title: string): Extract<DraftOp, { kind: 'new' }> => ({ kind: 'new', folder, title, body: 'b', tags: [], related: [], evidence: ev })
const upOp = (path: string, baseHash: string): DraftOp => ({ kind: 'update', path, addition: 'more', related: [], evidence: ev, baseHash })
const nwItem = (folder: string, title: string): DraftItem => ({ id: 'i1', kind: 'new', target: `${folder}/${title}.md`, sources: ['2026-11-25 session s1'], ops: [nwOp(folder, title)] })
const upItem = (path: string, baseHash: string, id = 'i2'): DraftItem => ({ id, kind: 'update', target: path, sources: ['s'], ops: [upOp(path, baseHash)] })

test('a new note creates the mod folder on a fresh install', async () => {
  const f = fake()
  await enqueue(f.$, '/v/C', [nwOp('ArgoCD', 'Sync')], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('written')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toContain('# Sync')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toContain('topic: ArgoCD')
  expect(f.files.get('/v/C/ArgoCD/ArgoCD.md')).toContain('- [[Sync]]')
  expect(await loadQueue(f.$, '/v/C')).toEqual([])
})

test('a title that clashes with your note gets the suffix', async () => {
  const f = fake({ files: { '/v/Mine/Sync.md': 'mine' } })
  await approve(f.$, v, nwItem('ArgoCD', 'Sync'), '2026-11-25')
  expect(f.files.has('/v/C/ArgoCD/Sync (Claude).md')).toBe(true)
  expect(f.files.get('/v/Mine/Sync.md')).toBe('mine')
})

test('a hub title that clashes with your note gets the suffix, and links to it use it', async () => {
  const f = fake({ files: { '/v/Mine/ArgoCD.md': 'mine' } })
  await approve(f.$, v, nwItem('ArgoCD', 'Sync'), '2026-11-25')
  expect(f.files.get('/v/C/ArgoCD/ArgoCD (Claude).md')).toContain('- [[Sync]]')
})

test('an edited note is drafted again and never overwritten', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/Sync.md': 'edited by you' }, replies: ['{"addition":"merged"}'] })
  await enqueue(f.$, '/v/C', [upOp('ArgoCD/Sync.md', 'stale')], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('requeued')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toBe('edited by you')
  const [q] = (await loadQueue(f.$, '/v/C')) as DraftItem[]
  expect(q?.ops[0]).toMatchObject({ kind: 'update', addition: 'merged', baseHash: hash('edited by you') })
})

test('a new note whose title appeared on disk becomes an update draft', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/Sync.md': 'existing' }, replies: ['{"addition":"merged"}'] })
  await enqueue(f.$, '/v/C', [nwOp('ArgoCD', 'Sync')], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('requeued')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toBe('existing')
  const [q] = (await loadQueue(f.$, '/v/C')) as DraftItem[]
  expect(q).toMatchObject({ kind: 'update', target: 'ArgoCD/Sync.md' })
})

test('a failed redraft returns failed and keeps the queue', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/Sync.md': 'edited' } })
  await enqueue(f.$, '/v/C', [upOp('ArgoCD/Sync.md', 'stale')], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('failed')
  expect((await loadQueue(f.$, '/v/C')).length).toBe(1)
})

test('an update follows a note you moved', async () => {
  const text = 'body\n'
  const f = fake({ files: { '/v/C/Redis/Sync.md': text } })
  expect(await approve(f.$, v, upItem('ArgoCD/Sync.md', hash(text)), '2026-11-25')).toBe('written')
  expect(f.files.get('/v/C/Redis/Sync.md')).toContain('more')
})

test('an update of a deleted note becomes a new note', async () => {
  const f = fake()
  expect(await approve(f.$, v, upItem('ArgoCD/Sync.md', 'h'), '2026-11-25')).toBe('written')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toContain('more')
})

test('an update outside the mod folder fails and writes nothing', async () => {
  const f = fake({ files: { '/v/Mine/x.md': 'mine' } })
  expect(await approve(f.$, v, upItem('../Mine/x.md', 'h'), '2026-11-25')).toBe('failed')
  expect([...f.files.keys()]).toEqual(['/v/Mine/x.md'])
})

test('a rejected write returns failed and keeps the queue', async () => {
  const f = fake()
  await enqueue(f.$, '/v/C', [nwOp('ArgoCD', 'Sync')], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  f.$.fs.write = async () => { throw new Error('EPERM') }
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('failed')
  expect((await loadQueue(f.$, '/v/C')).length).toBe(1)
})

test('hubs list notes and subfolders, and keep text outside the markers', async () => {
  const f = fake({ files: { '/v/C/A/B/Deep.md': 'x', '/v/C/A/Top.md': 'x', '/v/C/A/A.md': 'intro\n<!-- obsidian-knowledge:start -->\nold\n<!-- obsidian-knowledge:end -->\nmine\n' } })
  await refreshHubs(f.$, v, ['A/B'])
  expect(f.files.get('/v/C/A/B/B.md')).toContain('- [[Deep]]')
  const a = f.files.get('/v/C/A/A.md')!
  expect(a).toContain('- [[B]]')
  expect(a).toContain('- [[Top]]')
  expect(a).toContain('intro')
  expect(a).toContain('mine')
  expect(a).not.toContain('old')
})

test('folded new ops keep every body', async () => {
  const f = fake()
  await enqueue(f.$, '/v/C', [{ ...nwOp('ArgoCD', 'Sync'), body: 'first fact' }, { ...nwOp('ArgoCD', 'Sync'), body: 'second fact' }], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  await approve(f.$, v, item, '2026-11-25')
  const t = f.files.get('/v/C/ArgoCD/Sync.md')!
  expect(t).toContain('first fact')
  expect(t).toContain('second fact')
})

test('a note titled after its folder gets an overview suffix', async () => {
  const f = fake()
  expect(await approve(f.$, v, nwItem('Redis', 'Redis'), '2026-11-25')).toBe('written')
  expect(f.files.has('/v/C/Redis/Redis overview.md')).toBe(true)
  expect(f.files.get('/v/C/Redis/Redis.md')).toContain('- [[Redis overview]]')
})

test('a new draft never overwrites the suffixed note it would become', async () => {
  const f = fake({ files: { '/v/Mine/Sync.md': 'mine', '/v/C/ArgoCD/Sync (Claude).md': 'user edits' }, replies: ['{"addition":"merged"}'] })
  await enqueue(f.$, '/v/C', [nwOp('ArgoCD', 'Sync')], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('requeued')
  expect(f.files.get('/v/C/ArgoCD/Sync (Claude).md')).toBe('user edits')
  const [q] = (await loadQueue(f.$, '/v/C')) as DraftItem[]
  expect(q).toMatchObject({ kind: 'update', target: 'ArgoCD/Sync (Claude).md' })
})

test('an update item that absorbed a new op writes its body', async () => {
  const text = 'body\n'
  const f = fake({ files: { '/v/C/ArgoCD/Sync.md': text } })
  const item = upItem('ArgoCD/Sync.md', hash(text))
  item.ops.push({ ...nwOp('ArgoCD', 'Sync'), body: 'folded fact' })
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('written')
  const t = f.files.get('/v/C/ArgoCD/Sync.md')!
  expect(t).toContain('more')
  expect(t).toContain('folded fact')
  expect(t).not.toContain('undefined')
})

test('a redraft masks secrets in the addition', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/Sync.md': 'edited' }, replies: ['{"addition":"use token=abc123secret"}'] })
  await enqueue(f.$, '/v/C', [upOp('ArgoCD/Sync.md', 'stale')], 's', 1)
  const item = (await loadQueue(f.$, '/v/C'))[0] as DraftItem
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('requeued')
  const [q] = (await loadQueue(f.$, '/v/C')) as DraftItem[]
  expect(q?.ops[0]).toMatchObject({ addition: 'use token=[masked]' })
})
