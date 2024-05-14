import {
  IconDefinition,
  faBugSlash,
  faCode,
  faCodeCommit,
  faExclamationCircle,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons'
import { KclEditorMenu } from 'components/ModelingSidebar/ModelingPanes/KclEditorMenu'
import { CustomIconName } from 'components/CustomIcon'
import { KclEditorPane } from 'components/ModelingSidebar/ModelingPanes/KclEditorPane'
import { ReactNode } from 'react'
import { MemoryPane } from './MemoryPane'
import { KclErrorsPane, LogsPane } from './LoggingPanes'
import { DebugPane } from './DebugPane'
import { FileTreeInner, FileTreeMenu } from 'components/FileTree'

export type SidebarType =
  | 'code'
  | 'debug'
  | 'export'
  | 'files'
  | 'kclErrors'
  | 'logs'
  | 'lspMessages'
  | 'variables'

const PANE_KEYBINDING_PREFIX = 'alt+p ' as const

export type SidebarPane = {
  id: SidebarType
  title: string
  icon: CustomIconName | IconDefinition
  keybinding: string
  Content: ReactNode | React.FC
  Menu?: ReactNode | React.FC
  hideOnPlatform?: 'desktop' | 'web'
}

export const topPanes: SidebarPane[] = [
  {
    id: 'code',
    title: 'KCL Code',
    icon: faCode,
    Content: KclEditorPane,
    keybinding: PANE_KEYBINDING_PREFIX + 'c',
    Menu: KclEditorMenu,
  },
  {
    id: 'files',
    title: 'Project Files',
    icon: 'folder',
    Content: FileTreeInner,
    keybinding: PANE_KEYBINDING_PREFIX + 'f',
    Menu: FileTreeMenu,
    hideOnPlatform: 'web',
  },
]

export const bottomPanes: SidebarPane[] = [
  {
    id: 'variables',
    title: 'Variables',
    icon: faSquareRootVariable,
    Content: MemoryPane,
    keybinding: PANE_KEYBINDING_PREFIX + 'v',
  },
  {
    id: 'logs',
    title: 'Logs',
    icon: faCodeCommit,
    Content: LogsPane,
    keybinding: PANE_KEYBINDING_PREFIX + 'l',
  },
  {
    id: 'kclErrors',
    title: 'KCL Errors',
    icon: faExclamationCircle,
    Content: KclErrorsPane,
    keybinding: PANE_KEYBINDING_PREFIX + 'e',
  },
  {
    id: 'debug',
    title: 'Debug',
    icon: faBugSlash,
    Content: DebugPane,
    keybinding: PANE_KEYBINDING_PREFIX + 'd',
  },
]
