import {
  IconDefinition,
  faBugSlash,
  faCode,
  faCodeCommit,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons'
import { KclEditorMenu } from 'components/ModelingSidebar/ModelingPanes/KclEditorMenu'
import { CustomIconName } from 'components/CustomIcon'
import { KclEditorPane } from 'components/ModelingSidebar/ModelingPanes/KclEditorPane'
import { MouseEventHandler, ReactNode } from 'react'
import { MemoryPane, MemoryPaneMenu } from './MemoryPane'
import { LogsPane } from './LoggingPanes'
import { DebugPane } from './DebugPane'
import { FileTreeInner, FileTreeMenu } from 'components/FileTree'
import { useKclContext } from 'lang/KclProvider'
import { editorManager } from 'lib/singletons'

export type SidebarType =
  | 'code'
  | 'debug'
  | 'export'
  | 'files'
  | 'logs'
  | 'lspMessages'
  | 'variables'

export interface BadgeInfo {
  value: (props: PaneCallbackProps) => boolean | number
  onClick?: MouseEventHandler<any>
}

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
  showBadge?: BadgeInfo
}

export const sidebarPanes: SidebarPane[] = [
  {
    id: 'code',
    title: 'KCL Code',
    icon: faCode,
    Content: KclEditorPane,
    keybinding: 'Shift + C',
    Menu: KclEditorMenu,
    showBadge: {
      value: ({ kclContext }) => {
        return kclContext.errors.length
      },
      onClick: (e) => {
        e.preventDefault()
        editorManager.scrollToFirstErrorDiagnosticIfExists()
      },
    },
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
    id: 'debug',
    title: 'Debug',
    icon: faBugSlash,
    Content: DebugPane,
    keybinding: 'Shift + D',
  },
]
