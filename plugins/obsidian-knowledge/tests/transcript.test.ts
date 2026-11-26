import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { corpus, readSince, splitTurns, withAgents } from '../hooks/transcript'

const msg = (uuid: string, role: 'user' | 'assistant', text: string, extra = {}) => ({ uuid, role, text, toolUses: [], ...extra })

test('reads past the 4096 limit in pages', async () => {
  const messages = Array.from({ length: 5000 }, (_, i) => msg(`u${i}`, 'user', 't'))
  const f = fake({ messages })
  const r = await readSince(f.$, 'u10')
  expect(r !== 'gone' && r.messages.length).toBe(4989)
  expect(r !== 'gone' && r.last).toBe('u4999')
})

test('a cursor gone after compaction answers gone', async () => {
  const f = fake({ messages: [msg('u1', 'user', 't')] })
  expect(await readSince(f.$, 'old')).toBe('gone')
})

test('collects subagent transcripts', async () => {
  const use = { tool_use_id: 't1', tool: 'Agent', input: {}, agentId: 'a1', text: 'done' }
  const f = fake({ agents: { a1: [msg('x', 'assistant', 'inner')] } })
  const p = await withAgents(f.$, [msg('u1', 'assistant', '', { toolUses: [use] })])
  expect(p.agents.a1?.[0]?.text).toBe('inner')
})

test('splits only at turn boundaries', () => {
  const turn = (n: number) => [msg(`p${n}`, 'user', 'prompt'), msg(`r${n}`, 'assistant', 'x'.repeat(100))]
  const parts = splitTurns({ messages: [...turn(1), ...turn(2), ...turn(3)], agents: {} }, 250)
  expect(parts.map((p) => p.messages[0]?.uuid)).toEqual(['p1', 'p2', 'p3'])
})

test('the corpus holds tool output, normalized', () => {
  const use = { tool_use_id: 't1', tool: 'Bash', input: { command: 'ls' }, text: 'a\n  b' }
  expect(corpus({ messages: [msg('u', 'assistant', 'chat', { toolUses: [use] })], agents: {} })).toBe('a b')
})
