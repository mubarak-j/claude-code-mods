import { expect, mock, test } from 'claude-code/testing'
import { fake } from './fake'
import { capture, catchUp, isExcluded } from '../hooks/capture'
import type { Cursor } from '../types'

const opts = { vaultFolder: '/v/Claude', exclude: ['~/private/'] }
const use = (text: string) => ({ tool_use_id: 't', tool: 'Bash', input: { command: 'x' }, text })
const reply = JSON.stringify([{ kind: 'new', folder: '', title: 'Sync', body: 'b', tags: [], related: [], evidence: [{ quote: 'OutOfSync', source: 'Bash' }] }])
const transcript = [
  { uuid: 'u1', role: 'user' as const, text: 'go', toolUses: [] },
  { uuid: 'u2', role: 'assistant' as const, text: '', toolUses: [use('OutOfSync')] },
]
const cursor = (uuid: string | null): Record<string, unknown> => ({ cursors: { s1: { uuid, project: '/p', transcriptPath: '', seen: 1 } } })
const cursorOf = (f: { store: Map<string, unknown> }) => (f.store.get('cursors') as Record<string, Cursor>).s1?.uuid

test('a checkpoint queues proven drafts and moves the cursor', async () => {
  const f = fake({ messages: transcript, replies: [reply], session: 's1', store: cursor(null) })
  expect(await capture(f.$, opts)).toEqual({ drafted: 1, pending: 1 })
  expect(cursorOf(f)).toBe('u2')
})

test('a session under an excluded folder produces no drafts', async () => {
  const f = fake({ root: '/h/private/repo', home: '/h', messages: transcript, replies: [reply] })
  expect(await capture(f.$, opts)).toEqual({ skipped: 'excluded' })
  expect(f.prompts).toEqual([])
})

test('a headless session captures nothing', async () => {
  expect(await capture(fake({ surface: null }).$, opts)).toEqual({ skipped: 'headless' })
})

test('a failed model call keeps the cursor', async () => {
  const f = fake({ messages: transcript, replies: [new Error('500')], session: 's1', store: cursor(null) })
  expect(await capture(f.$, opts)).toEqual({ skipped: 'failed' })
  expect(cursorOf(f)).toBeNull()
})

test('a part with no tool calls makes no model call', async () => {
  const f = fake({ messages: [{ uuid: 'u1', role: 'user', text: 'hi', toolUses: [] }] })
  expect(await capture(f.$, opts)).toEqual({ skipped: 'no-tools' })
  expect(f.prompts).toEqual([])
})

test('a cursor gone after compaction moves to the newest message', async () => {
  const f = fake({ messages: transcript, session: 's1', store: cursor('old') })
  await capture(f.$, opts)
  expect(cursorOf(f)).toBe('u2')
})

test('an unreadable vault writes the permission line once', async () => {
  const f = fake({ denied: '/v', messages: transcript, replies: [reply, reply] })
  await capture(f.$, opts)
  await capture(f.$, opts)
  expect(f.logs.filter((l) => l.includes('Privacy & Security')).length).toBe(1)
})

test('a precompute or subagent compaction starts no draft', async ($, on) => {
  const clock = mock.clock(on)
  let reads = 0
  on('session.root', () => (reads++, { value: '/p' }))
  on('model.complete', () => ({ isAnswered: false, reason: 'api-error' }) as never)
  const engine = { messages: transcript }
  on('session.compact', () => engine)
  for (const args of [{ trigger: 'precompute' }, { trigger: 'auto', agentId: 'a1' }] as const) {
    const e = { ...args, messages: transcript }
    expect(await $.session.compact(e as never)).toEqual(engine)
    await clock.advance(1)
  }
  expect(reads).toBe(0)
})

test('a compaction hook returns before its draft ends', async ($, on) => {
  const clock = mock.clock(on)
  let reads = 0
  on('session.root', () => (reads++, { value: '/p' }))
  on('session.compact', () => ({ messages: transcript }))
  expect(await $.session.compact({ trigger: 'manual', messages: transcript } as never)).toEqual({ messages: transcript })
  expect(reads).toBe(0) // the hook resolved before the draft started
  await clock.advance(1)
  expect(reads).toBe(1)
})

test('exclude matching ignores a trailing slash', () => {
  expect(isExcluded('/h/private', ['~/private/'], '/h')).toBe(true)
  expect(isExcluded('/h/privateer', ['~/private'], '/h')).toBe(false)
})

test('catch-up in a headless session makes no model call', async () => {
  const f = fake({ surface: null, store: { cursors: { old: { uuid: null, project: '/start', transcriptPath: '/t/old.jsonl', seen: 1 } } }, files: { '/t/old.jsonl': '' }, replies: [reply] })
  expect(await catchUp(f.$, opts)).toBe(0)
  expect(f.prompts).toEqual([])
})

test('a headless session start stores no cursor', async ($, on) => {
  mock.clock(on)
  const writes: unknown[] = []
  on('session.surface', () => ({ value: null }))
  on('session.id', () => ({ value: 's9' }))
  on('session.root', () => ({ value: '/p' }))
  on('session.info', () => ({ value: { transcriptPath: '/t' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => (writes.push(e), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  expect(writes).toEqual([])
})
