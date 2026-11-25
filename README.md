# claude-code-mods

A Claude Code plugin marketplace for mods. A mod is a plugin built on the Claude Code function-hooks SDK.

## Mods

| Mod | What it does |
| --- | --- |
| [mcp-hold](plugins/mcp-hold/README.md) | Holds every MCP server at session start. You allow a server for one session or for a project. |

## Install

At the prompt of a Claude Code terminal session, run:

```text
/plugin install mcp-hold --marketplace mubarak-j/claude-code-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell, run:

```bash
claude plugin install mcp-hold --marketplace mubarak-j/claude-code-mods
```

## Develop a mod

Each mod lives in `plugins/<name>/`. To load a mod from its folder, run `claude --plugin-dir plugins/<name>`. To run its tests, run `claude plugin test plugins/<name>`. To check its manifest and hooks module, run `claude plugin validate plugins/<name>`.
