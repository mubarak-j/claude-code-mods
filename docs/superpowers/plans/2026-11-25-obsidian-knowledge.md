# obsidian-knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `obsidian-knowledge` mod. It drafts proven facts from each Claude Code session into notes, queues them for review, and files approved notes into a self-organizing Obsidian folder.

**Architecture:** One TypeScript hooks module in `plugins/obsidian-knowledge/`, built like `plugins/mcp-hold/`. Pure logic lives in small files under `hooks/`. `hooks/register.ts` only wires events, commands, the tool and the pane. Tests use a fake `$` in `tests/fake.ts`, like `mcp-hold`.

**Tech Stack:** Claude Code function-hooks SDK 2.1.329 (`claude-code` types), TypeScript, JSX for the pane, `claude-code/testing` for tests.

**Spec:** `docs/superpowers/specs/2026-11-25-obsidian-knowledge-design.md`. Read it before any task.

## Global Constraints

- SDK: Claude Code 2.1.329, the version `package.json` pins.
- Mod folder option `vaultFolder`, type `directory`, default `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/ibotta-work/Claude`. The mod expands a leading `~` with `$.env.get('HOME')`.
- Option `exclude`: type `string`, `multiple: true`, default `[]`.
- Constants in code, not options: idle wait 15 minutes, split size above 12 notes in one folder, depth limit 3 levels below the mod folder, model `sonnet`.
- Title clash suffix: ` (Claude)`.
- Hub markers: `<!-- obsidian-knowledge:start -->` and `<!-- obsidian-knowledge:end -->`.
- Pending line at session start, through `$.ui.log`: `N vault drafts pending, /vault-review`. For one draft, `1 vault draft pending, /vault-review`.
- No status line entry and no toasts.
- The mod reads and writes files only inside the mod folder. Outside it, the mod only lists file names.
- `manifest.license` is `Apache-2.0`, like `mcp-hold`.
- Every Markdown file must pass the simple-english lint hook. Never hard-wrap prose.
- Commit messages use `feat(obsidian-knowledge): ...`.

## Review Focus

1. A fresh install has no mod folder yet. The first approved note creates the folder, and capture queues drafts before that. Task 7 tests it.
2. The model reply is prose, fenced JSON or broken JSON. Fenced JSON parses. Anything that does not parse counts as a failed call, so the cursor stays. Task 5 and Task 6 test it.
3. A title holds characters that break file names or Obsidian links (`/ \ : # ^ [ ] |`). The mod replaces each with a space and collapses spaces. Task 2 tests it.
4. Two sessions draft a new note with the same title, or the title appears on disk before approval. At approval, the mod treats the item as an update of the note on disk and drafts it again. Task 7 tests it.
5. You move or delete a note in Obsidian while an update for it waits. At approval, the mod looks for the title anywhere in the mod folder. If found, it applies the update there. If not found, it writes the update as a new note in the old folder. Task 7 tests it.

## Before Task 1

Create the branch `feat/obsidian-knowledge` from `main`. The spec and this plan go into the commit of Task 1. `ROADMAP.md` stays uncommitted until the user says otherwise.

## File Structure

```text
plugins/obsidian-knowledge/
  .claude-plugin/plugin.json   manifest, userConfig, types
  hooks/hooks.json             { "modules": ["./register.ts"] }
  hooks/register.ts            wiring only: events, commands, tool, timers, pane
  hooks/note.ts                note and hub text: render, parse, update, dates
  hooks/vault.ts               paths, guard, listing, titles, hash, move
  hooks/queue.ts               store: queue, folding, dropped facts, cursors
  hooks/transcript.ts          reading, splitting and rendering transcript parts
  hooks/draft.ts               drafting prompt, reply parsing, op checks, masking
  hooks/capture.ts             checkpoints: capture, catch-up, exclude, serial runs
  hooks/apply.ts               approval: write, hubs, conflict redraft
  hooks/growth.ts              split and parent proposals, moves
  hooks/search.ts              vault_search and its description
  hooks/pane.tsx               /vault-review pane
  types/index.d.ts             shared types and the PluginState contract
  tests/fake.ts                fake $ for all tests
  tests/*.test.ts(x)           one test file per hooks file
  README.md                    user docs
```

---

### Task 1: Scaffold, types and note text

**Files:**
- Create: `plugins/obsidian-knowledge/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `types/index.d.ts`, `hooks/note.ts`
- Test: `plugins/obsidian-knowledge/tests/note.test.ts`

**Interfaces:**
- Produces, in `types/index.d.ts` (later tasks import these from `'../types'`):

```ts
export type Evidence = { quote: string; source: string }
export type NewOp = { kind: 'new'; folder: string; title: string; body: string; tags: string[]; related: string[]; evidence: Evidence[] }
export type UpdateOp = { kind: 'update'; path: string; addition: string; related: string[]; evidence: Evidence[]; baseHash: string }
export type DraftOp = NewOp | UpdateOp
export type Move = { from: string; to: string }
export type DraftItem = { id: string; kind: 'new' | 'update'; target: string; ops: DraftOp[]; sources: string[] }
export type MoveItem = { id: string; kind: 'split' | 'parent'; folder: string; moves: Move[] }
export type QueueItem = DraftItem | MoveItem
export type Cursor = { uuid: string | null; project: string; transcriptPath: string; seen: number }
export type Review = { index: number; editing: boolean; rev: number }

declare module 'claude-code' {
  interface PluginState {
    'obsidian-knowledge': { review: Shaped<Review> }
  }
}
```

- Produces, in `hooks/note.ts`:
  - `type NoteData = { title: string; topic: string; learned: string; updated: string; sources: string[]; tags: string[]; body: string; evidence: string[]; related: string[] }`
  - `renderNote(n: NoteData): string`, in the exact layout of the spec's note example.
  - `parseFrontmatter(text: string): { topic?: string; learned?: string; updated?: string; sources: string[]; tags: string[] }`
  - `evidenceLine(e: Evidence, date: string): string` returns the evidence bullet of the spec's note example: the source, the quote in double quotes, and the date in parentheses.
  - `applyUpdate(text: string, op: UpdateOp, date: string, source: string): string`
  - `HUB_START`, `HUB_END`, `renderHubBlock(notes: string[], subfolders: string[]): string`, `withHubBlock(existing: string | undefined, title: string, block: string): string`
  - `day(ms: number): string` returns the UTC date as `YYYY-MM-DD`.
- Paths in all tasks are relative to the mod folder and use `/`. The root folder is `''`. A source string reads `2026-11-03 session 3a196d38`: the date, then the first 8 characters of the session id.

- [ ] **Step 1: Write the manifest, `hooks.json` and an empty module**

`plugin.json` holds `name`, `version` `0.1.0`, a one-line `description`, `license`, `"types": "./types/index.d.ts"` and the `userConfig` from Global Constraints. Each field gets a `title` and a `description`. `register.ts` exports `register: Register = (on, options) => {}` for now.

- [ ] **Step 2: Write the failing tests**

```ts
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
```

- [ ] **Step 3: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: FAIL, because `../hooks/note` has no exports yet.

- [ ] **Step 4: Implement `hooks/note.ts` and `types/index.d.ts`**

`parseFrontmatter` reads only the keys this mod writes: scalars and `- ` lists under `sources`, and the `[a, b]` form of `tags`. A hub block lists subfolder hubs first, then notes, one `- [[Title]]` line each, sorted. `withHubBlock` with no existing text returns `# <title>\n\n<block>\n`.

- [ ] **Step 5: Run the tests and the validator**

Run: `npx claude plugin test plugins/obsidian-knowledge && npx claude plugin validate plugins/obsidian-knowledge`
Expected: all tests pass, and validation passes. README and icon warnings are fine until Task 11.

- [ ] **Step 6: Commit**

```bash
git add plugins/obsidian-knowledge docs/superpowers/specs/2026-11-25-obsidian-knowledge-design.md docs/superpowers/plans/2026-11-25-obsidian-knowledge.md
git commit -m "feat(obsidian-knowledge): scaffold the mod and the note format"
```

---

### Task 2: Vault access and the fake engine

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/vault.ts`, `plugins/obsidian-knowledge/tests/fake.ts`
- Test: `plugins/obsidian-knowledge/tests/vault.test.ts`

**Interfaces:**
- Produces, in `hooks/vault.ts`:
  - `type Vault = { root: string; vaultRoot: string }`. `root` is the real path of the mod folder. `vaultRoot` is the nearest ancestor that holds `.obsidian`, else the parent of `root`.
  - `openVault($, folder: string): Promise<Vault>` expands `~` and resolves real paths. A missing folder is fine: it resolves through its nearest existing ancestor.
  - `safeRel(rel: string): string | undefined`. It rejects an absolute path, a `..` or empty segment, and a backslash.
  - `insidePath($, v: Vault, rel: string): Promise<string | undefined>` returns the absolute path or `undefined`. To return the path, `safeRel` must pass. The real path, or the nearest existing ancestor's real path, must also lie under `v.root`.
  - `type NoteFile = { path: string; title: string; folder: string; isHub: boolean }`
  - `listNotes($, v: Vault): Promise<NoteFile[]>` lists `.md` files under `root`, recursively. A hub is a note whose title is its folder's last segment, with or without ` (Claude)`.
  - `outsideTitles($, v: Vault): Promise<Set<string>>` holds the lowercased titles of `.md` files under `vaultRoot` but outside `root`. It skips `.obsidian` and `.trash`.
  - `fileTitle(raw: string): string` and `uniqueTitle(title: string, taken: Set<string>): string`
  - `hash(text: string): string`, FNV-1a 32-bit as 8 hex characters.
  - `moveFile($, v: Vault, from: string, to: string): Promise<void>` runs `mkdir -p` on the target folder, then `mv`, through `$.process.run`.
  - `folders(notes: NoteFile[]): string[]` returns the distinct folders, sorted, without `''`.
- Produces, in `tests/fake.ts`: `fake(opts?)` returning a `Fake` with these fields. Later tasks use them as they are.

```ts
export type Fake = {
  $: EngineInterface
  files: Map<string, string>
  store: Map<string, unknown>
  state: Map<string, unknown>
  logs: string[]
  timers: { ms: number; fn: () => void; cancelled: boolean }[]
  prompts: string[]
  opened: string[]
  tools: { name: string; description: string }[]
  commands: string[]
}
export function fake(opts?: {
  files?: Record<string, string>
  links?: Record<string, string>
  denied?: string
  store?: Record<string, unknown>
  messages?: SessionMessage[]
  agents?: Record<string, SessionMessage[]>
  replies?: (string | Error)[]
  root?: string
  surface?: string | null
  home?: string
  session?: string
  now?: number
  transcriptPath?: string
}): Fake
```

  The fake covers these nouns:
  - `fs.read/write/list/exists/stat`, and `process.run` for `mkdir -p` and `mv`,
  - `store`, `state`, `env.get('HOME')` and `clock.now/after`,
  - `session.messages` with `after`, `last`, `agentId` and the 4096 limit,
  - `session.info/surface/id/root` and `model.complete`,
  - `ui.log/open`, `tool.register` and `command.register`.

  A path under `denied` makes every `fs` call reject with an error whose `code` is `EPERM`. A path in `links` resolves to its target in `stat(..., { resolve: true })`. An `Error` in `replies` resolves `{ isAnswered: false, reason: 'api-error' }`.

- [ ] **Step 1: Write `tests/fake.ts`**

- [ ] **Step 2: Write the failing tests**

```ts
test('opens the vault, expanding ~ and finding .obsidian', async () => {
  const f = fake({ home: '/h', files: { '/h/v/.obsidian/app.json': '{}', '/h/v/Claude/ArgoCD/ArgoCD.md': '' } })
  expect(await openVault(f.$, '~/v/Claude')).toEqual({ root: '/h/v/Claude', vaultRoot: '/h/v' })
})

test('rejects paths that leave the mod folder', async () => {
  const f = fake({ files: { '/v/Claude/a.md': '' }, links: { '/v/Claude/out': '/etc' } })
  const v = { root: '/v/Claude', vaultRoot: '/v' }
  expect(safeRel('../x.md')).toBeUndefined()
  expect(safeRel('/etc/x.md')).toBeUndefined()
  expect(safeRel('a\\b.md')).toBeUndefined()
  expect(await insidePath(f.$, v, 'out/x.md')).toBeUndefined()
  expect(await insidePath(f.$, v, 'New/x.md')).toBe('/v/Claude/New/x.md')
})

test('lists notes and marks hubs', async () => {
  const f = fake({ files: { '/v/Claude/ArgoCD/ArgoCD.md': '', '/v/Claude/ArgoCD/Sync.md': '', '/v/Claude/ArgoCD/Sets/Sets (Claude).md': '' } })
  const notes = await listNotes(f.$, { root: '/v/Claude', vaultRoot: '/v' })
  expect(notes.filter(n => n.isHub).map(n => n.path).sort()).toEqual(['ArgoCD/ArgoCD.md', 'ArgoCD/Sets/Sets (Claude).md'])
  expect(folders(notes)).toEqual(['ArgoCD', 'ArgoCD/Sets'])
})

test('lists titles outside the mod folder only', async () => {
  const f = fake({ files: { '/v/Mine/ArgoCD.md': '', '/v/.obsidian/x.md': '', '/v/Claude/Sync.md': '' } })
  expect([...(await outsideTitles(f.$, { root: '/v/Claude', vaultRoot: '/v' }))]).toEqual(['argocd'])
})

test('cleans titles and adds the clash suffix', () => {
  expect(fileTitle('Sync: a/b [x] #1 | y')).toBe('Sync a b x 1 y')
  expect(uniqueTitle('ArgoCD', new Set(['argocd']))).toBe('ArgoCD (Claude)')
  expect(uniqueTitle('Redis', new Set(['argocd']))).toBe('Redis')
})

test('hash is stable and short', () => {
  expect(hash('abc')).toBe(hash('abc'))
  expect(hash('abc')).not.toBe(hash('abd'))
  expect(hash('abc')).toMatch(/^[0-9a-f]{8}$/)
})

test('moves a file into a new folder', async () => {
  const f = fake({ files: { '/v/Claude/ArgoCD/Sync.md': 'x' } })
  await moveFile(f.$, { root: '/v/Claude', vaultRoot: '/v' }, 'ArgoCD/Sync.md', 'ArgoCD/Sets/Sync.md')
  expect(f.files.get('/v/Claude/ArgoCD/Sets/Sync.md')).toBe('x')
  expect(f.files.has('/v/Claude/ArgoCD/Sync.md')).toBe(false)
})
```

- [ ] **Step 3: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the vault tests FAIL, and the note tests pass.

- [ ] **Step 4: Implement `hooks/vault.ts`**

- [ ] **Step 5: Run the tests and check that they pass**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): vault paths, listing and titles"
```

---

### Task 3: Queue, dropped facts and cursors

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/queue.ts`
- Test: `plugins/obsidian-knowledge/tests/queue.test.ts`

**Interfaces:**
- Consumes: `hash` from Task 2. The types from Task 1.
- Produces, in `hooks/queue.ts`:
  - `queueKey(root: string): string` returns `queue:${root}`. `droppedKey(root: string): string` returns `dropped:${root}`. `CURSORS = 'cursors'`.
  - `targetOf(op: DraftOp): string`. For a new op, it returns `${folder}/${title}.md`, or `${title}.md` at the root. For an update, it returns `op.path`.
  - `fingerprint(op: DraftOp): string` returns `hash` of the lowercased target and the first evidence quote after whitespace is normalized.
  - `loadQueue($, root: string): Promise<QueueItem[]>`
  - `enqueue($, root: string, ops: DraftOp[], source: string, now: number): Promise<number>` folds each op into the item with the same target, else adds an item. The item id is `hash(target + ':' + now)`. It returns the pending count.
  - `enqueueMove($, root: string, item: Omit<MoveItem, 'id'>, now: number): Promise<number>`. If a move item for the same folder waits, it skips the proposal.
  - `replaceItem($, root: string, item: QueueItem): Promise<void>` and `removeItem($, root: string, id: string): Promise<void>`
  - `dropItem($, root: string, id: string): Promise<void>` removes the item and records the fingerprint of each of its ops.
  - `isDropped($, root: string, op: DraftOp): Promise<boolean>`
  - `getCursor($, session: string): Promise<Cursor | undefined>`, `setCursor($, session: string, c: Cursor): Promise<void>`, `allCursors($): Promise<Record<string, Cursor>>`. `setCursor` keeps the 200 entries with the newest `seen`.

- [ ] **Step 1: Probe the store across processes**

Write a throwaway probe mod in the session scratchpad, never in the repo. Its `session.start` hook runs 50 rounds of `get`, add 1, `set` on one key. Run two `npx claude -p --plugin-dir <probe> "hi"` processes at the same time, then read the final count from the probe's store file. If the count is 100, keep `$.store`. If it is below 100, stop and report to the user. The fallback keeps the same `queue.ts` interface but stores each item as a file under `<root>/.obsidian-knowledge/`.

- [ ] **Step 2: Write the failing tests**

```ts
const up = (path: string, quote: string) => ({ kind: 'update' as const, path, addition: 'x', related: [], evidence: [{ quote, source: 'Bash' }], baseHash: 'h' })
const nw = (folder: string, title: string) => ({ kind: 'new' as const, folder, title, body: 'b', tags: [], related: [], evidence: [{ quote: 'q', source: 'Bash' }] })

test('two drafts for one note fold into one item', async () => {
  const f = fake()
  await enqueue(f.$, '/v/C', [up('ArgoCD/Sync.md', 'a')], 's1', 1)
  expect(await enqueue(f.$, '/v/C', [up('ArgoCD/Sync.md', 'b')], 's2', 2)).toBe(1)
  const [item] = await loadQueue(f.$, '/v/C')
  expect(item.kind).toBe('update')
  expect((item as DraftItem).ops.length).toBe(2)
  expect((item as DraftItem).sources).toEqual(['s1', 's2'])
})

test('a new note targets its folder and title', () => {
  expect(targetOf(nw('ArgoCD', 'Sync'))).toBe('ArgoCD/Sync.md')
  expect(targetOf(nw('', 'Sync'))).toBe('Sync.md')
})

test('a dropped fact is remembered', async () => {
  const f = fake()
  await enqueue(f.$, '/v/C', [nw('ArgoCD', 'Sync')], 's1', 1)
  const [item] = await loadQueue(f.$, '/v/C')
  await dropItem(f.$, '/v/C', item.id)
  expect(await loadQueue(f.$, '/v/C')).toEqual([])
  expect(await isDropped(f.$, '/v/C', nw('ArgoCD', 'sync'))).toBe(true)
})

test('a second split proposal for one folder is skipped', async () => {
  const f = fake()
  await enqueueMove(f.$, '/v/C', { kind: 'split', folder: 'ArgoCD', moves: [] }, 1)
  expect(await enqueueMove(f.$, '/v/C', { kind: 'split', folder: 'ArgoCD', moves: [] }, 2)).toBe(1)
})

test('cursors keep the 200 newest', async () => {
  const f = fake()
  for (let i = 0; i < 205; i++) await setCursor(f.$, `s${i}`, { uuid: null, project: '/p', transcriptPath: '', seen: i })
  const all = await allCursors(f.$)
  expect(Object.keys(all).length).toBe(200)
  expect(all.s0).toBeUndefined()
  expect(all.s204?.seen).toBe(204)
})
```

- [ ] **Step 3: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the queue tests FAIL.

- [ ] **Step 4: Implement `hooks/queue.ts`**

Each write re-reads the key right before it sets the key, so the window for a lost update stays small.

- [ ] **Step 5: Run the tests and check that they pass**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): review queue, dropped facts and cursors"
```

---

### Task 4: Transcript parts

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/transcript.ts`
- Test: `plugins/obsidian-knowledge/tests/transcript.test.ts`

**Interfaces:**
- Consumes: `SessionMessage` from `'claude-code'`. The fake from Task 2.
- Produces, in `hooks/transcript.ts`:
  - `type Part = { messages: SessionMessage[]; agents: Record<string, SessionMessage[]> }`
  - `readSince($, after: string | null): Promise<{ messages: SessionMessage[]; last: string | null } | 'gone'>`. It pages with `after` until a read returns nothing new. With `after` null, it reads once with no range. A `deny` answer to a ranged read returns `'gone'`.
  - `withAgents($, messages: SessionMessage[]): Promise<Part>` reads each `agentId` on a tool use with `$.session.messages({ agentId })`. It skips agents that answer `deny`.
  - `afterUuid(messages: SessionMessage[], uuid: string | null): SessionMessage[]` returns the messages after `uuid`. If `uuid` is null or absent, it returns all of them.
  - `hasToolCalls(p: Part): boolean`
  - `splitTurns(p: Part, maxChars: number): Part[]` cuts only before a user message that carries text and no `toolResults`. Each agent goes with the part that holds its tool use. A single turn larger than `maxChars` stays whole.
  - `renderPart(p: Part): string` renders roles, text, each tool call as `tool(input JSON)`, and each result text in full.
  - `normalize(s: string): string` collapses all whitespace to one space and trims.
  - `corpus(p: Part): string` returns `normalize` of every tool result text in the main part and in its agents, joined by newlines.
  - `fromJsonl(text: string): SessionMessage[]` keeps lines with `type` `user` or `assistant`. It maps `tool_use` blocks to `toolUses` and `tool_result` blocks to `toolResults`, with string or text-block content. It keeps `uuid` and skips lines that do not parse.
  - `CHUNK_CHARS = 300_000`

- [ ] **Step 1: Make a transcript fixture**

Copy 6 to 10 lines from a real transcript file of 2.1.329 into `tests/fixtures/transcript.jsonl`. Keep one user prompt, one `tool_use`, its `tool_result`, one assistant text and one `attachment` line. Replace every value with neutral text, and keep each key and `type` as they are.

- [ ] **Step 2: Write the failing tests**

```ts
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
  expect(parts.map(p => p.messages[0]?.uuid)).toEqual(['p1', 'p2', 'p3'])
})

test('the corpus holds tool output, normalized', () => {
  const use = { tool_use_id: 't1', tool: 'Bash', input: { command: 'ls' }, text: 'a\n  b' }
  expect(corpus({ messages: [msg('u', 'assistant', 'chat', { toolUses: [use] })], agents: {} })).toBe('a b')
})

test('parses the transcript file of the pinned version', async ($) => {
  const text = await $.fs.read(`${$.plugin.root}/tests/fixtures/transcript.jsonl`)
  const messages = fromJsonl(text)
  expect(messages.some(m => m.toolUses.length > 0)).toBe(true)
  expect(messages.some(m => (m.toolResults ?? []).length > 0)).toBe(true)
  expect(messages.every(m => typeof m.uuid === 'string')).toBe(true)
})
```

The last test reads the fixture through the `$` of the test kit, not the fake.

- [ ] **Step 3: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the transcript tests FAIL.

- [ ] **Step 4: Implement `hooks/transcript.ts`**

- [ ] **Step 5: Run the tests and check that they pass**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): read, split and render transcript parts"
```

---

### Task 5: Drafting and op checks

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/draft.ts`
- Test: `plugins/obsidian-knowledge/tests/draft.test.ts`

**Interfaces:**
- Consumes: `Part`, `renderPart`, `normalize` from Task 4. `NoteFile`, `safeRel`, `fileTitle` from Task 2.
- Produces, in `hooks/draft.ts`:
  - `MODEL = 'sonnet'`, `DRAFT_MAX_TOKENS = 16000`
  - `RULES: string`, the fixed prompt. It holds every rule in the spec's Drafting section, the reply schema below, and the auto-memory boundary.
  - `type DraftContext = { tree: string[]; closest: { path: string; text: string }[] }`
  - `closestNotes($, v: Vault, notes: NoteFile[], partText: string): Promise<{ path: string; text: string }[]>` returns the top 5 non-hub notes with their text. The key words are the part's 30 most frequent words of 4 or more letters. A note scores one point for each key word in its title or text.
  - `draftPart($, p: Part, ctx: DraftContext): Promise<unknown[] | 'failed'>` calls `$.model.complete({ model: MODEL, maxTokens: DRAFT_MAX_TOKENS, prompt: [{ text: RULES, cache: true }, { text: <tree, closest notes, renderPart(p)> }] })`. An unanswered call, or a reply that `parseReply` cannot read, returns `'failed'`.
  - `parseReply(text: string): unknown[] | undefined` reads a JSON array, bare or inside one fenced block.
  - `checkOps(raw: unknown[], corpusText: string, ctx: DraftContext): DraftOp[]`
  - `maskSecrets(s: string): string`

The reply schema in `RULES`:

```json
[
  { "kind": "new", "folder": "ArgoCD", "title": "...", "body": "...", "tags": ["..."], "related": ["..."], "evidence": [{ "quote": "...", "source": "Bash: argocd app get x" }] },
  { "kind": "update", "path": "ArgoCD/Sync.md", "addition": "...", "related": [], "evidence": [{ "quote": "...", "source": "..." }] }
]
```

`checkOps` drops an op unless all of these hold:
- the fields have the schema's types, and `evidence` has at least one entry,
- every `normalize(quote)` appears in `corpusText`,
- a `new` op's `folder` is `''`, a folder in `ctx.tree`, or one new segment with no `/`,
- an `update` op's `path` passes `safeRel` and ends in `.md`.

It then runs `fileTitle` on titles and `maskSecrets` on titles, bodies, additions and quotes. It sets `baseHash` to `''`, and Task 6 fills it.

`maskSecrets` replaces matches with `[masked]`. Start with these patterns, and keep the key name for the `key=value` form:
- `AKIA[0-9A-Z]{16}`
- `gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_[A-Za-z0-9_]{22,}`
- `xox[abprs]-[A-Za-z0-9-]{10,}`
- `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
- `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`
- `(password|passwd|secret|token|api[_-]?key|app[_-]?key)(\s*[:=]\s*)\S+`, case-insensitive

- [ ] **Step 1: Write the failing tests**

```ts
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

test('masks secrets after the evidence check', () => {
  const [op] = checkOps([nw({ evidence: ev('token=abc123 OutOfSync app') })], 'token=abc123 OutOfSync app', ctx)
  expect(op?.evidence[0]?.quote).toBe('token=[masked] OutOfSync app')
  expect(maskSecrets('AKIAABCDEFGHIJKLMNOP')).toBe('[masked]')
})

test('reads fenced and bare JSON, and rejects prose', () => {
  expect(parseReply('```json\n[]\n```')).toEqual([])
  expect(parseReply('[{"kind":"new"}]')?.length).toBe(1)
  expect(parseReply('Nothing to keep.')).toBeUndefined()
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
})
```

Extend the fake so that `prompts` records the joined prompt text, and add a `requests` array that records each request. Then assert `requests[0].maxTokens === 16000` and `requests[0].prompt[0].cache === true`.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the draft tests FAIL.

- [ ] **Step 3: Implement `hooks/draft.ts`**

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): drafting prompt, reply checks and masking"
```

---

### Task 6: Capture checkpoints

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/capture.ts`
- Modify: `plugins/obsidian-knowledge/hooks/register.ts`
- Test: `plugins/obsidian-knowledge/tests/capture.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces, in `hooks/capture.ts`:
  - `type Options = { vaultFolder: string; exclude: readonly string[] }`
  - `type CaptureResult = { drafted: number; pending: number } | { skipped: 'headless' | 'excluded' | 'no-tools' | 'unreadable' | 'failed' }`
  - `IDLE_MS = 15 * 60 * 1000`
  - `isExcluded(root: string, exclude: readonly string[], home: string): boolean` expands `~` and matches a folder or anything under it. A trailing `/` does not matter.
  - `runSerial<T>(job: () => Promise<T>): Promise<T>` chains jobs in this module, so two checkpoints in one process never draft at once.
  - `capture($, opts: Options, given?: SessionMessage[]): Promise<CaptureResult>`
  - `catchUp($, opts: Options): Promise<number>` returns the number of drafts it queued.
  - `pendingLine(n: number): string | undefined` returns the Global Constraints text, or `undefined` for 0.

`capture` runs these steps in order inside `runSerial`:
1. If `$.session.surface()` is `null`, return `headless`. If `isExcluded`, return `excluded`.
2. Open the vault. On an error with `code` `EPERM` or `EACCES`, write the permission line once per session with `$.ui.log` and return `unreadable`.
3. With `given`, take `afterUuid(given, cursor.uuid)`. Without it, call `readSince`. On `'gone'`, move the cursor to the newest message and return `{ drafted: 0, pending }`.
4. Build the part with `withAgents`. If `hasToolCalls` is false, move the cursor and return `no-tools`.
5. For each part of `splitTurns(part, CHUNK_CHARS)`, call `draftPart`, then `checkOps` against `corpus`. On `'failed'`, keep the cursor and return `failed`.
6. Drop ops that `isDropped` reports. For each update op, read the target file. If the file is missing, drop the op. Else set `baseHash` to `hash` of its text.
7. `enqueue` the ops with the source string, move the cursor to the last `uuid`, and return the counts.

The permission line reads: `obsidian-knowledge cannot open <folder>. In System Settings, open Privacy & Security, then Files & Folders, and give your terminal access to iCloud Drive.`

`catchUp` takes the cursors of other sessions with the same `project` and a `transcriptPath`. It skips a file whose `mtimeMs` is less than 20 minutes old, because that session can still be running. It reads the file, runs `fromJsonl` and `afterUuid`, and drafts like `capture` steps 4 to 7. Subagent transcripts of ended sessions stay out of catch-up.

Wiring in `register.ts`:
- `session.start`: after `next(e)`, read this session's cursor. If none exists, store one, with `project` from `$.session.root()` and `transcriptPath` from `$.session.info()`. Register `/vault-capture` and `/vault-review`. If drafts wait, write `pendingLine` with `$.ui.log`. Start `catchUp` with `$.clock.after(0, ...)`.
- `turn.start` for the main loop (no `agentId`): cancel the idle timer.
- `turn.complete` for the main loop: start a new idle timer of `IDLE_MS` that calls `capture`.
- `session.compact`: for triggers `manual`, `auto` and `plugin` with no `agentId`, start `capture($, opts, e.messages)` with `$.clock.after(0, ...)`. Return `next(e)` right away in every case.
- `command.run` for `vault-capture`: await `capture` and answer with the drafted and pending counts, or the skip reason.
- Wrap each hook with `.catch(...)` so that a failure never blocks the session, like `mcp-hold`.

- [ ] **Step 1: Write the failing tests**

```ts
const opts = { vaultFolder: '/v/Claude', exclude: ['~/private/'] }
const use = (text: string) => ({ tool_use_id: 't', tool: 'Bash', input: { command: 'x' }, text })
const reply = JSON.stringify([{ kind: 'new', folder: '', title: 'Sync', body: 'b', tags: [], related: [], evidence: [{ quote: 'OutOfSync', source: 'Bash' }] }])
const transcript = [{ uuid: 'u1', role: 'user', text: 'go', toolUses: [] }, { uuid: 'u2', role: 'assistant', text: '', toolUses: [use('OutOfSync')] }]

test('a checkpoint queues proven drafts and moves the cursor', async () => {
  const f = fake({ messages: transcript, replies: [reply], session: 's1', store: { cursors: { s1: { uuid: null, project: '/p', transcriptPath: '', seen: 1 } } } })
  expect(await capture(f.$, opts)).toEqual({ drafted: 1, pending: 1 })
  expect((f.store.get('cursors') as Record<string, Cursor>).s1?.uuid).toBe('u2')
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
  const f = fake({ messages: transcript, replies: [new Error('500')], session: 's1', store: { cursors: { s1: { uuid: null, project: '/p', transcriptPath: '', seen: 1 } } } })
  expect(await capture(f.$, opts)).toEqual({ skipped: 'failed' })
  expect((f.store.get('cursors') as Record<string, Cursor>).s1?.uuid).toBeNull()
})

test('a part with no tool calls makes no model call', async () => {
  const f = fake({ messages: [{ uuid: 'u1', role: 'user', text: 'hi', toolUses: [] }] })
  expect(await capture(f.$, opts)).toEqual({ skipped: 'no-tools' })
  expect(f.prompts).toEqual([])
})

test('a cursor gone after compaction moves to the newest message', async () => {
  const f = fake({ messages: transcript, session: 's1', store: { cursors: { s1: { uuid: 'old', project: '/p', transcriptPath: '', seen: 1 } } } })
  await capture(f.$, opts)
  expect((f.store.get('cursors') as Record<string, Cursor>).s1?.uuid).toBe('u2')
})

test('an unreadable vault writes the permission line once', async () => {
  const f = fake({ denied: '/v', messages: transcript, replies: [reply, reply] })
  await capture(f.$, opts)
  await capture(f.$, opts)
  expect(f.logs.filter(l => l.includes('Privacy & Security')).length).toBe(1)
})

test('a precompute or subagent compaction starts no draft', async ($, on) => {
  // Load register.ts through the test kit, then raise session.compact twice.
  // Assert that no timer was started and that each hook returned next(e).
})

test('a compaction hook returns before its draft ends', async ($, on) => {
  // Raise session.compact with trigger 'manual'. Assert that it resolved while the
  // fake model reply is still pending, and that one timer was started.
})

test('exclude matching ignores a trailing slash', () => {
  expect(isExcluded('/h/private', ['~/private/'], '/h')).toBe(true)
  expect(isExcluded('/h/privateer', ['~/private'], '/h')).toBe(false)
})
```

The two hook tests use the test kit's `$` and `on`, as in the example `pane.test.tsx`. Raise `session.compact` through `$.session.compact({ trigger, agentId, messages })`, and stand in for the engine with `on('session.compact', () => ({ messages: [] }))`.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the capture tests FAIL.

- [ ] **Step 3: Implement `hooks/capture.ts` and the wiring in `hooks/register.ts`**

- [ ] **Step 4: Run the tests and the validator**

Run: `npx claude plugin test plugins/obsidian-knowledge && npx claude plugin validate plugins/obsidian-knowledge`
Expected: 0 fail, and validation passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): capture at compaction, idle, command and catch-up"
```

---

### Task 7: Approval and hub notes

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/apply.ts`
- Test: `plugins/obsidian-knowledge/tests/apply.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3. `MODEL` from Task 5.
- Produces, in `hooks/apply.ts`:
  - `approve($, v: Vault, item: DraftItem, today: string): Promise<'written' | 'requeued' | 'failed'>`
  - `redraft($, v: Vault, item: DraftItem, current: string, path: string): Promise<DraftItem | undefined>` asks `MODEL` for one `addition` that merges the item's facts into `current`, with `maxTokens` 4000. The reply is `{ "addition": "..." }`. It returns an update item with the new `baseHash`, or `undefined` on failure.
  - `refreshHubs($, v: Vault, folders: string[]): Promise<void>` rewrites the hub block of each named folder and of its parent.

`approve` works like this:
- A `new` item: check the title against `outsideTitles` and the titles in the mod folder at approval time. If a note with the same title sits in the mod folder, call `redraft` against it. Put the result back in the queue and return `requeued`. Else apply `uniqueTitle` with `outsideTitles`. Then write `renderNote`, with `learned` and `updated` set to `today`.
- An `update` item: if the target is missing, look for the same title anywhere in `listNotes`. If found, use that path. If not found, write the facts as a new note in the old folder. If the current `hash` differs from the item's first `baseHash`, call `redraft` and requeue. Else apply each op with `applyUpdate`, in order, in one write.
- After a write, call `refreshHubs` for the folder and remove the item from the queue.
- A write that rejects returns `failed` and leaves the queue as it was.

- [ ] **Step 1: Write the failing tests**

```ts
const v = { root: '/v/C', vaultRoot: '/v' }
const nwItem = (folder: string, title: string): DraftItem => ({ id: 'i1', kind: 'new', target: `${folder}/${title}.md`, sources: ['2026-11-25 session s1'], ops: [{ kind: 'new', folder, title, body: 'b', tags: [], related: [], evidence: [{ quote: 'q', source: 'Bash' }] }] })

test('a new note creates the mod folder on a fresh install', async () => {
  const f = fake({ store: { 'queue:/v/C': [nwItem('ArgoCD', 'Sync')] } })
  expect(await approve(f.$, v, nwItem('ArgoCD', 'Sync'), '2026-11-25')).toBe('written')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toContain('# Sync')
  expect(f.files.get('/v/C/ArgoCD/ArgoCD.md')).toContain('- [[Sync]]')
  expect(f.store.get('queue:/v/C')).toEqual([])
})

test('a title that clashes with your note gets the suffix', async () => {
  const f = fake({ files: { '/v/Mine/Sync.md': 'mine' } })
  await approve(f.$, v, nwItem('ArgoCD', 'Sync'), '2026-11-25')
  expect(f.files.has('/v/C/ArgoCD/Sync (Claude).md')).toBe(true)
  expect(f.files.get('/v/Mine/Sync.md')).toBe('mine')
})

test('an edited note is drafted again and never overwritten', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/Sync.md': 'edited by you' }, replies: ['{"addition":"merged"}'] })
  const item: DraftItem = { id: 'i2', kind: 'update', target: 'ArgoCD/Sync.md', sources: ['s'], ops: [{ kind: 'update', path: 'ArgoCD/Sync.md', addition: 'a', related: [], evidence: [{ quote: 'q', source: 'Bash' }], baseHash: 'stale' }] }
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('requeued')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toBe('edited by you')
})

test('a new note whose title appeared on disk becomes an update draft', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/Sync.md': 'existing' }, replies: ['{"addition":"merged"}'] })
  expect(await approve(f.$, v, nwItem('ArgoCD', 'Sync'), '2026-11-25')).toBe('requeued')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toBe('existing')
})

test('an update follows a note you moved', async () => {
  const text = 'body\n'
  const f = fake({ files: { '/v/C/Redis/Sync.md': text } })
  const item: DraftItem = { id: 'i3', kind: 'update', target: 'ArgoCD/Sync.md', sources: ['s'], ops: [{ kind: 'update', path: 'ArgoCD/Sync.md', addition: 'more', related: [], evidence: [{ quote: 'q', source: 'Bash' }], baseHash: hash(text) }] }
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('written')
  expect(f.files.get('/v/C/Redis/Sync.md')).toContain('more')
})

test('an update of a deleted note becomes a new note', async () => {
  const f = fake()
  const item: DraftItem = { id: 'i4', kind: 'update', target: 'ArgoCD/Sync.md', sources: ['s'], ops: [{ kind: 'update', path: 'ArgoCD/Sync.md', addition: 'more', related: [], evidence: [{ quote: 'q', source: 'Bash' }], baseHash: 'h' }] }
  expect(await approve(f.$, v, item, '2026-11-25')).toBe('written')
  expect(f.files.get('/v/C/ArgoCD/Sync.md')).toContain('more')
})
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the apply tests FAIL.

- [ ] **Step 3: Implement `hooks/apply.ts`**

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): approve drafts, keep your edits, update hubs"
```

---

### Task 8: Folder growth

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/growth.ts`
- Modify: `plugins/obsidian-knowledge/hooks/apply.ts` (call growth after a write)
- Test: `plugins/obsidian-knowledge/tests/growth.test.ts`

**Interfaces:**
- Consumes: `NoteFile`, `listNotes`, `moveFile`, `folders` from Task 2. `enqueueMove` from Task 3. `refreshHubs` from Task 7. `MODEL` from Task 5.
- Produces, in `hooks/growth.ts`:
  - `SPLIT_AT = 12`, `MAX_DEPTH = 3`
  - `crowded(notes: NoteFile[]): string[]` returns folders that hold more than `SPLIT_AT` non-hub notes directly.
  - `proposeSplit($, folder: string, notes: NoteFile[]): Promise<Omit<MoveItem, 'id'> | undefined>` asks `MODEL` for subfolders and moves of that folder's notes, with `maxTokens` 4000. The reply is `{ "moves": [{ "from": "...", "to": "..." }] }`.
  - `proposeParent($, siblings: string[], base: string): Promise<Omit<MoveItem, 'id'> | undefined>` asks `MODEL` whether three or more sibling folders share one subject. It returns one parent proposal or none.
  - `checkMoves(moves: Move[], notes: NoteFile[]): Move[] | undefined` returns the list or `undefined`. To return the list, every `from` must exist and every `to` must keep its file name and pass `safeRel`. No `to` folder can be deeper than `MAX_DEPTH`, and no two `to` paths can match.
  - `applyMoves($, v: Vault, item: MoveItem): Promise<void>` moves each file with `moveFile`, then calls `refreshHubs` for the old and new folders.
  - `afterWrite($, v: Vault, created: string | undefined, now: number): Promise<void>` queues a split proposal for each crowded folder. If `created` names a new folder, it also runs `proposeParent` over that folder and its siblings.

- [ ] **Step 1: Write the failing tests**

```ts
const notes = (folder: string, n: number) => Array.from({ length: n }, (_, i) => ({ path: `${folder}/N${i}.md`, title: `N${i}`, folder, isHub: false }))

test('a folder with 13 notes produces one split proposal', async () => {
  const files = Object.fromEntries(notes('ArgoCD', 13).map(n => [`/v/C/${n.path}`, '']))
  const moves = notes('ArgoCD', 13).map(n => ({ from: n.path, to: `ArgoCD/Sets/${n.title}.md` }))
  const f = fake({ files, replies: [JSON.stringify({ moves })] })
  await afterWrite(f.$, { root: '/v/C', vaultRoot: '/v' }, undefined, 1)
  const queue = f.store.get('queue:/v/C') as QueueItem[]
  expect(queue.length).toBe(1)
  expect(queue[0]?.kind).toBe('split')
})

test('a folder with 12 notes makes no model call', async () => {
  const f = fake({ files: Object.fromEntries(notes('ArgoCD', 12).map(n => [`/v/C/${n.path}`, ''])) })
  await afterWrite(f.$, { root: '/v/C', vaultRoot: '/v' }, undefined, 1)
  expect(f.prompts).toEqual([])
})

test('a move keeps every title', () => {
  const list = notes('ArgoCD', 2)
  expect(checkMoves([{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/Renamed.md' }], list)).toBeUndefined()
  expect(checkMoves([{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/N0.md' }], list)).toEqual([{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/N0.md' }])
})

test('a move never goes deeper than three levels', () => {
  expect(checkMoves([{ from: 'A/B/C/N0.md', to: 'A/B/C/D/N0.md' }], [{ path: 'A/B/C/N0.md', title: 'N0', folder: 'A/B/C', isHub: false }])).toBeUndefined()
})

test('applied moves keep links working and update hubs', async () => {
  const f = fake({ files: { '/v/C/ArgoCD/N0.md': 'see [[N1]]', '/v/C/ArgoCD/N1.md': '' } })
  await applyMoves(f.$, { root: '/v/C', vaultRoot: '/v' }, { id: 'm', kind: 'split', folder: 'ArgoCD', moves: [{ from: 'ArgoCD/N0.md', to: 'ArgoCD/Sets/N0.md' }] })
  expect(f.files.get('/v/C/ArgoCD/Sets/N0.md')).toBe('see [[N1]]')
  expect(f.files.get('/v/C/ArgoCD/ArgoCD.md')).toContain('- [[Sets]]')
  expect(f.files.get('/v/C/ArgoCD/Sets/Sets.md')).toContain('- [[N0]]')
})
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the growth tests FAIL.

- [ ] **Step 3: Implement `hooks/growth.ts`, and call `afterWrite` at the end of a `written` approval in `apply.ts`**

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): propose folder splits and parents"
```

---

### Task 9: The review pane

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/pane.tsx`
- Modify: `plugins/obsidian-knowledge/hooks/register.ts`. It imports `pane.tsx`, so `hooks.json` stays as it is.
- Test: `plugins/obsidian-knowledge/tests/pane.test.tsx`

**Interfaces:**
- Consumes: `loadQueue`, `replaceItem`, `dropItem` from Task 3. `approve` from Task 7. `applyMoves` from Task 8.
- Produces, in `hooks/pane.tsx`:
  - `PANE = 'vault-review'`
  - `review = atom({ plugin: 'obsidian-knowledge', key: 'review' } as const, { index: 0, editing: false, rev: 0 }, { shape: 'review-1' })`
  - `itemView(item: QueueItem): { heading: string; text: string }`. The heading reads `[new] ArgoCD/Sync.md`, `[update] ...`, `[split] ArgoCD` or `[parent] ...`. For a draft, the text is the rendered note or the additions with their evidence. For a move, it is one `from -> to` line per move.
  - `renderPane($, e): Promise<JSX.Element>` for the `ui.render` hook on `{ component: 'Pane', requestId: PANE }`.

The pane shows `N pending`, the heading and the text of the item at `index`, and four buttons: `Approve` (hotkey `a`), `Edit` (`e`), `Drop` (`d`) and `Next` (`n`). `Edit` swaps the text for an `Input` with `rows` 12, holding the body of a new note or the addition of an update. `onSubmit` saves the edit with `replaceItem` and leaves edit mode. Every action bumps `rev` with `update`, so the pane draws again. With an empty queue, the pane shows `No vault drafts pending.`

Wiring in `register.ts`: `command.run` for `vault-review` calls `$.ui.open({ id: PANE, title: 'Vault review' })` and answers `Vault review opened.` The `ui.render` hook calls `renderPane`.

- [ ] **Step 1: Write the failing tests**

Follow the example `pane.test.tsx` of the plugin-authoring skill. Mount the pane on `terminal` and `desktop` in a loop.

```ts
test('the pane shows the first pending item', async ($, on) => {
  // Seed the store with one new-note item through on('store.get', ...).
  // Mount the pane. Expect a Text with '[new] ArgoCD/Sync.md' and one with '1 pending'.
})

test('approve writes the note and shows the next item', async ($, on) => {
  // Seed two items. Press the button with key 'approve'. Expect the second heading.
})

test('drop removes the item and remembers its fact', async ($, on) => {
  // Seed one item. Press 'drop'. Expect 'No vault drafts pending.' and a dropped key in the store.
})

test('edit saves the new body', async ($, on) => {
  // Press 'edit', then input { key: 'body', text: 'new body', kind: 'submit' }. Expect the stored item body to be 'new body'.
})

test('an empty queue says so', async ($, on) => {
  // Mount with no items. Expect 'No vault drafts pending.'
})

test('item views name the kind and target', () => {
  expect(itemView({ id: 'm', kind: 'split', folder: 'ArgoCD', moves: [{ from: 'ArgoCD/A.md', to: 'ArgoCD/S/A.md' }] })).toEqual({ heading: '[split] ArgoCD', text: 'ArgoCD/A.md -> ArgoCD/S/A.md' })
})
```

Give the buttons the keys `approve`, `edit`, `drop` and `next`. Give the `Input` the key `body`. The tests find them by these keys.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the pane tests FAIL.

- [ ] **Step 3: Implement `hooks/pane.tsx` and its wiring**

- [ ] **Step 4: Run the tests and the validator**

Run: `npx claude plugin test plugins/obsidian-knowledge && npx claude plugin validate plugins/obsidian-knowledge`
Expected: 0 fail, and validation passes with the `review` state key matched to the contract.

- [ ] **Step 5: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): /vault-review pane"
```

---

### Task 10: The search tool

**Files:**
- Create: `plugins/obsidian-knowledge/hooks/search.ts`
- Modify: `plugins/obsidian-knowledge/hooks/register.ts`
- Test: `plugins/obsidian-knowledge/tests/search.test.ts`

**Interfaces:**
- Consumes: `listNotes`, `folders` from Task 2. `parseFrontmatter` from Task 1.
- Produces, in `hooks/search.ts`:
  - `type Hit = { title: string; path: string; excerpt: string; learned?: string; updated?: string; sources: string[] }`
  - `search($, v: Vault, query: string, limit?: number): Promise<Hit[]>`. The default limit is 8. It matches every word of the query, case-insensitive, in the title or the text, and ranks title matches first. The excerpt is up to 200 characters around the first match. Hub notes are skipped.
  - `formatHits(hits: Hit[]): string`
  - `topics(notes: NoteFile[]): string[]` returns folders of the first two levels.
  - `toolDescription(topics: string[]): string`

The tool description reads: `Searches the knowledge vault that obsidian-knowledge keeps in Obsidian. Topics: <comma-separated topics, or "none yet">. Each result is a lead to re-check, not a settled fact. It shows when the fact was learned and the session it came from.`

Wiring in `register.ts`: in `session.start`, register `vault_search` with `$.tool.register({ name: 'vault_search', description, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, isDeferred: false })`. Add `on('tool.run', { tool: 'mcp__obsidian-knowledge__vault_search' }, ...)` that answers `{ result: formatHits(...) }`. Its input is untrusted, so a missing or empty `query` answers `vault_search needs a query.`

- [ ] **Step 1: Write the failing tests**

```ts
const v = { root: '/v/C', vaultRoot: '/v' }
const files = {
  '/v/C/Kubernetes/ArgoCD/Sync.md': '---\ntopic: Kubernetes/ArgoCD\nlearned: 2026-11-03\nupdated: 2026-11-18\nsources:\n  - 2026-11-03 session 3a196d38\n---\n\n# Sync\n\nRollingSync marks apps OutOfSync.\n',
  '/v/C/Kubernetes/ArgoCD/ArgoCD.md': 'RollingSync hub',
  '/v/C/Datadog/Retention.md': '# Retention\n\nLogs stay 3 days.\n',
}

test('finds notes by every query word, with dates and sources', async () => {
  const hits = await search(fake({ files }).$, v, 'rollingsync outofsync')
  expect(hits.map(h => h.title)).toEqual(['Sync'])
  expect(hits[0]).toMatchObject({ learned: '2026-11-03', updated: '2026-11-18', sources: ['2026-11-03 session 3a196d38'] })
})

test('skips hub notes', async () => {
  expect((await search(fake({ files }).$, v, 'hub')).length).toBe(0)
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
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: the search tests FAIL.

- [ ] **Step 3: Implement `hooks/search.ts` and its wiring**

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx claude plugin test plugins/obsidian-knowledge`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugins/obsidian-knowledge
git commit -m "feat(obsidian-knowledge): vault_search tool"
```

---

### Task 11: Docs, marketplace and a live run

**Files:**
- Create: `plugins/obsidian-knowledge/README.md`
- Modify: `README.md` (mods table), `.claude-plugin/marketplace.json`

- [ ] **Step 1: Write the mod README**

Follow the sections of `plugins/mcp-hold/README.md`: what it does, why, how it works, options, commands, the macOS permission, limits and install. List these limits:
- Catch-up skips subagent transcripts.
- Code Mode results can miss the evidence check.
- The first read of a very long session sees only its newest 4096 messages.
- Older transcripts are not imported.

- [ ] **Step 2: Add the mod to the root README table and to `marketplace.json`**

The marketplace entry has `name`, `source` `./plugins/obsidian-knowledge` and a one-line `description`.

- [ ] **Step 3: Run every check**

Run: `npm run validate && npm test`
Expected: both pass for both mods.

- [ ] **Step 4: Run the mod live against a test folder**

Start `claude --plugin-dir plugins/obsidian-knowledge`. In `/config`, set `vaultFolder` to a new folder in the session scratchpad. Run a few Bash commands that show a fact, then run `/vault-capture`. Expect a reply with at least one draft. Run `/vault-review`, approve the draft, and expect the note and its hub in the test folder. Queue one more draft and start a second session. Expect the pending line and the new topic in the `vault_search` description.

- [ ] **Step 5: Commit**

```bash
git add plugins/obsidian-knowledge/README.md README.md .claude-plugin/marketplace.json
git commit -m "docs(obsidian-knowledge): README and marketplace entry"
```
