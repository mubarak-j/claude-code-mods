import type { EngineInterface, Register } from 'claude-code'
import { IDLE_MS, type Options, capture, catchUp, pendingLine } from './capture'
import { getCursor, loadQueue, setCursor } from './queue'
import { openVault } from './vault'

type $ = EngineInterface

let idle: { cancel: () => void } | undefined

const quiet = () => undefined // A failure in the mod never blocks the session.

async function pending($: $, opts: Options): Promise<number> {
  return (await loadQueue($, (await openVault($, opts.vaultFolder)).root)).length
}

export const register: Register = (on, options) => {
  const opts: Options = { vaultFolder: String(options.vaultFolder ?? ''), exclude: (options.exclude as readonly string[] | undefined) ?? [] }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const id = await $.session.id()
    if ((await $.session.surface()) !== null && !(await getCursor($, id)))
      await setCursor($, id, { uuid: null, project: await $.session.root(), transcriptPath: (await $.session.info()).transcriptPath, seen: await $.clock.now() })
    await $.command.register({ name: 'vault-capture', description: 'Draft vault notes from this session now' })
    await $.command.register({ name: 'vault-review', description: 'Review the vault drafts that wait for approval' })
    const line = pendingLine(await pending($, opts).catch(() => 0))
    if (line) $.ui.log(line)
    $.clock.after(0, () => void catchUp($, opts).catch(quiet))
    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) idle?.cancel()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      idle?.cancel()
      idle = $.clock.after(IDLE_MS, () => void capture($, opts).catch(quiet))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.trigger !== 'precompute' && e.agentId === undefined) $.clock.after(0, () => void capture($, opts, [...e.messages]).catch(quiet))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'vault-capture' }, async ($) => {
    const r = await capture($, opts)
    return { text: 'skipped' in r ? `Nothing drafted: ${r.skipped}.` : `Drafted ${r.drafted}, ${r.pending} pending.` }
  }).catch(() => ({ text: 'vault-capture failed.' }))
}
