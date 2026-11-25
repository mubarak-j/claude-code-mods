import { expect, test } from 'claude-code/testing'
import { allowTool, shouldPass, toolDescription } from '../hooks/register.ts'
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

test('the tool description names the held servers', () => {
  const d = toolDescription(['pal', 'playwright'])
  expect(d).toContain('pal, playwright')
  expect(d).toContain('dialog')
})

test('the tool description says so while nothing is held', () => {
  expect(toolDescription([])).toContain('No MCP server is held now.')
})

test('a new hold updates the tool description', async () => {
  const f = fake({ git: '/repo' })
  await shouldPass(f.$, 'pal', 'engine')
  expect(f.tools.at(-1)?.description).toContain('held by mcp-hold: pal.')
})

test('an allow updates the tool description', async () => {
  const f = fake({ git: '/repo', answers: ['This session only'] })
  f.state.set('held', ['pal'])
  await allowTool(f.$, { server: 'pal' })
  expect(f.tools.at(-1)?.description).toContain('No MCP server is held now.')
})
