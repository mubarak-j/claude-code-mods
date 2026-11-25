import type { EngineInterface, Register } from 'claude-code'

const HELD = { plugin: 'mcp-hold', key: 'held' } as const
const SESSION_ALLOWED = { plugin: 'mcp-hold', key: 'sessionAllowed' } as const

// Servers that are part of Claude Code itself. The hook cannot tell them apart by provider.
export const BUILT_IN = ['claude-artifacts']

export async function projectKey($: EngineInterface): Promise<string> {
  const git = await $.process.run(['git', 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return git?.exitCode === 0 ? git.stdout.trim() : $.session.root()
}

export const storeKey = (project: string) => `allow:${project}`

export async function isAllowed($: EngineInterface, server: string): Promise<boolean> {
  if (BUILT_IN.includes(server)) return true
  if (((await $.state.get(SESSION_ALLOWED)).value ?? []).includes(server)) return true
  const stored = (await $.store.get(storeKey(await projectKey($)))) as string[] | undefined
  return stored?.includes(server) ?? false
}

// The tool description carries the held names, because a managed plugin can skip prompt.compose hooks.
export function toolDescription(held: string[]): string {
  const now = held.length ? `These MCP servers are held by mcp-hold: ${held.join(', ')}.` : 'No MCP server is held now.'
  return `${now} If a task needs a held server, call this tool with its name. The user picks the scope in a dialog or cancels.`
}

async function registerTool($: EngineInterface, held: string[]) {
  await $.tool
    .register({
      name: 'allow_server',
      description: toolDescription(held),
      inputSchema: { type: 'object', properties: { server: { type: 'string', description: 'The held server name' } }, required: ['server'] },
      isDeferred: false,
    })
    .catch(() => undefined) // Rejects until session.start, which registers it again.
}

// Connect hooks run in parallel and $.state.get reads one snapshot per dispatch,
// so the module keeps the live list and changes it synchronously. $.state mirrors it.
let held: string[] | undefined

async function updateHeld($: EngineInterface, change: (held: string[]) => string[]) {
  const seed = (await $.state.get(HELD)).value ?? []
  held = change(held ?? seed)
  const now = held
  await $.state.set(HELD, now)
  $.ui.status(now.length ? `mcp: ${now.length} held` : undefined)
  await registerTool($, now)
}

const heldList = async ($: EngineInterface) => held ?? (await $.state.get(HELD)).value ?? []

// Test-only: starts each test from an empty module list.
export function resetHeld() {
  held = undefined
}

// True lets the connect through. Only the engine's own raises are held.
export async function shouldPass($: EngineInterface, server: string, origin: string): Promise<boolean> {
  if (origin !== 'engine' || (await isAllowed($, server))) return true
  await updateHeld($, h => (h.includes(server) ? h : [...h, server]))
  return false
}

const ALWAYS = 'Always in this project'
const SESSION = 'This session only'

// Asks the scope, records the allow, and connects. A dismissed dialog counts as Cancel.
export async function allow($: EngineInterface, server: string): Promise<string> {
  const scope = await $.ui
    .ask(`Allow the MCP server ${server}?`, { header: 'mcp-hold', options: [ALWAYS, SESSION, 'Cancel'] })
    .catch(() => 'Cancel')
  if (scope !== ALWAYS && scope !== SESSION) return `Allow of ${server} cancelled.`

  const r = await $.mcp.connect(server)
  if (!r.isConnected) return r.message

  const sessionAllowed = (await $.state.get(SESSION_ALLOWED)).value ?? []
  await $.state.set(SESSION_ALLOWED, [...new Set([...sessionAllowed, server])])
  await updateHeld($, h => h.filter(x => x !== server))
  if (scope === SESSION) return `${server} connected for this session.`

  const key = storeKey(await projectKey($))
  const stored = ((await $.store.get(key)) as string[] | undefined) ?? []
  await $.store.set(key, [...new Set([...stored, server])])
  return `${server} connected and allowed in this project.`
}

export async function allowCommand($: EngineInterface, args: string): Promise<string> {
  const held = await heldList($)
  let name = args.trim()
  if (!name) {
    if (held.length === 0) return 'No MCP servers are held.'
    // shortcut: the dialog shows four servers at most; others are typed in its free-text field.
    name = held.length === 1
      ? held[0]!
      : (await $.ui.ask('Which held MCP server do you want to allow?', { header: 'mcp-hold', options: held.slice(0, 4) }).catch(() => '')).trim()
    if (!name) return 'Allow cancelled.'
  }
  return allow($, held.find(h => h.toLowerCase() === name.toLowerCase()) ?? name)
}

export async function forget($: EngineInterface): Promise<string> {
  const project = await projectKey($)
  const stored = (await $.store.get(storeKey(project))) as string[] | undefined
  if (!stored?.length) return `No stored allows for ${project}.`
  await $.store.delete(storeKey(project))
  return `Cleared the stored allows for ${project}: ${stored.join(', ')}.`
}

// The model's input is untrusted: check it before it reaches the dialog.
export async function allowTool($: EngineInterface, input: { server?: unknown }): Promise<string> {
  const server = typeof input.server === 'string' ? input.server.trim() : ''
  return server ? allow($, server) : 'allow_server needs a server name.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'mcp-allow', description: 'Connect an MCP server that mcp-hold holds', argumentHint: '[server]' })
    await $.command.register({ name: 'mcp-forget', description: 'Clear the MCP servers mcp-hold allows in this project' })
    await registerTool($, await heldList($))
    return started
  })
  on('tool.run', { tool: 'mcp__mcp-hold__allow_server' }, async ($, e) => ({ result: await allowTool($, { server: e.server }) })).catch(
    () => ({ result: 'mcp-hold failed to allow the server.' }),
  )
  on('command.run', { command: 'mcp-allow' }, async ($, e) => ({ text: await allowCommand($, e.args) }))
  on('command.run', { command: 'mcp-forget' }, async $ => ({ text: await forget($) }))

  on('mcp.connect', async ($, e, next) =>
    (await shouldPass($, e.server, next.origin.plugin)) ? next(e) : { deny: `${e.server} held by mcp-hold` },
  ).catch(($, e, next) => next(e)) // A failure in the mod lets the server connect instead of blocking it.
}
