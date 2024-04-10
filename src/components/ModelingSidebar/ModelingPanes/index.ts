import {
  IconDefinition,
  faBugSlash,
  faCode,
  faCodeCommit,
  faExclamationCircle,
  faMagnifyingGlass,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons'
import { CodeMenu } from 'components/ModelingSidebar/ModelingPanes/KclEditorMenu'
import { CustomIconName } from 'components/CustomIcon'
import { KclEditorPane } from 'components/ModelingSidebar/ModelingPanes/KclEditorPane'
import { ReactNode } from 'react'
import type { PaneType } from 'useStore'
import { MemoryPane } from './MemoryPane'
import { KclErrorsPane, LogsPane } from './LoggingPanes'
import { DebugPane } from './DebugPane'

export type Pane = {
  id: PaneType
  title: string
  icon: CustomIconName | IconDefinition
  Content: ReactNode | React.FC
  Menu?: ReactNode | React.FC
  keybinding: string
}

export const topPanes: Pane[] = [
  {
    id: 'code',
    title: 'KCL Code',
    icon: faCode,
    Content: KclEditorPane,
    keybinding: 'shift + c',
    Menu: CodeMenu,
  },
]

export const bottomPanes: Pane[] = [
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
]
