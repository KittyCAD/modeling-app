// Does not matter what labels belong to what type. I only split these into some internal types to easily parse
// what labels should belong to what grouping
import { Menu, MenuItemConstructorOptions } from 'electron'

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
  | 'Theme'
  | 'Theme color'

type EditRoleLabel =
  | 'Rename project'
  | 'Delete project'
  | 'Change project directory'
  | 'Speech'

type HelpRoleLabel =
  | 'Refresh and report a bug'
  | 'Request a feature'
  | 'Ask the community discord'
  | 'Ask the community discourse'
  | 'KCL code samples'
  | 'KCL docs'
  | 'Reset onboarding'
  | 'Show release notes'
  | 'Manage account'
  | 'Get started with Text-to-CAD'
  | 'Show all commands'

type ViewRoleLabel = 'Command Palette...' | 'Appearance'

// Only export the union of all the internal types since they are all labels
// The internal types are only for readability within the file
export type ZooLabel =
  | HeaderLabel
  | FileRoleLabel
  | EditRoleLabel
  | HelpRoleLabel
  | ViewRoleLabel

// Extend the interface with additional custom properties
export interface ZooMenuItemConstructorOptions
  extends MenuItemConstructorOptions {
  label?: ZooLabel
  submenu?: ZooMenuItemConstructorOptions[] | Menu
}
