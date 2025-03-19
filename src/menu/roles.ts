import { Menu, MenuItemConstructorOptions } from 'electron'
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
  | 'View'
  | 'Learn more'
  | 'Utility'
  | 'Options'
  | 'Report an issue'
  | 'Report a bug'
  | 'Request a feature'
  | 'Ask the community discord'
  | 'Ask the community discourse'
  | 'KCL code samples'
  | 'KCL docs'
  | 'Reset onboarding'
  | 'Release notes'
// Extend the interface with additional custom properties
export interface ZooMenuItemConstructorOptions
  extends MenuItemConstructorOptions {
  label?: ZooLabel
  submenu?: ZooMenuItemConstructorOptions[] | Menu
}
