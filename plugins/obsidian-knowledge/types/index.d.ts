export type Evidence = { quote: string; source: string }
export type NewOp = { kind: 'new'; folder: string; title: string; body: string; tags: string[]; related: string[]; evidence: Evidence[] }
export type UpdateOp = { kind: 'update'; path: string; addition: string; related: string[]; evidence: Evidence[]; baseHash: string }
export type DraftOp = NewOp | UpdateOp
export type Move = { from: string; to: string }
export type DraftItem = { id: string; kind: 'new' | 'update'; target: string; ops: DraftOp[]; sources: string[] }
export type MoveItem = { id: string; kind: 'split' | 'parent'; folder: string; moves: Move[] }
export type QueueItem = DraftItem | MoveItem
export type Cursor = { uuid: string | null; project: string; transcriptPath: string; seen: number }
export type Review = { index: number; editing: boolean; rev: number }

declare module 'claude-code' {
  interface PluginState {
    'obsidian-knowledge': { review: Shaped<Review> }
  }
}
