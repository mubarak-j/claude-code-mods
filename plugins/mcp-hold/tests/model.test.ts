import { expect, test } from 'claude-code/testing'
import { allowTool, heldSection } from '../hooks/register.ts'
import { fake } from './fake.ts'

test('the tool runs the scope dialog', async () => {
  const f = fake({ git: '/repo', answers: ['This session only'] })
  f.state.set('held', ['pal'])
  expect(await allowTool(f.$, { server: 'pal' })).toBe('pal connected for this session.')
  expect(f.asked.length).toBe(1)
})

test('the tool refuses input without a server name', async () => {
  const f = fake({ git: '/repo' })
  expect(await allowTool(f.$, {})).toBe('allow_server needs a server name.')
  expect(f.asked.length).toBe(0)
})

test('the prompt names the held servers', async () => {
  const f = fake()
  f.state.set('held', ['pal', 'playwright'])
  const s = await heldSection(f.$)
  expect(s?.id).toBe('mcp-hold:held')
  expect(s?.scope).toBe('session')
  expect(s?.text).toContain('pal, playwright')
  expect(s?.text).toContain('allow_server')
})

test('no section while nothing is held', async () => {
  const f = fake()
  expect(await heldSection(f.$)).toBeUndefined()
})
