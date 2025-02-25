import { IconDefinition, faBugSlash } from '@fortawesome/free-solid-svg-icons'
import { KclEditorMenu } from 'components/ModelingSidebar/ModelingPanes/KclEditorMenu'
import { CustomIconName } from 'components/CustomIcon'
import { KclEditorPane } from 'components/ModelingSidebar/ModelingPanes/KclEditorPane'
import { ModelingPaneHeader } from 'components/ModelingSidebar/ModelingPane'
import { MouseEventHandler, ReactNode } from 'react'
import { MemoryPane, MemoryPaneMenu } from './MemoryPane'
import { LogsPane } from './LoggingPanes'
import { DebugPane } from './DebugPane'
import {
  FileTreeInner,
  FileTreeMenu,
  FileTreeRoot,
  useFileTreeOperations,
} from 'components/FileTree'
import { useKclContext } from 'lang/KclProvider'
import { editorManager } from 'lib/singletons'
import { ContextFrom } from 'xstate'
import { settingsMachine } from 'machines/settingsMachine'
import { FeatureTreePane } from './FeatureTreePane'
import { kclErrorsByFilename } from 'lang/errors'

export type SidebarType =
  | 'code'
  | 'debug'
  | 'export'
  | 'files'
  | 'feature-tree'
  | 'logs'
  | 'lspMessages'
  | 'variables'

export interface BadgeInfo {
  value: (props: PaneCallbackProps) => boolean | number | string
  onClick?: MouseEventHandler<any>
  className?: string
  title?: string
}

/**
 * This interface can be extended as more context is needed for the panes
 * to determine if they should show their badges or not.
 */
interface PaneCallbackProps {
  kclContext: ReturnType<typeof useKclContext>
  settings: ContextFrom<typeof settingsMachine>
  platform: 'web' | 'desktop'
}

export type SidebarPane = {
  id: SidebarType
  sidebarName: string
  icon: CustomIconName | IconDefinition
  keybinding: string
  Content: React.FC<{ id: SidebarType; onClose: () => void }>
  hide?: boolean | ((props: PaneCallbackProps) => boolean)
  showBadge?: BadgeInfo
}

export type SidebarAction = {
  id: string
  sidebarName: string
  icon: CustomIconName
  title: ReactNode
  iconClassName?: string // Just until we get rid of FontAwesome icons
  keybinding: string
  action: () => void
  hide?: boolean | ((props: PaneCallbackProps) => boolean)
  disable?: () => string | undefined
}

// For now a lot of icons are the same but the reality is they could totally
// be different, like an icon based on some data for the pane, or the icon
// changes to be a spinning loader on loading.

export const sidebarPanes: SidebarPane[] = [
  {
    id: 'feature-tree',
    icon: 'model',
    keybinding: 'Shift + T',
    sidebarName: 'Feature Tree',
    Content: (props) => (
      <>
        <ModelingPaneHeader
          id={props.id}
          icon="model"
          title="Feature Tree"
          onClose={props.onClose}
        />
        <FeatureTreePane />
      </>
    ),
  },
  {
    id: 'code',
    icon: 'code',
    sidebarName: 'KCL Code',
    Content: (props: { id: SidebarType; onClose: () => void }) => {
      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon="code"
            title="KCL Code"
            Menu={<KclEditorMenu />}
            onClose={props.onClose}
          />
          <KclEditorPane />
        </>
      )
    },
    keybinding: 'Shift + C',
    showBadge: {
      value: ({ kclContext }) => {
        return kclContext.diagnostics.length
      },
      onClick: (e) => {
        e.preventDefault()
        editorManager.scrollToFirstErrorDiagnosticIfExists()
      },
    },
  },
  {
    id: 'files',
    icon: 'folder',
    sidebarName: 'Project Files',
    Content: (props: { id: SidebarType; onClose: () => void }) => {
      const { createFile, createFolder, cloneFileOrDir, newTreeEntry } =
        useFileTreeOperations()

      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon="folder"
            title={<FileTreeRoot />}
            Menu={
              <FileTreeMenu
                onCreateFile={() => createFile({ dryRun: true })}
                onCreateFolder={() => createFolder({ dryRun: true })}
              />
            }
            onClose={props.onClose}
          />
          <FileTreeInner
            onCreateFile={(name: string) => createFile({ dryRun: false, name })}
            onCreateFolder={(name: string) =>
              createFolder({ dryRun: false, name })
            }
            onCloneFileOrFolder={(path: string) => cloneFileOrDir({ path })}
            newTreeEntry={newTreeEntry}
          />
        </>
      )
    },
    keybinding: 'Shift + F',
    hide: ({ platform }) => platform === 'web',
    showBadge: {
      value: (context) => {
        // Only compute runtime errors! Compilation errors are not tracked here.
        const errors = kclErrorsByFilename(context.kclContext.errors)
        return errors.size > 0 ? 'x' : ''
      },
      onClick: (e) => {
        e.preventDefault()
        // TODO: When we have generic file open
        // If badge is pressed
        // Open the first error in the array of errors
        // Then scroll to error
        // Do you automatically open the project files
        // editorManager.scrollToFirstErrorDiagnosticIfExists()
      },
      className:
        'absolute m-0 p-0 bottom-4 left-4 w-3 h-3 flex items-center justify-center text-[9px] font-semibold text-white bg-red-600 rounded-full border border-red-300 dark:border-red-800 z-50 hover:cursor-pointer hover:scale-[2] transition-transform duration-200',
      title: 'Project files have runtime errors',
    },
  },
  {
    id: 'variables',
    icon: 'make-variable',
    sidebarName: 'Variables',
    Content: (props: { id: SidebarType; onClose: () => void }) => {
      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon="make-variable"
            title="Variables"
            Menu={<MemoryPaneMenu />}
            onClose={props.onClose}
          />
          <MemoryPane />
        </>
      )
    },
    keybinding: 'Shift + V',
  },
  {
    id: 'logs',
    icon: 'logs',
    sidebarName: 'Logs',
    Content: (props: { id: SidebarType; onClose: () => void }) => {
      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon="logs"
            title="Logs"
            Menu={null}
            onClose={props.onClose}
          />
          <LogsPane />
        </>
      )
    },
    keybinding: 'Shift + L',
  },
  {
    id: 'debug',
    icon: faBugSlash,
    sidebarName: 'Debug',
    Content: (props: { id: SidebarType; onClose: () => void }) => {
      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon={faBugSlash}
            title="Debug"
            Menu={null}
            onClose={props.onClose}
          />
          <DebugPane />
        </>
      )
    },
    keybinding: 'Shift + D',
    hide: ({ settings }) => !settings.modeling.showDebugPanel.current,
  },
]
