import { expect, test } from 'claude-code/testing'
import { applyUpdate, day, parseFrontmatter, renderHubBlock, renderNote, withHubBlock, HUB_START, HUB_END } from '../hooks/note'

const note = { title: 'RollingSync OutOfSync behavior', topic: 'ArgoCD', learned: '2026-11-03', updated: '2026-11-03', sources: ['2026-11-03 session 3a196d38'], tags: ['argocd'], body: 'The controller marks apps OutOfSync.', evidence: ['- Bash: "OutOfSync" (2026-11-03)'], related: ['ApplicationSet controller'] }

test('a rendered note parses back', () => {
  const fm = parseFrontmatter(renderNote(note))
  expect(fm).toEqual({ topic: 'ArgoCD', learned: '2026-11-03', updated: '2026-11-03', sources: ['2026-11-03 session 3a196d38'], tags: ['argocd'] })
})

test('a rendered note has the evidence and related sections', () => {
  const text = renderNote(note)
  expect(text).toContain('# RollingSync OutOfSync behavior\n')
  expect(text).toContain('## Evidence\n\n- Bash: "OutOfSync" (2026-11-03)')
  expect(text).toContain('## Related\n\n[[ApplicationSet controller]]')
})

test('an update adds the text, evidence, source and date', () => {
  const op = { kind: 'update' as const, path: 'ArgoCD/x.md', addition: 'Fixed in v3.6.2.', related: ['Redis'], evidence: [{ quote: 'synced', source: 'Bash' }], baseHash: 'h' }
  const text = applyUpdate(renderNote(note), op, '2026-11-18', '2026-11-18 session 62e43b86')
  expect(text).toContain('Fixed in v3.6.2.\n\n## Evidence')
  expect(text).toContain('- Bash: "synced" (2026-11-18)')
  expect(parseFrontmatter(text).updated).toBe('2026-11-18')
  expect(parseFrontmatter(text).sources).toEqual(['2026-11-03 session 3a196d38', '2026-11-18 session 62e43b86'])
  expect(text).toContain('[[Redis]]')
})

test('an update of a note without sections appends at the end', () => {
  const op = { kind: 'update' as const, path: 'x.md', addition: 'New fact.', related: [], evidence: [{ quote: 'q', source: 'Read' }], baseHash: 'h' }
  expect(applyUpdate('My own note.\n', op, '2026-11-18', 's')).toContain('My own note.\n\nNew fact.')
})

test('a hub keeps your text outside the markers', () => {
  const first = withHubBlock(undefined, 'ArgoCD', renderHubBlock(['A'], []))
  const edited = `My intro.\n\n${first}\nMy outro.\n`
  const next = withHubBlock(edited, 'ArgoCD', renderHubBlock(['A', 'B'], ['ApplicationSets']))
  expect(next).toContain('My intro.')
  expect(next).toContain('My outro.')
  expect(next).toContain('- [[B]]')
  expect(next).toContain('- [[ApplicationSets]]')
  expect(next.split(HUB_START).length).toBe(2)
  expect(next.split(HUB_END).length).toBe(2)
})

test('day is a UTC date', () => {
  expect(day(Date.UTC(2026, 10, 3, 23, 0))).toBe('2026-11-03')
})
