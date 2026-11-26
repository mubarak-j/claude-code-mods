import type { EngineInterface, Register } from 'claude-code'
import { IDLE_MS, type Options, capture, captureCompaction, catchUp, pendingLine } from './capture'
import { getCursor, loadQueue, setCursor } from './queue'
import { PANE, renderPane, unavailable } from './pane'
import { formatHits, search, toolDescription, topics } from './search'
import { listNotes, openVault } from './vault'

type $ = EngineInterface

let idle: { cancel: () => void } | undefined

const quiet = () => undefined // A failure in the mod never blocks the session.

async function pending($: $, opts: Options): Promise<number> {
  return (await loadQueue($, (await openVault($, opts.vaultFolder)).root)).length
}

export const register: Register = (on, options) => {
  const opts: Options = { vaultFolder: String(options.vaultFolder ?? ''), exclude: (options.exclude as readonly string[] | undefined) ?? [] }

  on('session.start', async ($, e, next) => {
    // Registered before next(e) so the tool is listed by turn one.
    const list = await openVault($, opts.vaultFolder).then((v) => listNotes($, v)).then(topics, () => [])
    await $.tool
      .register({
        name: 'vault_search',
        description: toolDescription(list),
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        isDeferred: false,
      })
      .catch(quiet)
    const started = await next(e)
    try {
      const id = await $.session.id()
      if ((await $.session.surface()) !== null && !(await getCursor($, id)))
        await setCursor($, id, { uuid: null, project: await $.session.root(), transcriptPath: (await $.session.info()).transcriptPath, seen: await $.clock.now() })
      await $.command.register({ name: 'vault-capture', description: 'Draft vault notes from this session now' })
      await $.command.register({ name: 'vault-review', description: 'Review the vault drafts that wait for approval' })
      const line = pendingLine(await pending($, opts).catch(() => 0))
      if (line) $.ui.log(line)
      $.clock.after(0, () => void catchUp($, opts).catch(quiet))
    } catch {
      // next(e) already ran; the catch below would run it a second time.
    }
    return started
  }).catch(($, e, next) => next(e))

  on('tool.run', { tool: 'mcp__obsidian-knowledge__vault_search' }, async ($, e) => {
    const query = typeof e.query === 'string' ? e.query.trim() : ''
    if (!query) return { result: 'vault_search needs a query.' }
    return { result: formatHits(await search($, await openVault($, opts.vaultFolder), query)) }
  }).catch(() => ({ result: 'vault_search failed: the vault is unavailable.' }))

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
    if (e.trigger !== 'precompute' && e.agentId === undefined) await captureCompaction($, opts)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'vault-capture' }, async ($) => {
    const r = await capture($, opts)
    return { text: 'skipped' in r ? `Nothing drafted: ${r.skipped}.` : `Drafted ${r.drafted}, ${r.pending} pending.` }
  }).catch(() => ({ text: 'vault-capture failed.' }))

  on('command.run', { command: 'vault-review' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Vault review' })
    return { text: 'Vault review opened.' }
  }).catch(() => ({ text: 'vault-review failed.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e, opts.vaultFolder)).catch(($, e) => unavailable($, e))
}
