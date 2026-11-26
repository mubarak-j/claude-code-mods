# obsidian-knowledge design

Date: 2026-11-25. Status: draft for review.

## Intent

Claude Code sessions teach durable facts about the systems you work on, and those facts get lost. Notes sat in session scratchpads under `/private/tmp`, and a reboot clears that folder. In another session, Claude repeated an old note as fact without a new check.

The mod keeps the proven knowledge from each session in your Obsidian vault. It files each fact under its subject, such as Argo CD, not under the repository the session ran in. It grows the topic folders by itself and links the notes, so the Obsidian graph shows how subjects connect.

The notes serve two readers. You read them in Obsidian to learn or review a subject. Future Claude sessions search them for knowledge that a task needs.

## Goals

- Keep facts about how systems behave. An example is how the ApplicationSet controller treats an application during a RollingSync.
- Keep only proven facts. A proven fact is one that command output or a test result in the session backs.
- File each fact under its subject, and grow the folder tree as notes build up.
- Let you approve every change before it reaches the vault.
- Let future sessions search the vault and treat each result as a lead to re-check.

## Non-goals

- A session log. The notes never list the steps Claude took.
- Beliefs, guesses and hypotheses. None of these go into the vault, the useful ones included.
- Preferences and feedback about how Claude works. These stay in Claude Code's auto-memory.
- Changes to your own notes. The mod reads and writes files only inside its own folder. Outside it, the mod lists file names to avoid title clashes.
- Sync. iCloud already syncs the vault to your other devices.

## Anti-goals

The mod can run and still fail. It fails in these cases:

- The vault fills with one-off scripts and commands.
- A wrong fact lands in the vault without your approval.
- The mod overwrites an edit you made in Obsidian.
- Notes read like a diary of steps instead of knowledge.
- The review queue grows so long that you stop reviewing.

## Constraints

- The default mod folder is `ibotta-work/Claude/` under `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/`. The path is a plugin option.
- Until you grant access, macOS blocks iTerm2 and every process it starts from that iCloud folder. The mod runs inside the Claude Code process, so it needs the same grant.
- All `session.end` hooks share one short time budget. The mod cannot draft notes at exit.
- The mod uses the function-hooks SDK of Claude Code 2.1.329, the version that `package.json` pins. The latest release is 2.1.332. Its changelog changes none of the SDK calls this design uses.
- Each draft is one Sonnet call through `$.model.complete`. Its cost shows in `/cost`.

## Approaches

1. Self-contained mod. One TypeScript mod, built like `mcp-hold`, does capture, drafting, the review queue, file writes and search. Links use note titles only, so a move breaks no link. It works without Obsidian running. The mod must handle merges, title collisions and folder proposals itself.
2. Mod with the Obsidian command line. The same mod writes, moves and searches through the official Obsidian CLI, which fixes links and indexes. Obsidian must run on the same machine, and you install one more tool.
3. Build on alluvium. The mod reuses the Python distiller and merge logic of alluvium and adds a review pane. This mixes stacks, and background `claude -p` on subscription plans has a monthly credit cap. alluvium also has no evidence filter and no folder growth.

You picked approach 1. It matches how this repo builds mods and needs nothing else running. Title-only links remove the main reason for approach 2.

## Design

### Options

The mod has two plugin options (`userConfig`):

- `vaultFolder`: the folder the mod owns. The default is the iCloud path above.
- `exclude`: a list of folders. If a session starts under one of them, the mod captures nothing in that session. Search still works there.

These values are constants in the code, not options: the idle wait (15 minutes), the split size (12 notes), the depth limit (3 levels) and the model (Sonnet).

### Note format

Each concept note is one Markdown file, named by its title. Obsidian resolves a `[[Title]]` link across the whole vault, so titles must be unique across all of `ibotta-work`. Before the mod creates a title, it lists the file names in the vault. If the title clashes with one of your notes, the mod adds " (Claude)" to it. This rule also covers hub notes.

```markdown
---
topic: Kubernetes/ArgoCD/ApplicationSets
learned: 2026-11-03
updated: 2026-11-18
sources:
  - 2026-11-03 session 3a196d38
  - 2026-11-18 session 62e43b86
tags: [argocd, applicationset]
---

# RollingSync OutOfSync behavior

What the system does, and under which conditions, in plain sentences.

## Evidence

- On nancy, `argocd app get <app>` showed ... (2026-11-03)

## Related

[[ApplicationSet controller]], [[Redis outage causes sync loops]]
```

If a script ran successfully in the session and is general enough to reuse, a note can hold it. That note says what the script does and in which situations to use it. One-off commands stay out.

Each folder has a hub note named after the folder, for example `ArgoCD.md`. The hub holds one linked line for each note and each subfolder. The mod writes these lines between two marker comments. If you add text outside the markers, the mod keeps it.

### Capture

The mod drafts notes at four checkpoints:

1. Before each compaction, through `session.compact`.
2. After 15 minutes with no new turn. A `$.clock.after` timer restarts at each `turn.complete`.
3. When you run `/vault-capture`.
4. At session start, for earlier sessions of the same project that ended with messages past their cursor.

The first checkpoint acts only on the `manual`, `auto` and `plugin` triggers of the main conversation. It ignores the `precompute` trigger, because that trigger runs ahead of time and also serves idle compaction. It ignores compactions that carry an `agentId`, because those belong to a subagent.

A compaction checkpoint drafts from `e.messages`, the transcript that is about to be compacted. The hook never waits for the draft. It starts the draft with `$.clock.after` and returns `next(e)` at once, so compaction is never delayed. If the dispatch of the hook is abandoned, a model call made inside the hook ends as `aborted`. That is a second reason to draft from a timer.

The store keeps a cursor for each session: the `uuid` of the last transcript message the mod drafted from. Each checkpoint reads only the messages after the cursor, with `$.session.messages({ after })`. One read returns at most 4096 messages, so the mod reads again from the last `uuid` until no messages remain. After a compaction, the old `uuid` can be gone, and the read answers `deny`. The compaction checkpoint already drafted that part, so the mod then moves the cursor to the newest message. If the model call fails, the cursor stays, and the next checkpoint tries again.

Subagent transcripts come from `$.session.messages({ agentId })`, with the `agentId` that each Agent tool use carries.

If the new part holds no tool calls, the checkpoint makes no model call. If the new part is too large for one call, the mod splits it at turn boundaries into several calls. It never cuts tool output, because the cut part can hold the evidence. Drafting has no spending cap, and its cost shows in `/cost`.

The fourth checkpoint covers only sessions the mod saw while they ran. The mod does not import older transcripts. If `$.session.surface()` answers `null`, nothing draws the session, as in headless `claude -p`, and the mod captures nothing.

### Drafting

Each checkpoint makes one Sonnet call. The call sets `maxTokens` itself, because the default of 1024 tokens is too small for a list of notes. The fixed rules go first in the prompt and carry a cache mark, so repeated calls cost less. The prompt holds three inputs:

- the new part of the transcript, with each tool call and its output, plus the transcripts of the subagents that ran in that part,
- the current topic tree,
- the existing notes closest to the new part, found by a text search for its key terms.

The prompt sets these rules:

- If a tool result in the transcript backs a fact, keep it and quote that evidence. Drop every other fact.
- These tool results count as evidence: command output and test results, MCP tool results such as Datadog queries, file reads, and web pages. Results from inside a subagent count too.
- A statement in chat, from you or from Claude, is not evidence.
- If the only evidence is a web page, the note says that the docs state the fact. Docs prove what the docs say, not what the system does.
- Describe how systems behave. Leave out the steps taken.
- If a script ran successfully and is general enough to reuse, keep it. Drop every other script.
- Leave out preferences and feedback about how Claude works.
- Update an existing note before you create a new one.
- If the part teaches nothing durable, return an empty list.

The reply is JSON: a list of operations. Each operation is `new` or `update` and holds the target path, title, body and evidence. For an update, the mod adds the hash of the target file at draft time.

A `new` operation puts its note in an existing folder. If no folder fits, the operation can create one new top-level folder. Deeper folders come only from split and parent proposals.

The transcript holds tool output from outside sources, so the reply is untrusted. The mod checks each operation against the schema and drops any that fail. It also drops any target path outside the mod folder, including paths with `..` or symbolic links.

Each evidence quote must appear word for word in a tool result of that part, after whitespace is normalized. If a quote does not appear, the mod drops that operation. The fact itself can be in the model's own words.

Before the mod queues an operation, it masks text that looks like a secret, such as API tokens, keys and passwords. The vault syncs to iCloud, so a missed token leaves the machine.

### Review queue

Drafts wait in the mod's store, keyed by the mod folder. All sessions and worktrees share one queue.

`/vault-review` opens a pane beside the chat. For each item, the pane shows the kind (new, update, move or split), the target path, and the text or the diff. You approve, edit or drop the item, or skip to the next one.

If several pending drafts target one note, the mod folds them into one item. Approving one draft therefore never sends another draft back for a new model call.

If you drop a draft, the mod remembers its fact and does not propose it again.

If drafts are pending at session start, the mod writes one dim line with `$.ui.log`, for example "5 vault drafts pending, /vault-review". That line never goes to the model. The mod shows no status line entry and no toasts. Drafts never expire.

### Writing

When you approve an item, the mod writes the file with `$.fs` and updates the hub notes the change touches.

Before an update, the mod compares the current hash of the file with the hash from draft time. If they differ, you edited the note in Obsidian. The mod then drafts the update again against your current text and puts it back in the queue. It never overwrites your text.

### Folder growth

After each approval, the mod counts the notes in each folder. If a folder holds more than 12 notes, a Sonnet call proposes subfolders and moves. If three or more sibling folders share one subject, the call proposes a parent folder. The tree never goes deeper than three levels below the mod folder.

Each proposal enters the review queue as one item, with its full list of moves. A move never changes a title, so every link keeps working. `$.fs` has no rename, so the mod moves files with `$.process.run` and `mv`.

### Read-back

The mod registers a `vault_search` tool at session start. Its description lists the topic names of the first two levels on one line. The list goes in the tool description, not in a `prompt.compose` section, because `mcp-hold` found that a managed plugin can skip `prompt.compose` hooks. The mod builds the list at session start only, so the prompt cache stays valid during the session.

The tool takes a query and returns the matching notes. Each result holds the title, path, a short excerpt, the `learned` and `updated` dates, and the sources. The tool description tells Claude that results are leads to re-check, not settled facts. The search is a case-insensitive text search over the mod folder.

### Errors

- If the mod folder is not readable or not writable, the mod shows one notice that names the macOS permission. Drafts stay in the queue.
- If a model call fails, the cursor stays, and the next checkpoint tries again.
- A failure in any hook never blocks the session.

## Left to the builder

- How the pane edits a draft. The `Input` element takes `rows` of 2 or more for text of several lines.
- How the mod reads the transcript of an ended session at the next session start. `$.session` reads only the current session, so the mod probably reads the transcript file from disk.
- The `maxTokens` value for drafting calls. One reply holds at most 64000 tokens.
- How the mod finds the existing notes closest to a transcript part.
- The exact drafting prompt and the JSON schema of its reply.
- The hash function and the layout of the store. `$.store` is one JSON file with a 4 MiB limit, shared by the queue, the cursors and the dropped facts.
- The patterns that mask secrets.

Three risks need attention early in the build:

- The types do not say whether `$.store` stays consistent while several Claude Code processes write to it. If it does not, the shared queue needs another home, for example files under the mod folder.
- The transcript file on disk is not part of the SDK. If a release changes its format, the fourth checkpoint breaks. A test against a real transcript file of the pinned version catches this.
- Code Mode, an experimental opt-in, lets Claude call tools from a JavaScript script. Your settings do not turn it on. If you turn it on later, tool results inside a script can lack the shape the evidence check expects.

## Testing

Tests run with `claude plugin test`, with a fake engine like the one in `plugins/mcp-hold/tests/fake.ts`. They cover at least these cases:

- A target path outside the mod folder is dropped.
- If the target file changed after drafting, the update goes back to the queue and the file stays as it was.
- A session under an excluded folder produces no drafts.
- If the model call fails, the cursor stays.
- A folder with 13 notes produces one split proposal.
- A move keeps every title, and links still resolve.
- An evidence quote that is not in any tool result drops its operation.
- A title that clashes with a note outside the mod folder gets " (Claude)".
- Two pending drafts for one note fold into one item.
- A secret-shaped string in evidence is masked before it is queued.
- A `precompute` compaction and a subagent compaction start no draft.
- A compaction hook returns before its draft ends.
- After a compaction, a cursor whose `uuid` is gone moves to the newest message.
