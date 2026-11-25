# mcp-hold

A Claude Code mod that holds every MCP server at session start. A held server connects nothing and adds no tool descriptions to the prompt. If a task needs a server, you let it in.

## Why

Each connected MCP server adds its tool descriptions to every request. Servers that a project does not use raise the token count of each session and fill the tool list. Claude Code has no global setting that turns MCP servers off for every project.

## How it works

At session start, Claude Code asks each plugin before it connects an MCP server. The mod answers with a hold for each server. The `/mcp` screen then shows the server as "held by mcp-hold". The status line shows the count, for example `mcp: 3 held`.

The mod holds user servers, project servers and servers that other plugins ship. It does not hold the built-in server `claude-artifacts`. Nobody tested claude.ai account servers yet.

The mod does not read or write `~/.claude.json`. If a project lists a server in `disabledMcpServers`, Claude Code never asks about it, so that server stays off.

## Allow a server

You have two ways to let a held server in.

- Run `/mcp-allow <server>`. With no name, the command lists the held servers. The list shows four servers at most. For another server, type its name in the free-text field.
- Ask Claude for a task that needs the server. Claude sees the names of the held servers and can call the `allow_server` tool.

Both ways open the same dialog with three choices:

- `Always in this project` connects the server and remembers it for this project.
- `This session only` connects the server until the session ends.
- `Cancel` connects nothing.

The built-in `/mcp` enable button does not work on a held server, because the mod holds it again.

## Per-project memory

The mod keeps "always" allows in its plugin store, under the git repository root. One allow covers every worktree of a repository. Outside a git repository, the key is the folder where the session started.

To clear the stored allows for the current project, run `/mcp-forget`. The servers stay connected until the session ends.

## Limits

- If another installed mod answers `AskUserQuestion` dialogs, that mod can answer the scope dialog too.
- If a headless plugin install, sync or reload brings in a server, Claude Code does not ask the mod, so that server connects.
- If Claude Code adds a new built-in MCP server, the mod holds it until its name is added to `BUILT_IN` in `hooks/register.ts`.

## Install

At the prompt of a Claude Code terminal session, run:

```text
/plugin install mcp-hold --marketplace mubarak-j/claude-code-mods
```

## Develop

Run the tests with `claude plugin test plugins/mcp-hold`. Load the mod from its folder with `claude --plugin-dir plugins/mcp-hold`.
