import type { EngineInterface, SessionMessage } from 'claude-code'

// A stand-in for the engine's `$`, holding only the nouns obsidian-knowledge uses.
// Directories are implied by file keys; '/' and every ancestor of a file exist.
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

const err = (code: string, path: string) => Object.assign(new Error(`${code}: ${path}`), { code })
const LIMIT = 4096

export function fake(opts: {
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
} = {}): Fake {
  const f: Fake = {
    files: new Map(Object.entries(opts.files ?? {})),
    store: new Map(Object.entries(opts.store ?? {})),
    state: new Map(),
    logs: [],
    timers: [],
    prompts: [],
    opened: [],
    tools: [],
    commands: [],
    $: undefined as unknown as EngineInterface,
  }
  const links = opts.links ?? {}
  const replies = [...(opts.replies ?? [])]
  const guard = (p: string) => {
    if (opts.denied && (p === opts.denied || p.startsWith(`${opts.denied}/`))) throw err('EPERM', p)
  }
  const isDir = (p: string) => p === '/' || [...f.files.keys()].some((k) => k.startsWith(`${p}/`))
  // Follows a link that is the path or one of its ancestors.
  const resolve = (p: string) => {
    for (const [l, t] of Object.entries(links)) if (p === l || p.startsWith(`${l}/`)) return t + p.slice(l.length)
    return p
  }
  const kids = (p: string) => {
    const pre = p === '/' ? '/' : `${p}/`
    const out = new Map<string, 'file' | 'dir'>()
    for (const k of f.files.keys()) {
      if (!k.startsWith(pre)) continue
      const [name, ...rest] = k.slice(pre.length).split('/')
      out.set(name!, rest.length ? 'dir' : 'file')
    }
    return out
  }
  const $ = {
    fs: {
      read: async (p: string) => (guard(p), f.files.has(p) ? f.files.get(p)! : Promise.reject(err('ENOENT', p))),
      write: async (p: string, text: string) => (guard(p), void f.files.set(p, text)),
      exists: async (p: string) => (guard(p), f.files.has(p) || isDir(p) || p in links),
      list: async (p = '/') => {
        guard(p)
        if (!isDir(p)) throw err('ENOENT', p)
        return [...kids(p)].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false }))
      },
      stat: async (p: string, o?: { resolve: boolean }) => {
        guard(p)
        const isLink = p in links
        if (!f.files.has(p) && !isDir(p) && !isLink) throw err('ENOENT', p)
        const kind = f.files.has(p) ? 'file' : 'dir'
        return { kind, size: f.files.get(p)?.length ?? 0, mtimeMs: 0, isLink, ...(o?.resolve ? { realPath: resolve(p) } : {}) }
      },
    },
    process: {
      run: async (argv: readonly string[]) => {
        const [cmd, a, b] = argv
        if (cmd === 'mkdir') return { exitCode: 0, stdout: '', stderr: '' }
        if (cmd === 'mv' && a && b && f.files.has(a)) {
          f.files.set(b, f.files.get(a)!)
          f.files.delete(a)
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        return { exitCode: 1, stdout: '', stderr: `unsupported: ${argv.join(' ')}` }
      },
    },
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
    env: { get: async (n: string) => (n === 'HOME' ? (opts.home ?? '/home') : undefined) },
    clock: {
      now: async () => opts.now ?? 0,
      after: (ms: number, fn: () => void) => {
        const t = { ms, fn, cancelled: false }
        f.timers.push(t)
        return { cancel: () => void (t.cancelled = true) }
      },
    },
    session: {
      messages: async (a?: { agentId?: string; last?: number; after?: string }) => {
        let list = a?.agentId ? (opts.agents?.[a.agentId] ?? []) : (opts.messages ?? [])
        if (a?.after !== undefined) list = list.slice(list.findIndex((m) => m.uuid === a.after) + 1)
        if (a?.last !== undefined) list = list.slice(-a.last)
        return list.slice(-LIMIT)
      },
      info: async () => ({ transcriptPath: opts.transcriptPath ?? '/t/transcript.jsonl' }),
      surface: async () => (opts.surface === undefined ? 'terminal' : opts.surface),
      id: async () => opts.session ?? 'session-1',
      root: async () => opts.root ?? '/start',
    },
    model: {
      complete: async (r: { prompt: string | readonly { text: string }[] }) => {
        f.prompts.push(typeof r.prompt === 'string' ? r.prompt : r.prompt.map((b) => b.text).join(''))
        const a = replies.shift()
        if (a === undefined || a instanceof Error) return { isAnswered: false, reason: 'api-error' }
        return { isAnswered: true, text: a, usage: {} }
      },
    },
    ui: {
      log: (t: string) => void f.logs.push(t),
      open: async (p: { id: string }) => (f.opened.push(p.id), { isPlaced: true }),
    },
    tool: { register: async (t: { name: string; description: string }) => (f.tools.push(t), { tool: `mcp__obsidian-knowledge__${t.name}` }) },
    command: { register: async (c: { name: string }) => (f.commands.push(c.name), { command: c.name }) },
  }
  f.$ = $ as unknown as EngineInterface
  return f
}
