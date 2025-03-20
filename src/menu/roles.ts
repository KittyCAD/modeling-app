// Does not matter what labels belong to what type. I only split these into some internal types to easily parse
// what labels should belong to what grouping
import { Menu, MenuItemConstructorOptions } from 'electron'
import { Channel } from './channels'

type HeaderLabel =
  | 'File'
  | 'Edit'
  | 'Options'
  | 'Window'
  | 'Utility'
  | 'Help'
  | 'View'

type FileRoleLabel =
  | 'Open project'
  | 'New project'
  | 'Import file from URL'
  | 'Preferences'
  | 'User settings'
  | 'Keybindings'
  | 'Sign out'

type EditRoleLabel =
  | 'Rename project'
  | 'Delete project'
  | 'Change project directory'

type HelpRoleLabel =
  | 'Report a bug'
  | 'Request a feature'
  | 'Ask the community discord'
  | 'Ask the community discourse'
  | 'KCL code samples'
  | 'KCL docs'
  | 'Reset onboarding'
  | 'Release notes'
  | 'Manage account'

type OptionsRoleLabel = 'Report an issue'

// type UtilityRoleLabel =

type ViewRoleLabel = 'Learn more'

// Only export the union of all the internal types since they are all labels
// The internal types are only for readability within the file
export type ZooLabel =
  | HeaderLabel
  | FileRoleLabel
  | EditRoleLabel
  | HelpRoleLabel
  | OptionsRoleLabel
  // | UtilityRoleLabel
  | ViewRoleLabel

// Extend the interface with additional custom properties
export interface ZooMenuItemConstructorOptions
  extends MenuItemConstructorOptions {
  label?: ZooLabel
  submenu?: ZooMenuItemConstructorOptions[] | Menu
}

export type MenuActionIPC = 'onFileNewProject' | 'onFileOpenProject'

export type ChannelAndIPCFunction = {
  channel: Channel
  functionName: MenuActionIPC
}
export const menuActions: ChannelAndIPCFunction[] = [
  { channel: 'File.New project', functionName: 'onFileNewProject' },
  { channel: 'File.Open project', functionName: 'onFileOpenProject' },
] as const
