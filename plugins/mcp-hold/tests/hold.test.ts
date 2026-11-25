import { expect, test } from 'claude-code/testing'
import { shouldPass } from '../hooks/register'
import { fake } from './fake'

test('holds an engine-raised server', async () => {
  const f = fake({ git: '/repo' })
  expect(await shouldPass(f.$, 'pal', 'engine')).toBe(false)
  expect(f.state.get('held')).toEqual(['pal'])
})

test('passes claude-artifacts', async () => {
  const f = fake({ git: '/repo' })
  expect(await shouldPass(f.$, 'claude-artifacts', 'engine')).toBe(true)
})

test('passes a project allow', async () => {
  const f = fake({ git: '/repo', store: { 'allow:/repo': ['pal'] } })
  expect(await shouldPass(f.$, 'pal', 'engine')).toBe(true)
})

test('passes a raise from another plugin', async () => {
  const f = fake({ git: '/repo' })
  expect(await shouldPass(f.$, 'pal', 'other-mod')).toBe(true)
})

test('uses the session root outside git', async () => {
  const f = fake({ store: { 'allow:/start': ['pal'] } })
  expect(await shouldPass(f.$, 'pal', 'engine')).toBe(true)
})

test('shows the held count', async () => {
  const f = fake({ git: '/repo' })
  await shouldPass(f.$, 'pal', 'engine')
  await shouldPass(f.$, 'pal', 'engine')
  expect(f.status.at(-1)).toBe('mcp: 1 held')
})

test('uses the session root when git cannot start', async () => {
  const f = fake({ git: new Error('git not found'), store: { 'allow:/start': ['pal'] } })
  expect(await shouldPass(f.$, 'pal', 'engine')).toBe(true)
})

test('parallel holds keep every server', async () => {
  const f = fake({ git: '/repo' })
  const names = ['pal', 'aws-mcp', 'ibotta-mcp', 'playwright', 'open-design', 'plugin:slack:slack']
  await Promise.all(names.map(n => shouldPass(f.$, n, 'engine')))
  expect([...(f.state.get('held') as string[])].sort()).toEqual([...names].sort())
  expect(f.status.at(-1)).toBe('mcp: 6 held')
})

test('a worktree shares the allows of its main checkout', async () => {
  const f = fake({ git: '/repo', root: '/repo-wt', gitOutput: '/repo/.git', store: { 'allow:/repo': ['pal'] } })
  expect(await shouldPass(f.$, 'pal', 'engine')).toBe(true)
})

test('git runs in the session root', async () => {
  const f = fake({ git: '/repo', root: '/repo/sub' })
  await shouldPass(f.$, 'pal', 'engine')
  expect(f.gitCwd).toEqual(['/repo/sub'])
})

test('a bare repository is its own key', async () => {
  const f = fake({ git: '/x', gitOutput: '/x/repo.git', store: { 'allow:/x/repo.git': ['pal'] } })
  expect(await shouldPass(f.$, 'pal', 'engine')).toBe(true)
})
