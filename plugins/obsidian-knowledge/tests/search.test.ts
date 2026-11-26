import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { formatHits, search, toolDescription, topics } from '../hooks/search'
import { listNotes } from '../hooks/vault'

const v = { root: '/v/C', vaultRoot: '/v' }
const files = {
  '/v/C/Kubernetes/ArgoCD/Sync.md': '---\ntopic: Kubernetes/ArgoCD\nlearned: 2026-11-03\nupdated: 2026-11-18\nsources:\n  - 2026-11-03 session 3a196d38\n---\n\n# Sync\n\nRollingSync marks apps OutOfSync.\n',
  '/v/C/Kubernetes/ArgoCD/ArgoCD.md': 'RollingSync hub',
  '/v/C/Datadog/Retention.md': '# Retention\n\nLogs stay 3 days.\n',
}

test('finds notes by every query word, with dates and sources', async () => {
  const hits = await search(fake({ files }).$, v, 'rollingsync outofsync')
  expect(hits.map((h) => h.title)).toEqual(['Sync'])
  expect(hits[0]).toMatchObject({ learned: '2026-11-03', updated: '2026-11-18', sources: ['2026-11-03 session 3a196d38'] })
})

test('skips hub notes', async () => {
  expect((await search(fake({ files }).$, v, 'hub')).length).toBe(0)
})

test('ranks title matches first and honors the limit', async () => {
  const f = fake({ files: { '/v/C/A/Body.md': 'logs here', '/v/C/A/Logs.md': 'other' } })
  expect((await search(f.$, v, 'logs')).map((h) => h.title)).toEqual(['Logs', 'Body'])
  expect(await search(f.$, v, 'logs', 1)).toHaveLength(1)
})

test('formats hits and the empty case', async () => {
  expect(formatHits([])).toBe('No notes found.')
  expect(formatHits(await search(fake({ files }).$, v, 'retention'))).toContain('learned unknown, updated unknown')
})

test('the description lists two levels of topics and says results are leads', async () => {
  const notes = await listNotes(fake({ files }).$, v)
  const d = toolDescription(topics(notes))
  expect(d).toContain('Topics: Datadog, Kubernetes, Kubernetes/ArgoCD.')
  expect(d).toContain('lead to re-check')
})

test('an empty vault says none yet', () => {
  expect(toolDescription([])).toContain('Topics: none yet.')
})
