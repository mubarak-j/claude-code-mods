import type { EngineInterface, Register } from 'claude-code'

const HELD = { plugin: 'mcp-hold', key: 'held' } as const
const SESSION_ALLOWED = { plugin: 'mcp-hold', key: 'sessionAllowed' } as const

// Servers that are part of Claude Code itself. The hook cannot tell them apart by provider.
export const BUILT_IN = ['claude-artifacts']

export async function projectKey($: EngineInterface): Promise<string> {
  const git = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
  return git.exitCode === 0 ? git.stdout.trim() : $.session.root()
}

export const storeKey = (project: string) => `allow:${project}`

export async function isAllowed($: EngineInterface, server: string): Promise<boolean> {
  if (BUILT_IN.includes(server)) return true
  if (((await $.state.get(SESSION_ALLOWED)).value ?? []).includes(server)) return true
  const stored = (await $.store.get(storeKey(await projectKey($)))) as string[] | undefined
  return stored?.includes(server) ?? false
}

async function setHeld($: EngineInterface, held: string[]) {
  await $.state.set(HELD, held)
  $.ui.status(held.length ? `mcp: ${held.length} held` : undefined)
}

// True lets the connect through. Only the engine's own raises are held.
export async function shouldPass($: EngineInterface, server: string, origin: string): Promise<boolean> {
  if (origin !== 'engine' || (await isAllowed($, server))) return true
  const held = (await $.state.get(HELD)).value ?? []
  await setHeld($, held.includes(server) ? held : [...held, server])
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
  await setHeld($, ((await $.state.get(HELD)).value ?? []).filter(h => h !== server))
  if (scope === SESSION) return `${server} connected for this session.`

  const key = storeKey(await projectKey($))
  const stored = ((await $.store.get(key)) as string[] | undefined) ?? []
  await $.store.set(key, [...new Set([...stored, server])])
  return `${server} connected and allowed in this project.`
}

export async function allowCommand($: EngineInterface, args: string): Promise<string> {
  const held = (await $.state.get(HELD)).value ?? []
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'mcp-allow', description: 'Connect an MCP server that mcp-hold holds', argumentHint: '[server]' })
    await $.command.register({ name: 'mcp-forget', description: 'Clear the MCP servers mcp-hold allows in this project' })
    return started
  })
  on('command.run', { command: 'mcp-allow' }, async ($, e) => ({ text: await allowCommand($, e.args) }))
  on('command.run', { command: 'mcp-forget' }, async $ => ({ text: await forget($) }))

  on('mcp.connect', async ($, e, next) =>
    (await shouldPass($, e.server, next.origin.plugin)) ? next(e) : { deny: `${e.server} held by mcp-hold` },
  )
}
