import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { afterWrite, applyMoves, checkMoves, proposeParent } from '../hooks/growth'
import { enqueueMove, loadQueue } from '../hooks/queue'
import { moveFile } from '../hooks/vault'
import type { MoveItem } from '../types'

const v = { root: '/v/C', vaultRoot: '/v' }
const notes = (folder: string, n: number) => Array.from({ length: n }, (_, i) => ({ path: `${folder}/N${i}.md`, title: `N${i}`, folder, isHub: false }))

test('a folder with 13 notes produces one split proposal', async () => {
  const files = Object.fromEntries(notes('ArgoCD', 13).map((n) => [`/v/C/${n.path}`, '']))
  const moves = notes('ArgoCD', 13).map((n) => ({ from: n.path, to: `ArgoCD/Sets/${n.title}.md` }))
  const f = fake({ files, replies: [JSON.stringify({ moves })] })
  await afterWrite(f.$, v, undefined, 1)
  const queue = await loadQueue(f.$, '/v/C')
  expect(queue.length).toBe(1)
  expect(queue[0]?.kind).toBe('split')
})

test('a folder with 12 notes makes no model call', async () => {
  const f = fake({ files: Object.fromEntries(notes('ArgoCD', 12).map((n) => [`/v/C/${n.path}`, ''])) })
  await afterWrite(f.$, v, undefined, 1)
  expect(f.prompts).toEqual([])
})

test('a move keeps every title', () => {
  const list = notes('ArgoCD', 2)
  expect(checkMoves([{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/Renamed.md' }], list)).toBeUndefined()
  expect(checkMoves([{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/N0.md' }], list)).toEqual([{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/N0.md' }])
})

test('a move never goes deeper than three levels', () => {
  expect(checkMoves([{ from: 'A/B/C/N0.md', to: 'A/B/C/D/N0.md' }], [{ path: 'A/B/C/N0.md', title: 'N0', folder: 'A/B/C', isHub: false }])).toBeUndefined()
})

test('applied moves keep links working and update hubs', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/N0.md': 'see [[N1]]', '/v/C/ArgoCD/N1.md': '' } })
  await applyMoves(f.$, v, { id: 'm', kind: 'split', folder: 'ArgoCD', moves: [{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/N0.md' }] })
  expect(f.files.get('/v/C/ArgoCD/Sets/N0.md')).toBe('see [[N1]]')
  expect(f.files.get('/v/C/ArgoCD/ArgoCD.md')).toContain('- [[Sets]]')
  expect(f.files.get('/v/C/ArgoCD/Sets/Sets.md')).toContain('- [[N0]]')
})

test('a parent is accepted only for three or more sibling folders', async () => {
  const all = ['A', 'B', 'C'].flatMap((x) => notes(x, 1))
  const move = (x: string) => ({ from: `${x}/N0.md`, to: `Ops/${x}/N0.md` })
  const three = await proposeParent(fake({ replies: [JSON.stringify({ parent: 'Ops', moves: ['A', 'B', 'C'].map(move) })] }).$, ['A', 'B', 'C'], '', all)
  expect(three).toEqual({ kind: 'parent', folder: 'Ops', moves: ['A', 'B', 'C'].map(move) })
  expect(await proposeParent(fake({ replies: [JSON.stringify({ parent: 'Ops', moves: ['A', 'B'].map(move) })] }).$, ['A', 'B', 'C'], '', all)).toBeUndefined()
  expect(await proposeParent(fake({ replies: [JSON.stringify({ parent: null })] }).$, ['A', 'B', 'C'], '', all)).toBeUndefined()
})

test('a new folder triggers a parent proposal', async () => {
  const files = Object.fromEntries(['A', 'B', 'C'].map((x) => [`/v/C/${x}/N0.md`, '']))
  const moves = ['A', 'B', 'C'].map((x) => ({ from: `${x}/N0.md`, to: `Ops/${x}/N0.md` }))
  const f = fake({ files, replies: [JSON.stringify({ parent: 'Ops', moves })] })
  await afterWrite(f.$, v, 'C', 1)
  expect(((await loadQueue(f.$, '/v/C'))[0] as MoveItem).kind).toBe('parent')
})

test('a move never overwrites or leaves the mod folder', async () => {
  const f = fake({ files: { '/v/C/A/x.md': 'new', '/v/C/B/x.md': 'old' } })
  await moveFile(f.$, v, 'A/x.md', 'B/x.md')
  expect(f.files.get('/v/C/B/x.md')).toBe('old')
  await expect(moveFile(f.$, v, 'A/x.md', '../out.md')).rejects.toThrow()
  await expect(moveFile(f.$, v, '../x.md', 'A/y.md')).rejects.toThrow()
})

test('a crowded folder makes no model call when a split is pending, dropped, or too deep', async () => {
  const filesOf = (folder: string) => Object.fromEntries(notes(folder, 13).map((n) => [`/v/C/${n.path}`, '']))
  const pending = fake({ files: filesOf('ArgoCD') })
  await enqueueMove(pending.$, '/v/C', { kind: 'split', folder: 'ArgoCD', moves: [{ from: 'ArgoCD/N0.md', to: 'ArgoCD/S/N0.md' }] }, 1)
  const dropped = fake({ files: filesOf('ArgoCD'), store: { 'dropped:/v/C': ['move:split:ArgoCD'] } })
  const deep = fake({ files: filesOf('A/B/C') })
  for (const f of [pending, dropped, deep]) {
    await afterWrite(f.$, v, undefined, 2)
    expect(f.prompts).toEqual([])
  }
})
