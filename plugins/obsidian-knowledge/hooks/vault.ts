import type { EngineInterface } from 'claude-code'

type E = EngineInterface
export type Vault = { root: string; vaultRoot: string }
export type NoteFile = { path: string; title: string; folder: string; isHub: boolean }

const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
const join = (a: string, b: string) => (a === '/' ? `/${b}` : `${a}/${b}`)
const missing = (e: unknown) => (e as { code?: string })?.code === 'ENOENT'

// Real path of `p`, or of its nearest existing ancestor plus the rest.
async function realOf($: E, p: string): Promise<string> {
  let cur = p
  let rest = ''
  for (;;) {
    try {
      const s = await $.fs.stat(cur, { resolve: true })
      const real = s.realPath ?? cur
      return rest ? join(real, rest) : real
    } catch (e) {
      if (!missing(e) || cur === '/') throw e
      rest = rest ? `${cur.slice(cur.lastIndexOf('/') + 1)}/${rest}` : cur.slice(cur.lastIndexOf('/') + 1)
      cur = parent(cur)
    }
  }
}

export async function openVault($: E, folder: string): Promise<Vault> {
  const home = (await $.env.get('HOME')) ?? ''
  const root = await realOf($, folder.startsWith('~') ? home + folder.slice(1) : folder)
  for (let a = parent(root); ; a = parent(a)) {
    if (await $.fs.exists(join(a, '.obsidian'))) return { root, vaultRoot: a }
    if (a === '/') return { root, vaultRoot: parent(root) }
  }
}

export function safeRel(rel: string): string | undefined {
  if (rel.startsWith('/') || rel.includes('\\')) return undefined
  return rel.split('/').every((s) => s !== '' && s !== '..') ? rel : undefined
}

export async function insidePath($: E, v: Vault, rel: string): Promise<string | undefined> {
  if (safeRel(rel) === undefined) return undefined
  const abs = join(v.root, rel)
  const real = await realOf($, abs)
  return real === v.root || real.startsWith(`${v.root}/`) ? abs : undefined
}

// Markdown files under `dir`, as paths relative to it. Skips links and `skip` names.
async function walk($: E, dir: string, skip: (abs: string, name: string) => boolean, rel = ''): Promise<string[]> {
  let entries
  try {
    entries = await $.fs.list(rel ? join(dir, rel) : dir)
  } catch (e) {
    if (missing(e)) return []
    throw e
  }
  const out: string[] = []
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isLink || skip(join(dir, r), e.name)) continue
    if (e.kind === 'dir') out.push(...(await walk($, dir, skip, r)))
    else if (e.kind === 'file' && e.name.endsWith('.md')) out.push(r)
  }
  return out
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1, -3)

export async function listNotes($: E, v: Vault): Promise<NoteFile[]> {
  return (await walk($, v.root, () => false)).map((path) => {
    const title = base(path)
    const folder = path.includes('/') ? parent(path) : ''
    const last = folder.slice(folder.lastIndexOf('/') + 1)
    return { path, title, folder, isHub: folder !== '' && (title === last || title === `${last} (Claude)`) }
  })
}

export async function outsideTitles($: E, v: Vault): Promise<Set<string>> {
  const files = await walk($, v.vaultRoot, (abs, name) => abs === v.root || name === '.obsidian' || name === '.trash')
  return new Set(files.map((p) => base(p).toLowerCase()))
}

export const fileTitle = (raw: string) => raw.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim()

export const uniqueTitle = (title: string, taken: Set<string>) => (taken.has(title.toLowerCase()) ? `${title} (Claude)` : title)

// FNV-1a, 32 bit.
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function run($: E, argv: string[]) {
  const r = await $.process.run(argv)
  if (r.exitCode !== 0) throw new Error(`${argv[0]} failed: ${r.stderr}`)
}

export async function moveFile($: E, v: Vault, from: string, to: string): Promise<void> {
  const dest = join(v.root, to)
  await run($, ['mkdir', '-p', parent(dest)])
  await run($, ['mv', join(v.root, from), dest])
}

export const folders = (notes: NoteFile[]) => [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort()
