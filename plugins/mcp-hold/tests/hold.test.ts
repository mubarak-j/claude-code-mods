import { expect, test } from 'claude-code/testing'
import { shouldPass } from '../hooks/register.ts'
import { fake } from './fake.ts'

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
