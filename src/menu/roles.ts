// Does not matter what labels belong to what type. I only split these into some internal types to easily parse
// what labels should belong to what grouping
import type { Menu, MenuItemConstructorOptions } from 'electron'

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
  | 'Create project'
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
  | 'Share part via Zoo link'
  | 'Project settings'
  | 'Load external model'
  | 'User default units'

type EditRoleLabel =
  | 'Rename project'
  | 'Delete project'
  | 'Change project directory'
  | 'Speech'
  | 'Edit parameter'
  | 'Modify with Zoo Text-To-CAD'
  | 'Format code'

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
  | 'Orthographic view'
  | 'Perspective view'
  | 'Right view'
  | 'Back view'
  | 'Top view'
  | 'Left view'
  | 'Front view'
  | 'Bottom view'
  | 'Reset view'
  | 'Center view on selection'
  | 'Refresh'
  | 'Named views'
  | 'Create named view'
  | 'Load named view'
  | 'Delete named view'

type DesignRoleLabel =
  | 'Design'
  | 'Create a parameter'
  | 'Insert from project file'
  | 'Create with Zoo Text-To-CAD'
  | 'Start sketch'
  | 'Create an offset plane'
  | 'Create a helix'
  | 'Create an additive feature'
  | 'Extrude'
  | 'Revolve'
  | 'Sweep'
  | 'Loft'
  | 'Apply modification feature'
  | 'Fillet'
  | 'Chamfer'
  | 'Shell'

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
