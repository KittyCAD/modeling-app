import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { faBugSlash } from '@fortawesome/free-solid-svg-icons'
import type { MouseEventHandler, ReactNode } from 'react'
import type { ContextFrom } from 'xstate'

import type { CustomIconName } from '@src/components/CustomIcon'
import {
  FileTreeInner,
  FileTreeMenu,
  FileTreeRoot,
  useFileTreeOperations,
} from '@src/components/FileTree'
import { ModelingPaneHeader } from '@src/components/ModelingSidebar/ModelingPane'
import { DebugPane } from '@src/components/ModelingSidebar/ModelingPanes/DebugPane'
import { FeatureTreeMenu } from '@src/components/ModelingSidebar/ModelingPanes/FeatureTreeMenu'
import { FeatureTreePane } from '@src/components/ModelingSidebar/ModelingPanes/FeatureTreePane'
import { KclEditorMenu } from '@src/components/ModelingSidebar/ModelingPanes/KclEditorMenu'
import { KclEditorPane } from '@src/components/ModelingSidebar/ModelingPanes/KclEditorPane'
import { LogsPane } from '@src/components/ModelingSidebar/ModelingPanes/LoggingPanes'
import {
  MemoryPane,
  MemoryPaneMenu,
} from '@src/components/ModelingSidebar/ModelingPanes/MemoryPane'
import type { useKclContext } from '@src/lang/KclProvider'
import { kclErrorsByFilename } from '@src/lang/errors'
import { editorManager } from '@src/lib/singletons'
import type { settingsMachine } from '@src/machines/settingsMachine'

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
          Menu={FeatureTreeMenu}
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
      const {
        createFile,
        createFolder,
        cloneFileOrDir,
        openInNewWindow,
        newTreeEntry,
      } = useFileTreeOperations()

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
            onOpenInNewWindow={(path: string) => openInNewWindow({ path })}
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
        'absolute m-0 p-0 bottom-4 left-4 min-w-3 h-3 flex items-center justify-center text-[9px] font-semibold text-white bg-primary hue-rotate-90 rounded-full border border-chalkboard-10 dark:border-chalkboard-80 z-50 hover:cursor-pointer hover:scale-[2] transition-transform duration-200',
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
    hide: ({ settings }) => !settings.app.showDebugPanel.current,
  },
]
