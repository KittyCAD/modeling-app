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
import { MemoryPane, MemoryPaneMenu } from './MemoryPane'
import { KclErrorsPane, LogsPane } from './LoggingPanes'
import { DebugPane } from './DebugPane'
import { FileTreeInner, FileTreeMenu } from 'components/FileTree'
import { useKclContext } from 'lang/KclProvider'

export type SidebarType =
  | 'code'
  | 'debug'
  | 'export'
  | 'files'
  | 'kclErrors'
  | 'logs'
  | 'lspMessages'
  | 'variables'

/**
 * This interface can be extended as more context is needed for the panes
 * to determine if they should show their badges or not.
 */
interface PaneCallbackProps {
  kclContext: ReturnType<typeof useKclContext>
}

export type SidebarPane = {
  id: SidebarType
  title: string
  icon: CustomIconName | IconDefinition
  keybinding: string
  Content: ReactNode | React.FC
  Menu?: ReactNode | React.FC
  hideOnPlatform?: 'desktop' | 'web'
  showBadge?: (props: PaneCallbackProps) => boolean | number
}

export const sidebarPanes: SidebarPane[] = [
  {
    id: 'code',
    title: 'KCL Code',
    icon: faCode,
    Content: KclEditorPane,
    keybinding: 'Shift + C',
    Menu: KclEditorMenu,
  },
  {
    id: 'files',
    title: 'Project Files',
    icon: 'folder',
    Content: FileTreeInner,
    keybinding: 'Shift + F',
    Menu: FileTreeMenu,
    hideOnPlatform: 'web',
  },
  {
    id: 'variables',
    title: 'Variables',
    icon: faSquareRootVariable,
    Content: MemoryPane,
    Menu: MemoryPaneMenu,
    keybinding: 'Shift + V',
  },
  {
    id: 'logs',
    title: 'Logs',
    icon: faCodeCommit,
    Content: LogsPane,
    keybinding: 'Shift + L',
  },
  {
    id: 'kclErrors',
    title: 'KCL Errors',
    icon: faExclamationCircle,
    Content: KclErrorsPane,
    keybinding: 'Shift + E',
    showBadge: ({ kclContext }) => kclContext.errors.length,
  },
  {
    id: 'debug',
    title: 'Debug',
    icon: faBugSlash,
    Content: DebugPane,
    keybinding: 'Shift + D',
  },
]
