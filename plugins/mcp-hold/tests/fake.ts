import type { EngineInterface } from 'claude-code'
import { resetHeld } from '../hooks/register'

// A stand-in for the engine's `$`, holding only the nouns mcp-hold uses.
export type Fake = {
  $: EngineInterface
  store: Map<string, unknown>
  state: Map<string, unknown>
  status: (string | undefined)[]
  asked: { question: string; options: readonly string[] }[]
  connected: string[]
  gitCwd: (string | undefined)[]
  tools: { name: string; description: string }[]
}

export function fake(opts: {
  git?: string | Error
  gitOutput?: string
  root?: string
  store?: Record<string, unknown>
  answers?: (string | Error)[]
  refuse?: string
} = {}): Fake {
  resetHeld()
  const f: Fake = {
    store: new Map(Object.entries(opts.store ?? {})),
    state: new Map(),
    status: [],
    asked: [],
    connected: [],
    gitCwd: [],
    tools: [],
    $: undefined as unknown as EngineInterface,
  }
  const answers = [...(opts.answers ?? [])]
  const $ = {
    store: {
      get: async (k: string) => f.store.get(k),
      set: async (k: string, v: unknown) => void f.store.set(k, JSON.parse(JSON.stringify(v))),
      delete: async (k: string) => void f.store.delete(k),
      keys: async () => [...f.store.keys()],
    },
    state: {
      get: async (ref: { key: string }) => ({ value: f.state.get(ref.key), version: 0 }),
      set: async (ref: { key: string }, v: unknown) => (f.state.set(ref.key, v), { isSet: true, version: 1 }),
    },
    process: {
      // Answers `git rev-parse --git-common-dir`: the main checkout's .git, also from a worktree.
      run: async (_argv: readonly string[], init?: { cwd?: string }) => {
        f.gitCwd.push(init?.cwd)
        if (opts.git instanceof Error) throw opts.git
        if (opts.git === undefined) return { exitCode: 128, stdout: '', stderr: 'not a git repository' }
        return { exitCode: 0, stdout: `${opts.gitOutput ?? `${opts.git}/.git`}\n`, stderr: '' }
      },
    },
    session: { root: async () => opts.root ?? '/start' },
    ui: {
      status: (t: string | undefined) => void f.status.push(t),
      ask: async (question: string, o?: readonly string[] | { options?: readonly string[] }) => {
        f.asked.push({ question, options: (Array.isArray(o) ? o : (o as { options?: readonly string[] })?.options) ?? [] })
        const a = answers.shift()
        if (a === undefined || a instanceof Error) throw a ?? new Error('dismissed')
        return a
      },
    },
    tool: {
      register: async (t: { name: string; description: string }) => (f.tools.push(t), { tool: `mcp__mcp-hold__${t.name}` }),
    },
    mcp: {
      connect: async (server: string) => {
        if (opts.refuse) return { isConnected: false, reason: 'disabled', message: opts.refuse }
        f.connected.push(server)
        return { isConnected: true, server }
      },
    },
  }
  f.$ = $ as unknown as EngineInterface
  return f
}
