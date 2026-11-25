export type ServerNames = string[]

declare module 'claude-code' {
  interface PluginState {
    'mcp-hold': { held: ServerNames; sessionAllowed: ServerNames }
  }
}
