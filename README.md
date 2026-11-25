# claude-code-mods

A Claude Code plugin marketplace for mods. A mod is a plugin built on the Claude Code function-hooks SDK.

## Mods

| Mod | What it does |
| --- | --- |
| [mcp-hold](plugins/mcp-hold/README.md) | Holds every MCP server at session start. You allow a server for one session or for a project. |

## Install

1. Add the marketplace. At the prompt of a Claude Code terminal session, run:

   ```text
   /plugin marketplace add mubarak-j/claude-code-mods
   ```

2. Install a mod from it, for example `mcp-hold`, then pick a scope:

   ```text
   /plugin install mcp-hold@claude-code-mods
   ```

From a shell, run the same two steps:

```bash
claude plugin marketplace add mubarak-j/claude-code-mods
claude plugin install mcp-hold@claude-code-mods
```

## Develop a mod

Each mod lives in `plugins/<name>/`. To install the pinned Claude Code CLI, run `npm ci`. To check and test every mod with it, run `npm run validate` and `npm test`. CI runs the same commands on each pull request. To load a mod from its folder, run `claude --plugin-dir plugins/<name>`. To run its tests, run `claude plugin test plugins/<name>`. To check its manifest and hooks module, run `claude plugin validate plugins/<name>`.
