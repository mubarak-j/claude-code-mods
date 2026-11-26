import type { EngineInterface, SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'

type $ = EngineInterface

export type Part = { messages: SessionMessage[]; agents: Record<string, SessionMessage[]> }

export const CHUNK_CHARS = 300_000

// Reads on from `after` in pages (one read holds at most 4096 rows). 'gone' when the cursor is no longer in the transcript.
export async function readSince($: $, after: string | null): Promise<{ messages: SessionMessage[]; last: string | null } | 'gone'> {
  if (after === null) {
    const r = await $.session.messages()
    if ('deny' in r) return { messages: [], last: null }
    return { messages: r, last: r.at(-1)?.uuid ?? null }
  }
  const messages: SessionMessage[] = []
  let cursor = after
  for (;;) {
    const r = await $.session.messages({ after: cursor })
    if ('deny' in r) return messages.length || cursor !== after ? { messages, last: cursor } : 'gone'
    const next = r.at(-1)?.uuid
    if (!next) {
      messages.push(...r)
      break
    }
    messages.push(...r)
    cursor = next
  }
  return { messages, last: cursor }
}

export async function withAgents($: $, messages: SessionMessage[]): Promise<Part> {
  const agents: Part['agents'] = {}
  for (const m of messages)
    for (const u of m.toolUses) {
      if (!u.agentId || agents[u.agentId]) continue
      const r = await $.session.messages({ agentId: u.agentId })
      if (!('deny' in r)) agents[u.agentId] = r
    }
  return { messages, agents }
}

export function afterUuid(messages: SessionMessage[], uuid: string | null): SessionMessage[] {
  const i = uuid === null ? -1 : messages.findIndex((m) => m.uuid === uuid)
  return messages.slice(i + 1)
}

export const hasToolCalls = (p: Part): boolean => p.messages.some((m) => m.toolUses.length > 0)

const agentIds = (ms: SessionMessage[]) => ms.flatMap((m) => m.toolUses.flatMap((u) => (u.agentId ? [u.agentId] : [])))

const isPrompt = (m: SessionMessage) => m.role === 'user' && m.text !== '' && !(m.toolResults ?? []).length

const size = (p: Part) => renderPart(p).length

export function splitTurns(p: Part, maxChars: number): Part[] {
  const turns: SessionMessage[][] = []
  for (const m of p.messages) {
    if (isPrompt(m) || !turns.length) turns.push([m])
    else turns.at(-1)!.push(m)
  }
  const mk = (ms: SessionMessage[]): Part => ({
    messages: ms,
    agents: Object.fromEntries(agentIds(ms).flatMap((id) => (p.agents[id] ? [[id, p.agents[id]!]] : []))),
  })
  const parts: Part[] = []
  let cur: SessionMessage[] = []
  for (const t of turns) {
    if (cur.length && size(mk([...cur, ...t])) > maxChars) {
      parts.push(mk(cur))
      cur = []
    }
    cur.push(...t)
  }
  if (cur.length) parts.push(mk(cur))
  return parts
}

const renderMsgs = (ms: SessionMessage[]) =>
  ms
    .map((m) => {
      const lines = [`${m.role}: ${m.text}`]
      for (const u of m.toolUses) {
        lines.push(`${u.tool}(${JSON.stringify(u.input)})`)
        if (u.text) lines.push(u.text)
      }
      for (const r of m.toolResults ?? []) lines.push(r.text)
      return lines.join('\n')
    })
    .join('\n\n')

export function renderPart(p: Part): string {
  const out = [renderMsgs(p.messages)]
  for (const [id, ms] of Object.entries(p.agents)) out.push(`agent ${id}:\n${renderMsgs(ms)}`)
  return out.join('\n\n')
}

export const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function corpus(p: Part): string {
  const texts: string[] = []
  for (const ms of [p.messages, ...Object.values(p.agents)])
    for (const m of ms) {
      for (const u of m.toolUses) if (u.text) texts.push(normalize(u.text))
      for (const r of m.toolResults ?? []) texts.push(normalize(r.text))
    }
  return texts.join('\n')
}

type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }

const blockText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: Block) => (b.type === 'text' ? (b.text ?? '') : '')).join('') : ''

export function fromJsonl(text: string): SessionMessage[] {
  const out: SessionMessage[] = []
  for (const line of text.split('\n')) {
    let row: { type?: string; uuid?: string; message?: { content?: unknown } }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type !== 'user' && row.type !== 'assistant') continue
    const c = row.message?.content
    const blocks: Block[] = Array.isArray(c) ? c : []
    const toolUses: ToolUseSummary[] = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ tool_use_id: b.id ?? '', tool: b.name ?? '', input: b.input }) as ToolUseSummary)
    const toolResults: ToolResultSummary[] = blocks
      .filter((b) => b.type === 'tool_result')
      .map((b) => ({ tool_use_id: b.tool_use_id ?? '', text: blockText(b.content), isError: b.is_error === true }) as ToolResultSummary)
    out.push({
      role: row.type,
      text: typeof c === 'string' ? c : blocks.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join(''),
      toolUses,
      ...(toolResults.length ? { toolResults } : {}),
      ...(row.uuid ? { uuid: row.uuid } : {}),
    })
  }
  return out
}
