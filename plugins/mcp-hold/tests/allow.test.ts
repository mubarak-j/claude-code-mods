import { expect, test } from 'claude-code/testing'
import { allow, allowCommand, forget } from '../hooks/register.ts'
import { fake } from './fake.ts'

const ALWAYS = 'Always in this project'
const SESSION = 'This session only'

test('allow always writes the project store', async () => {
  const f = fake({ git: '/repo', answers: [ALWAYS] })
  f.state.set('held', ['pal'])
  expect(await allow(f.$, 'pal')).toBe('pal connected and allowed in this project.')
  expect(f.store.get('allow:/repo')).toEqual(['pal'])
  expect(f.connected).toEqual(['pal'])
  expect(f.state.get('held')).toEqual([])
  expect(f.asked[0]?.options).toEqual([ALWAYS, SESSION, 'Cancel'])
})

test('allow session only writes no store', async () => {
  const f = fake({ git: '/repo', answers: [SESSION] })
  f.state.set('held', ['pal'])
  expect(await allow(f.$, 'pal')).toBe('pal connected for this session.')
  expect(f.store.size).toBe(0)
  expect(f.state.get('sessionAllowed')).toEqual(['pal'])
})

test('cancel changes nothing', async () => {
  const f = fake({ git: '/repo', answers: ['Cancel'] })
  f.state.set('held', ['pal'])
  expect(await allow(f.$, 'pal')).toBe('Allow of pal cancelled.')
  expect(f.connected).toEqual([])
  expect(f.state.get('held')).toEqual(['pal'])
})

test('a dismissed dialog counts as cancel', async () => {
  const f = fake({ git: '/repo', answers: [new Error('dismissed')] })
  expect(await allow(f.$, 'pal')).toBe('Allow of pal cancelled.')
  expect(f.connected).toEqual([])
})

test('a refusal keeps no always allow', async () => {
  const f = fake({ git: '/repo', answers: [ALWAYS], refuse: 'pal is disabled in this project.' })
  f.state.set('held', ['pal'])
  expect(await allow(f.$, 'pal')).toBe('pal is disabled in this project.')
  expect(f.store.size).toBe(0)
  expect(f.state.get('held')).toEqual(['pal'])
})

test('bare /mcp-allow lists the held servers', async () => {
  const f = fake({ git: '/repo', answers: ['playwright', SESSION] })
  f.state.set('held', ['pal', 'playwright'])
  expect(await allowCommand(f.$, '')).toBe('playwright connected for this session.')
  expect(f.asked[0]?.options).toEqual(['pal', 'playwright'])
})

test('bare /mcp-allow with one held server goes straight to the scope', async () => {
  const f = fake({ git: '/repo', answers: [SESSION] })
  f.state.set('held', ['pal'])
  expect(await allowCommand(f.$, '')).toBe('pal connected for this session.')
  expect(f.asked.length).toBe(1)
})

test('bare /mcp-allow with nothing held says so', async () => {
  const f = fake({ git: '/repo' })
  expect(await allowCommand(f.$, '')).toBe('No MCP servers are held.')
  expect(f.asked.length).toBe(0)
})

test('bare /mcp-allow with six held servers offers four and takes a typed name', async () => {
  const f = fake({ git: '/repo', answers: ['f', SESSION] })
  f.state.set('held', ['a', 'b', 'c', 'd', 'e', 'f'])
  expect(await allowCommand(f.$, '')).toBe('f connected for this session.')
  expect(f.asked[0]?.options).toEqual(['a', 'b', 'c', 'd'])
})

test('/mcp-allow matches the name without regard to case', async () => {
  const f = fake({ git: '/repo', answers: [SESSION] })
  f.state.set('held', ['pal'])
  expect(await allowCommand(f.$, '  Pal ')).toBe('pal connected for this session.')
  expect(f.connected).toEqual(['pal'])
})

test('/mcp-allow with a name still shows the scope dialog', async () => {
  const f = fake({ git: '/repo', answers: [new Error('dismissed')] })
  f.state.set('held', ['pal'])
  expect(await allowCommand(f.$, 'pal')).toBe('Allow of pal cancelled.')
  expect(f.asked.length).toBe(1)
})

test('/mcp-forget clears the project store', async () => {
  const f = fake({ git: '/repo', store: { 'allow:/repo': ['pal'], 'allow:/other': ['x'] } })
  expect(await forget(f.$)).toBe('Cleared the stored allows for /repo: pal.')
  expect(f.store.has('allow:/repo')).toBe(false)
  expect(f.store.get('allow:/other')).toEqual(['x'])
})

test('/mcp-forget with nothing stored says so', async () => {
  const f = fake({ git: '/repo' })
  expect(await forget(f.$)).toBe('No stored allows for /repo.')
})
