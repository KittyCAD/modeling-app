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
  | 'Open Project'
  | 'Create Project'
  | 'Import File from URL'
  | 'Preferences'
  | 'User Settings'
  | 'Keybindings'
  | 'Sign Out'
  | 'Theme'
  | 'Export Current Part'
  | 'Create New File'
  | 'Create New Folder'
  | 'Share Part via Zoo Link'
  | 'Project Settings'
  | 'Add File to Project'
  | 'User Default Units'

type EditRoleLabel =
  | 'Rename Project'
  | 'Delete Project'
  | 'Change Project Directory'
  | 'Undo'
  | 'Redo'
  | 'Speech'
  | 'Edit Parameter'
  | 'Modify with Zoo Text-To-CAD'
  | 'Format Code'

type HelpRoleLabel =
  | 'Report a Bug'
  | 'Request a Feature'
  | 'Ask the Community Discord'
  | 'Ask the Community Discourse'
  | 'KCL Code Samples'
  | 'KCL Docs'
  | 'Replay Onboarding Tutorial'
  | 'Show Release Notes'
  | 'Check for Updates'
  | 'Manage Account'
  | 'Get Started with Text-to-CAD'
  | 'Show All Commands'

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
  | 'Standard Views'
  | 'Orthographic View'
  | 'Perspective View'
  | 'Right View'
  | 'Back View'
  | 'Top View'
  | 'Left View'
  | 'Front View'
  | 'Bottom View'
  | 'Reset View'
  | 'Center View on Selection'
  | 'Named Views'
  | 'Create Named View'
  | 'Load Named View'
  | 'Delete Named View'

type DesignRoleLabel =
  | 'Design'
  | 'Create a Parameter'
  | 'Insert from Project File'
  | 'Start Sketch'
  | 'Create an Offset Plane'
  | 'Create a Helix'
  | 'Create an Additive Feature'
  | 'Extrude'
  | 'Revolve'
  | 'Sweep'
  | 'Loft'
  | 'Apply Modification Feature'
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
