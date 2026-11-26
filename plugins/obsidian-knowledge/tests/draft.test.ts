import { expect, test } from 'claude-code/testing'
import { fake } from './fake'
import { RULES, checkOps, closestNotes, draftPart, maskSecrets, parseReply } from '../hooks/draft'

const ctx = { tree: ['ArgoCD'], closest: [] }
const ev = (quote: string) => [{ quote, source: 'Bash' }]
const nw = (over = {}) => ({ kind: 'new', folder: 'ArgoCD', title: 'Sync', body: 'b', tags: [], related: [], evidence: ev('OutOfSync  app'), ...over })

test('keeps an op whose quote is in the tool output', () => {
  expect(checkOps([nw()], 'status OutOfSync app done', ctx).length).toBe(1)
})

test('drops an op whose quote is not in any tool result', () => {
  expect(checkOps([nw({ evidence: ev('Synced') })], 'status OutOfSync app done', ctx)).toEqual([])
})

test('drops an op with no evidence', () => {
  expect(checkOps([nw({ evidence: [] })], 'x', ctx)).toEqual([])
})

test('allows one new top-level folder, not a deeper one', () => {
  expect(checkOps([nw({ folder: 'Redis' })], 'OutOfSync app', ctx).length).toBe(1)
  expect(checkOps([nw({ folder: 'Redis/Sentinel' })], 'OutOfSync app', ctx)).toEqual([])
})

test('drops an update that leaves the mod folder', () => {
  const op = { kind: 'update', path: '../Mine/x.md', addition: 'a', related: [], evidence: ev('OutOfSync app') }
  expect(checkOps([op], 'OutOfSync app', ctx)).toEqual([])
})

test('keeps a valid update with an empty baseHash, and cleans the title', () => {
  const op = { kind: 'update', path: 'ArgoCD/Sync.md', addition: 'a', related: [], evidence: ev('OutOfSync app') }
  expect(checkOps([op], 'OutOfSync app', ctx)[0]).toMatchObject({ kind: 'update', baseHash: '' })
  expect(checkOps([nw({ title: 'A/B: C' })], 'OutOfSync app', ctx)[0]).toMatchObject({ title: 'A B C' })
})

test('masks secrets after the evidence check', () => {
  const [op] = checkOps([nw({ evidence: ev('token=abc123 OutOfSync app') })], 'token=abc123 OutOfSync app', ctx)
  expect(op?.evidence[0]?.quote).toBe('token=[masked] OutOfSync app')
  expect(maskSecrets('AKIAABCDEFGHIJKLMNOP')).toBe('[masked]')
})

test('reads fenced and bare JSON, and rejects prose', () => {
  expect(parseReply('```json\n[]\n```')).toEqual([])
  expect(parseReply('[{"kind":"new"}]')?.length).toBe(1)
  expect(parseReply('Nothing to keep.')).toBeUndefined()
  expect(parseReply('Here are the ops:\n```json\n[{"kind":"new"}]\n```\nDone.')?.length).toBe(1)
})

test('a failed or unreadable reply is failed', async () => {
  const p = { messages: [], agents: {} }
  expect(await draftPart(fake({ replies: [new Error('500')] }).$, p, ctx)).toBe('failed')
  expect(await draftPart(fake({ replies: ['no json'] }).$, p, ctx)).toBe('failed')
})

test('the rules go first, with a cache mark, and maxTokens is set', async () => {
  const f = fake({ replies: ['[]'] })
  await draftPart(f.$, { messages: [], agents: {} }, ctx)
  expect(f.prompts[0]?.startsWith(RULES)).toBe(true)
  const r = f.requests[0]!
  expect(r.maxTokens).toBe(16000)
  expect((r.prompt as { cache?: boolean }[])[0]?.cache).toBe(true)
})

test('closest notes rank by key words and skip hubs', async () => {
  const f = fake({ files: { '/v/ArgoCD/Sync.md': 'rolling sync behavior', '/v/ArgoCD/ArgoCD.md': 'rolling sync behavior', '/v/Other.md': 'nothing' } })
  const notes = [
    { path: 'ArgoCD/Sync.md', title: 'Sync', folder: 'ArgoCD', isHub: false },
    { path: 'ArgoCD/ArgoCD.md', title: 'ArgoCD', folder: 'ArgoCD', isHub: true },
    { path: 'Other.md', title: 'Other', folder: '', isHub: false },
  ]
  const r = await closestNotes(f.$, { root: '/v', vaultRoot: '/' }, notes, 'rolling rolling sync behavior')
  expect(r.map((n) => n.path)).toEqual(['ArgoCD/Sync.md'])
})

test('drops an op whose quote is empty or too short', () => {
  for (const q of ['', '   ', 'app']) expect(checkOps([nw({ evidence: ev(q) })], 'OutOfSync app', ctx)).toEqual([])
})

test('masks a token in source, tags and related', () => {
  const tok = 'AKIAABCDEFGHIJKLMNOP'
  const [op] = checkOps([nw({ tags: [tok], related: [tok], evidence: [{ quote: 'OutOfSync app', source: `Bash: ${tok}` }] })], 'OutOfSync app', ctx)
  expect(op?.evidence[0]?.source).toBe('Bash: [masked]')
  expect(op).toMatchObject({ tags: ['[masked]'], related: ['[masked]'] })
})
