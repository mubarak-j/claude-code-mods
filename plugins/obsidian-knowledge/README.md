# obsidian-knowledge

A Claude Code mod that drafts Obsidian notes from what Claude learns in your sessions. You approve each note before it reaches your vault. Later sessions can search the vault.

## Why

Sessions teach lasting facts about the systems you work on. Notes in session scratchpads vanish when the folder is cleared. In a new session, Claude can repeat an old note as fact without a new check.

The mod keeps only proven facts. A proven fact is one that command output or a test result in the session backs. The mod files each fact under its subject, not under the repository of the session.

## How it works

The mod drafts notes at four points:

- Before each compaction of the conversation.
- After 15 minutes with no new turn.
- When you run `/vault-capture`.
- At session start, for earlier sessions of the same project that have messages the mod did not read yet.

Each draft is one Sonnet call. Its cost shows in `/cost`. If the new part of a session holds no tool calls, the mod makes no call.

The mod drops an operation if its evidence quote is not in a tool result. It masks secret-shaped strings before it queues a draft.

Pending drafts are JSON files in a hidden `.obsidian-knowledge/` folder inside the mod folder. The Claude Code plugin store lost writes across processes, so the mod does not use it.

## Review

Run `/vault-review` to open the review pane. For each draft, you can approve, edit or drop it. If you drop a draft, the mod does not propose it again.

Before it writes, the mod compares the file with its state at draft time. If you edited the note in Obsidian, the mod drafts the update again and puts it back in the queue. It never overwrites your text.

Each concept note is one Markdown file with front matter, a body, an evidence list and `[[links]]`. Each folder has a hub note named after the folder. If a new note has the same title as its own folder, the mod adds " overview" to the title. If a title matches one of your notes elsewhere in the vault, the mod adds " (Claude)".

## Folder growth

If a folder holds more than 12 notes, the mod proposes subfolders. If three or more sibling folders share a subject, it proposes a parent folder. The tree never goes deeper than three levels. Each proposal is one item in the review queue.

Moves use `mv -n`, so a move never overwrites a file. A move never changes a title, so links keep working. If you drop a folder proposal, the mod does not propose it again.

## Search

The mod adds a `vault_search` tool. Its description lists the topics of the first two folder levels. The tool takes a query and returns matching notes with title, path, excerpt, dates and sources. Claude treats each result as a lead to re-check, not as a settled fact.

## Options

Set these in `/config`.

- `vaultFolder` is the folder the mod reads and writes. The default is `ibotta-work/Claude` in an iCloud Obsidian vault.
- `exclude` is a list of project folders. If a session starts under one, the mod captures nothing. Search still works.

## Commands

- `/vault-review` opens the review pane.
- `/vault-capture` drafts notes from the current session now.

## macOS permission

If the vault is in iCloud Drive, your terminal needs access to it. Open System Settings, then Privacy & Security, then Files & Folders. Allow iCloud Drive for your terminal app. If access is missing, the mod shows one notice and keeps drafts in the queue.

## Limits

- Catch-up skips subagent transcripts.
- Code Mode results can miss the evidence check.
- The first read of a very long session sees only its newest 4096 messages.
- Older transcripts are not imported.
- If a session has no screen, as in `claude -p`, the mod captures nothing.

## Install

1. Add the marketplace. At the prompt of a Claude Code terminal session, run:

   ```text
   /plugin marketplace add mubarak-j/claude-code-mods
   ```

2. Install the mod, then pick a scope:

   ```text
   /plugin install obsidian-knowledge@claude-code-mods
   ```

## Develop

Run the tests with `claude plugin test plugins/obsidian-knowledge`. Load the mod from its folder with `claude --plugin-dir plugins/obsidian-knowledge`.
