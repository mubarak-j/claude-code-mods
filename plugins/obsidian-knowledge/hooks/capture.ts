import type { EngineInterface, SessionMessage } from 'claude-code'
import type { Cursor, DraftOp } from '../types'
import { checkOps, closestNotes, draftPart } from './draft'
import { day } from './note'
import { allCursors, enqueue, getCursor, isDropped, loadQueue, setCursor } from './queue'
import { CHUNK_CHARS, type Part, afterUuid, corpus, fromJsonl, hasToolCalls, readSince, splitTurns, withAgents } from './transcript'
import { type Vault, folders, hash, insidePath, listNotes, openVault } from './vault'

type $ = EngineInterface

export type Options = { vaultFolder: string; exclude: readonly string[] }
export type CaptureResult = { drafted: number; pending: number } | { skipped: 'headless' | 'excluded' | 'no-tools' | 'unreadable' | 'failed' }

export const IDLE_MS = 15 * 60 * 1000
const FRESH_MS = 20 * 60 * 1000

const strip = (p: string) => p.replace(/\/+$/, '')

export function isExcluded(root: string, exclude: readonly string[], home: string): boolean {
  const r = strip(root)
  return exclude.some((x) => {
    const e = strip(x.startsWith('~') ? home + x.slice(1) : x)
    return e !== '' && (r === e || r.startsWith(`${e}/`))
  })
}

let chain: Promise<unknown> = Promise.resolve()

export function runSerial<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job)
  chain = run.then(() => undefined, () => undefined)
  return run
}

export const pendingLine = (n: number): string | undefined => (n === 0 ? undefined : `${n} vault draft${n === 1 ? '' : 's'} pending, /vault-review`)

const warned = new Set<string>()
const denied = (e: unknown) => ['EPERM', 'EACCES'].includes((e as { code?: string })?.code ?? '')

async function warn($: $, folder: string) {
  const id = await $.session.id()
  if (warned.has(id)) return
  warned.add(id)
  $.ui.log(`obsidian-knowledge cannot open ${folder}. In System Settings, open Privacy & Security, then Files & Folders, and give your terminal access to iCloud Drive.`)
}

// Steps 5 and 6: draft each part, keep proven ops, skip dropped facts, pin updates to the file's current text.
async function draftOps($: $, v: Vault, part: Part): Promise<DraftOp[] | 'failed'> {
  const notes = await listNotes($, v)
  const out: DraftOp[] = []
  for (const p of splitTurns(part, CHUNK_CHARS)) {
    const ctx = { tree: folders(notes), closest: await closestNotes($, v, notes, corpus(p)) }
    const raw = await draftPart($, p, ctx)
    if (raw === 'failed') return 'failed'
    for (const op of checkOps(raw, corpus(p), ctx)) {
      if (await isDropped($, v.root, op)) continue
      if (op.kind === 'new') {
        out.push(op)
        continue
      }
      const abs = await insidePath($, v, op.path)
      const text = abs === undefined ? undefined : await $.fs.read(abs).catch(() => undefined)
      if (text !== undefined) out.push({ ...op, baseHash: hash(text) })
    }
  }
  return out
}

const lastUuid = (ms: SessionMessage[]) => ms.findLast((m) => m.uuid)?.uuid

export function capture($: $, opts: Options, given?: SessionMessage[]): Promise<CaptureResult> {
  return runSerial(async () => {
    const root = await $.session.root()
    const home = (await $.env.get('HOME')) ?? ''
    if ((await $.session.surface()) === null) return { skipped: 'headless' }
    if (isExcluded(root, opts.exclude, home)) return { skipped: 'excluded' }
    let v: Vault
    try {
      v = await openVault($, opts.vaultFolder)
    } catch (e) {
      if (!denied(e)) throw e
      await warn($, opts.vaultFolder)
      return { skipped: 'unreadable' }
    }
    const id = await $.session.id()
    const now = await $.clock.now()
    const cursor: Cursor = (await getCursor($, id)) ?? { uuid: null, project: root, transcriptPath: (await $.session.info()).transcriptPath, seen: now }
    const move = (uuid: string | null | undefined) => setCursor($, id, { ...cursor, uuid: uuid ?? cursor.uuid, seen: now })
    try {
      let messages: SessionMessage[]
      let last: string | null | undefined
      if (given) {
        messages = afterUuid(given, cursor.uuid)
        last = lastUuid(given)
      } else {
        const r = await readSince($, cursor.uuid)
        if (r === 'gone') {
          const r2 = await $.session.messages({ last: 1 })
          await move('deny' in r2 ? undefined : r2.at(-1)?.uuid)
          return { drafted: 0, pending: (await loadQueue($, v.root)).length }
        }
        ;({ messages, last } = r)
      }
      const part = await withAgents($, messages)
      if (!hasToolCalls(part)) {
        await move(last)
        return { skipped: 'no-tools' }
      }
      const ops = await draftOps($, v, part)
      if (ops === 'failed') return { skipped: 'failed' }
      const pending = await enqueue($, v.root, ops, `${day(now)} session ${id.slice(0, 8)}`, now)
      await move(last)
      return { drafted: ops.length, pending }
    } catch (e) {
      if (!denied(e)) throw e
      await warn($, opts.vaultFolder)
      return { skipped: 'unreadable' }
    }
  })
}

// Drafts what ended sessions of this project left behind. Returns the number of drafts queued.
export function catchUp($: $, opts: Options): Promise<number> {
  return runSerial(async () => {
    const root = await $.session.root()
    const home = (await $.env.get('HOME')) ?? ''
    if ((await $.session.surface()) === null || isExcluded(root, opts.exclude, home)) return 0
    let v: Vault
    try {
      v = await openVault($, opts.vaultFolder)
    } catch (e) {
      if (!denied(e)) throw e
      await warn($, opts.vaultFolder)
      return 0
    }
    const self = await $.session.id()
    const now = await $.clock.now()
    let queued = 0
    for (const [id, c] of Object.entries(await allCursors($))) {
      if (id === self || c.project !== root || !c.transcriptPath) continue
      try {
        if (now - (await $.fs.stat(c.transcriptPath)).mtimeMs < FRESH_MS) continue // That session can still be running.
        const messages = afterUuid(fromJsonl(await $.fs.read(c.transcriptPath)), c.uuid)
        const part: Part = { messages, agents: {} }
        const move = () => setCursor($, id, { ...c, uuid: lastUuid(messages) ?? c.uuid })
        if (!hasToolCalls(part)) {
          await move()
          continue
        }
        const ops = await draftOps($, v, part)
        if (ops === 'failed') continue
        await enqueue($, v.root, ops, `${day(now)} session ${id.slice(0, 8)}`, now)
        await move()
        queued += ops.length
      } catch (e) {
        if (denied(e)) throw e // The vault is unreadable; stop.
        // A missing or broken transcript is skipped.
      }
    }
    return queued
  })
}
