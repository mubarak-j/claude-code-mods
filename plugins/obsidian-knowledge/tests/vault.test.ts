import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { fileTitle, folders, hash, insidePath, listNotes, moveFile, openVault, outsideTitles, safeRel, uniqueTitle } from '../hooks/vault'

test('opens the vault, expanding ~ and finding .obsidian', async () => {
  const f = fake({ home: '/h', files: { '/h/v/.obsidian/app.json': '{}', '/h/v/Claude/ArgoCD/ArgoCD.md': '' } })
  expect(await openVault(f.$, '~/v/Claude')).toEqual({ root: '/h/v/Claude', vaultRoot: '/h/v' })
})

test('rejects paths that leave the mod folder', async () => {
  const f = fake({ files: { '/v/Claude/a.md': '' }, links: { '/v/Claude/out': '/etc' } })
  const v = { root: '/v/Claude', vaultRoot: '/v' }
  expect(safeRel('../x.md')).toBeUndefined()
  expect(safeRel('/etc/x.md')).toBeUndefined()
  expect(safeRel('a\\b.md')).toBeUndefined()
  expect(await insidePath(f.$, v, 'out/x.md')).toBeUndefined()
  expect(await insidePath(f.$, v, 'New/x.md')).toBe('/v/Claude/New/x.md')
})

test('lists notes and marks hubs', async () => {
  const f = fake({ files: { '/v/Claude/ArgoCD/ArgoCD.md': '', '/v/Claude/ArgoCD/Sync.md': '', '/v/Claude/ArgoCD/Sets/Sets (Claude).md': '' } })
  const notes = await listNotes(f.$, { root: '/v/Claude', vaultRoot: '/v' })
  expect(notes.filter(n => n.isHub).map(n => n.path).sort()).toEqual(['ArgoCD/ArgoCD.md', 'ArgoCD/Sets/Sets (Claude).md'])
  expect(folders(notes)).toEqual(['ArgoCD', 'ArgoCD/Sets'])
})

test('lists titles outside the mod folder only', async () => {
  const f = fake({ files: { '/v/Mine/ArgoCD.md': '', '/v/.obsidian/x.md': '', '/v/Claude/Sync.md': '' } })
  expect([...(await outsideTitles(f.$, { root: '/v/Claude', vaultRoot: '/v' }))]).toEqual(['argocd'])
})

test('cleans titles and adds the clash suffix', () => {
  expect(fileTitle('Sync: a/b [x] #1 | y')).toBe('Sync a b x 1 y')
  expect(uniqueTitle('ArgoCD', new Set(['argocd']))).toBe('ArgoCD (Claude)')
  expect(uniqueTitle('Redis', new Set(['argocd']))).toBe('Redis')
})

test('hash is stable and short', () => {
  expect(hash('abc')).toBe(hash('abc'))
  expect(hash('abc')).not.toBe(hash('abd'))
  expect(hash('abc')).toMatch(/^[0-9a-f]{8}$/)
})

test('moves a file into a new folder', async () => {
  const f = fake({ files: { '/v/Claude/ArgoCD/Sync.md': 'x' } })
  await moveFile(f.$, { root: '/v/Claude', vaultRoot: '/v' }, 'ArgoCD/Sync.md', 'ArgoCD/Sets/Sync.md')
  expect(f.files.get('/v/Claude/ArgoCD/Sets/Sync.md')).toBe('x')
  expect(f.files.has('/v/Claude/ArgoCD/Sync.md')).toBe(false)
})
