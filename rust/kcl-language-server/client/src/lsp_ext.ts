import * as lc from 'vscode-languageclient'

export type CommandLink = {
  /**
   * A tooltip for the command, when represented in the UI.
   */
  tooltip?: string
} & lc.Command
export type CommandLinkGroup = {
  title?: string
  commands: CommandLink[]
}

// experimental extensions

export const serverStatus = new lc.NotificationType<ServerStatusParams>(
  'experimental/serverStatus'
)
export type ServerStatusParams = {
  health: 'ok' | 'warning' | 'error'
  quiescent: boolean
  message?: string
}
