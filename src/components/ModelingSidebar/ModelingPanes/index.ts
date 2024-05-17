import {
  IconDefinition,
  faBugSlash,
  faCode,
  faFolderTree,
  faCodeCommit,
  faExclamationCircle,
  faFolderTree,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons'
import { KclEditorMenu } from 'components/ModelingSidebar/ModelingPanes/KclEditorMenu'
import { CustomIconName } from 'components/CustomIcon'
import { KclEditorPane } from 'components/ModelingSidebar/ModelingPanes/KclEditorPane'
import { ReactNode } from 'react'
import { MemoryPane } from './MemoryPane'
import { SceneTreePane } from './SceneTreePane'
import { KclErrorsPane, LogsPane } from './LoggingPanes'
import { DebugPane } from './DebugPane'
import { FileTreeInner, FileTreeMenu } from 'components/FileTree'
import { SceneTreePane } from './SceneTreePane'

export type SidebarType =
  | 'code'
  | 'debug'
  | 'export'
  | 'files'
  | 'kclErrors'
  | 'logs'
  | 'lspMessages'
  | 'variables'
  | 'sceneTree'

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
    keybinding: 'shift + c',
    Menu: KclEditorMenu,
  },
  {
    id: 'files',
    title: 'Project Files',
    icon: 'folder',
    Content: FileTreeInner,
    keybinding: 'shift + f',
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
    keybinding: 'shift + v',
  },
  {
    id: 'logs',
    title: 'Logs',
    icon: faCodeCommit,
    Content: LogsPane,
    keybinding: 'shift + l',
  },
  {
    id: 'kclErrors',
    title: 'KCL Errors',
    icon: faExclamationCircle,
    Content: KclErrorsPane,
    keybinding: 'shift + e',
  },
  {
    id: 'debug',
    title: 'Debug',
    icon: faBugSlash,
    Content: DebugPane,
    keybinding: 'shift + d',
  },
  {
    id: 'sceneTree',
    title: 'Scene Tree',
    icon: faFolderTree,
    Content: SceneTreePane,
    keybinding: 'shift + t',
  },
]
