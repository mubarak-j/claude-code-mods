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

export const register: Register = on => {
  on('mcp.connect', async ($, e, next) =>
    (await shouldPass($, e.server, next.origin.plugin)) ? next(e) : { deny: `${e.server} held by mcp-hold` },
  )
}
