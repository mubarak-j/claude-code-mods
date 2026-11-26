# obsidian-knowledge

A Claude Code mod that drafts Obsidian notes from what Claude learns in your sessions. You approve each note before it reaches your vault. Later sessions can search the vault.

## Why

Sessions teach lasting facts about the systems you work on. Notes in session scratchpads under `/private/tmp` vanish after a reboot. In a new session, Claude can repeat an old note as fact without a new check.

The mod keeps those facts in your vault, under their subject. A fact about Argo CD lands under Argo CD, whatever repository the session ran in. The notes serve two readers. You read them to learn or review a subject. Future Claude sessions search them for knowledge a task needs. Notes link to each other, so the Obsidian graph shows how subjects connect.

## What goes in

The mod keeps only proven facts. A proven fact is one that a tool result in the session backs. These tool results count as evidence:

- command output and test results,
- results of MCP tools, such as Datadog queries,
- file reads,
- web pages,
- tool results inside a subagent.

A statement in chat is not evidence, from you or from Claude. If the only evidence is a web page, the note says that the docs state the fact. Docs prove what the docs say, not what the system does.

Notes describe how systems behave, not the steps Claude took. If a script ran successfully and is general enough to reuse, a note can hold it, with the situations to use it in. One-off commands stay out.

These stay out of the vault:

- session logs and lists of steps,
- beliefs, guesses and hypotheses,
- preferences and feedback about how Claude works, which stay in Claude Code's auto-memory.

## How it works

The mod drafts notes at four points:

- Before a compaction that you start, that Claude Code starts at its limit, or that a plugin starts. The mod skips compactions computed ahead of time and compactions of subagents.
- After 15 minutes with no new turn.
- When you run `/vault-capture`.
- At session start, for earlier sessions of the same project that have messages the mod did not read yet. Catch-up skips a session whose transcript changed in the last 20 minutes, because that session can still be running.

The mod keeps a cursor for each session, so each checkpoint reads only the messages after the last one it drafted. If the new part of a session holds no tool calls, the mod makes no model call.

Each draft is one Sonnet call through the session's own API client. Its cost shows in `/cost`, and the mod has no spending cap. A failed call keeps the cursor in place, so the next checkpoint tries the same part again.

Sonnet returns a list of operations: a new note, or an update of an existing note. The reply is untrusted, so the mod checks each operation before it queues it:

- Each evidence quote must appear word for word in a tool result of that part. A quote under 8 characters does not count.
- A target path must stay inside the mod folder.
- A new note can go into an existing folder or create one new top-level folder.

The mod then masks text that looks like a secret, such as API tokens, keys and passwords. The vault syncs to iCloud, so a missed token leaves the machine.

Pending drafts are JSON files in a hidden `.obsidian-knowledge/` folder inside the mod folder, shared by every session and worktree. In a test with two processes writing at once, the plugin store lost writes, so drafts do not use it. Dropped facts and capture cursors stay in the plugin store.

## Review

If drafts wait at session start, the mod shows one dim line, for example `5 vault drafts pending, /vault-review`. It shows no status line entry and no toasts. Drafts never expire.

Run `/vault-review` to open the review pane. For each draft, you can approve, edit or drop it, or go to the next one. If several drafts target one note, the mod folds them into one item. If you drop a draft, the mod does not propose its fact again.

Before it writes an update, the mod compares the file with its state at draft time. If you edited the note in Obsidian, the mod drafts the update again against your text and puts it back in the queue. It never overwrites your text, and it never writes a new note over an existing file.

The mod reads and writes files only inside its own folder. Outside it, the mod only lists file names, to avoid title clashes.

## Note format

Each concept note is one Markdown file, named by its title:

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

- Bash: "<quoted output>" (2026-11-03)

## Related

[[ApplicationSet controller]], [[Redis outage causes sync loops]]
```

Each folder has a hub note named after the folder, with one link for each note and subfolder. The mod writes these links between two marker comments, and keeps any text you add outside them.

Obsidian resolves a `[[Title]]` link across the whole vault, so titles must be unique there. If a title matches one of your notes elsewhere in the vault, the mod adds " (Claude)". If a new note has the same title as its own folder, the mod adds " overview", so it does not clash with the hub.

## Folder growth

If a folder holds more than 12 notes, the mod proposes subfolders. If a note creates a new top-level folder, the mod checks the top-level folders. If three or more share a subject, it proposes a parent folder for them. The tree never goes deeper than three levels. Each proposal is one item in the review queue, and each one costs a Sonnet call.

Moves use `mv -n`, so a move never overwrites a file. A move never changes a title, and links use titles only, so links keep working. If you drop a folder proposal, the mod does not propose it again.

## Search

The mod adds a `vault_search` tool. Its description lists the topics of the first two folder levels, built once at session start so the prompt cache stays valid. The tool takes a query and returns matching notes with title, path, excerpt, dates and sources. Claude treats each result as a lead to re-check, not as a settled fact.

The topic list goes in the tool description, not in the system prompt, because a managed plugin can skip system prompt hooks.

## Options

Set these in `/config`.

- `vaultFolder` is the folder the mod owns. The default is `ibotta-work/Claude` in an iCloud Obsidian vault.
- `exclude` is a list of project folders. If a session starts under one, the mod captures nothing. Search still works.

## Commands

- `/vault-review` opens the review pane.
- `/vault-capture` drafts notes from the current session now.

## macOS permission

If the vault is in iCloud Drive, your terminal needs access to it. macOS decides this for the terminal app that started Claude Code, and the mod runs inside that process. Open System Settings, then Privacy & Security, then Files & Folders. Allow iCloud Drive for your terminal app. If access is missing, the mod shows one notice and keeps drafts in the queue.

## Design choices

- The mod is self-contained. It writes plain Markdown files and does not need Obsidian running.
- Links use titles only, so the mod can move notes between folders without the Obsidian command line.
- Capture runs during the session, because all `session.end` hooks share one short time budget.
- Sonnet drafts the notes, because the evidence filter must tell a proven fact from a belief in long transcripts.

Related projects took other paths. [alluvium](https://github.com/tespera/alluvium) merges sessions into topic pages without folders. [superbrain](https://github.com/m3talux/superbrain) files notes into a fixed set of folders through a background `claude -p`. [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian) organizes notes well, but it saves nothing on its own.

## Limits

- Catch-up skips subagent transcripts.
- Code Mode results can miss the evidence check.
- The first read of a very long session sees only its newest 4096 messages.
- Older transcripts are not imported.
- If a session has no screen, as in `claude -p`, the mod captures nothing.
- If a folder move fails partway, the item stays in the queue, and you must drop it.
- Dropped facts and cursors live in the plugin store. If two sessions write at once, the store can lose one write.

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
