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
  | 'Export current part'
  | 'Create new file'
  | 'Create new folder'
  | 'Share current part (via Zoo link)'
  | 'Project settings'
  | 'Load a sample model'

type EditRoleLabel =
  | 'Rename project'
  | 'Delete project'
  | 'Change project directory'
  | 'Speech'
  | 'Edit parameter'
  | 'Modify with Zoo Text-To-CAD'

type HelpRoleLabel =
  | 'Report a bug'
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

type ViewRoleLabel =
  | 'Command Palette...'
  | 'Appearance'
  | 'Panes'
  | 'Feature tree'
  | 'KCL code'
  | 'Project files'
  | 'Variables'
  | 'Logs'
  | 'Debug'
  | 'Standard views'

type DesignRoleLabel =
  | 'Design'
  | 'Create a parameter'
  | 'Create with Zoo Text-To-CAD'
  | 'Start sketch'

// Only export the union of all the internal types since they are all labels
// The internal types are only for readability within the file
export type ZooLabel =
  | HeaderLabel
  | FileRoleLabel
  | EditRoleLabel
  | HelpRoleLabel
  | ViewRoleLabel
  | DesignRoleLabel

// Extend the interface with additional custom properties
export interface ZooMenuItemConstructorOptions
  extends MenuItemConstructorOptions {
  label?: ZooLabel
  submenu?: ZooMenuItemConstructorOptions[] | Menu
}
