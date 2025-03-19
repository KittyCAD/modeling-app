// Does not matter what labels belong to what type. I only split these into some internal types to easily parse
// what labels should belong to what grouping
import { Menu, MenuItemConstructorOptions } from 'electron'

type HelpRoleLabel =
  | 'Report a bug'
  | 'Request a feature'
  | 'Ask the community discord'
  | 'Ask the community discourse'
  | 'KCL code samples'
  | 'KCL docs'
  | 'Reset onboarding'
  | 'Release notes'

type OptionsRoleLabel = 'Options' | 'Report an issue'

type UtilityRoleLabel = 'Utility'

type ViewRoleLabel = 'View' | 'Learn more'

// Only export the union of all the internal types since they are all labels
// The internal types are only for readability within the file
export type ZooLabel =
  | 'Learn more'
  | 'New project'
  | 'Open project'
  | 'Help'
  | 'Window'
  | 'Edit'
  | 'File'
  | 'Open Project'
  | 'Import file from URL'
  | 'Preferences'
  | 'User settings'
  | 'Keybindings'
  | 'Rename project'
  | 'Delete project'
  | HelpRoleLabel
  | OptionsRoleLabel
  | UtilityRoleLabel
  | ViewRoleLabel

// Extend the interface with additional custom properties
export interface ZooMenuItemConstructorOptions
  extends MenuItemConstructorOptions {
  label?: ZooLabel
  submenu?: ZooMenuItemConstructorOptions[] | Menu
}
