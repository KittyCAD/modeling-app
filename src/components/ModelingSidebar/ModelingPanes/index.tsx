import { useLoaderData } from 'react-router-dom'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import {
  useState,
  useEffect,
  type MouseEventHandler,
  type ReactNode,
  useRef,
} from 'react'
import type { ContextFrom } from 'xstate'

import type { CustomIconName } from '@src/components/CustomIcon'
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
import { MlEphantConversationPane } from '@src/components/ModelingSidebar/ModelingPanes/MlEphantConversationPane'
import type { useKclContext } from '@src/lang/KclProvider'
import { kclErrorsByFilename } from '@src/lang/errors'
import {
  commandBarActor,
  editorManager,
  systemIOActor,
  mlEphantManagerActor,
  kclManager,
  codeManager,
  useSettings,
  useUser,
} from '@src/lib/singletons'
import type { settingsMachine } from '@src/machines/settingsMachine'
import { ProjectExplorer } from '@src/components/Explorer/ProjectExplorer'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { parentPathRelativeToProject, PATHS } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'
import { useRouteLoaderData } from 'react-router-dom'
import type { FileExplorerEntry } from '@src/components/Explorer/utils'
import { addPlaceHoldersForNewFileAndFolder } from '@src/components/Explorer/utils'
import { useFolders } from '@src/machines/systemIO/hooks'
import type { Project } from '@src/lib/project'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { FILE_EXT, INSERT_FOREIGN_TOAST_ID } from '@src/lib/constants'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import toast from 'react-hot-toast'
import { ToastInsert } from '@src/components/ToastInsert'

export type SidebarType =
  | 'code'
  | 'debug'
  | 'export'
  | 'files'
  | 'feature-tree'
  | 'logs'
  | 'lspMessages'
  | 'variables'
  | 'text-to-cad'

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

export const sidebarPanesLeft: SidebarPane[] = [
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
        return kclContext.diagnostics.filter(
          (diagnostic) => diagnostic.severity === 'error'
        ).length
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
      const projects = useFolders()
      const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
      const projectRef = useRef(loaderData.project)
      const [theProject, setTheProject] = useState<Project | null>(null)
      const { project, file } = loaderData
      const settings = useSettings()
      useEffect(() => {
        projectRef.current = loaderData?.project

        // Have no idea why the project loader data doesn't have the children from the ls on disk
        // That means it is a different object or cached incorrectly?
        if (!project || !file) {
          return
        }

        // You need to find the real project in the storage from the loader information since the loader Project is not hydrated
        const theProject = projects.find((p) => {
          return p.name === project.name
        })

        if (!theProject) {
          return
        }

        // Duplicate the state to not edit the raw data
        const duplicated = JSON.parse(JSON.stringify(theProject))
        addPlaceHoldersForNewFileAndFolder(duplicated.children, theProject.path)
        setTheProject(duplicated)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
      }, [projects, loaderData])

      const [createFilePressed, setCreateFilePressed] = useState<number>(0)
      const [createFolderPressed, setCreateFolderPressed] = useState<number>(0)
      const [refreshExplorerPressed, setRefresFolderPressed] =
        useState<number>(0)
      const [collapsePressed, setCollapsedPressed] = useState<number>(0)

      const onRowClicked = (entry: FileExplorerEntry, domIndex: number) => {
        const applicationProjectDirectory =
          settings.app.projectDirectory.current
        const requestedFileName = parentPathRelativeToProject(
          entry.path,
          applicationProjectDirectory
        )

        const RELEVANT_FILE_EXTENSIONS = relevantFileExtensions()
        const isRelevantFile = (filename: string): boolean =>
          RELEVANT_FILE_EXTENSIONS.some((ext) => filename.endsWith('.' + ext))

        // Only open the file if it is a kcl file.
        if (
          projectRef.current?.name &&
          entry.children == null &&
          entry.path.endsWith(FILE_EXT)
        ) {
          systemIOActor.send({
            type: SystemIOMachineEvents.navigateToFile,
            data: {
              requestedProjectName: projectRef.current.name,
              requestedFileName: requestedFileName,
            },
          })
        } else if (isRelevantFile(entry.path) && projectRef.current?.path) {
          // Allow insert if it is a importable file
          toast.custom(
            ToastInsert({
              onInsert: () => {
                const relativeFilePath = entry.path.replace(
                  projectRef.current?.path + window.electron.sep,
                  ''
                )
                commandBarActor.send({
                  type: 'Find and select command',
                  data: {
                    name: 'Insert',
                    groupId: 'code',
                    argDefaultValues: { path: relativeFilePath },
                  },
                })
                toast.dismiss(INSERT_FOREIGN_TOAST_ID)
              },
            }),
            { duration: 30000, id: INSERT_FOREIGN_TOAST_ID }
          )
        }
      }

      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon="folder"
            title={`${theProject?.name || ''}`}
            Menu={
              <FileExplorerHeaderActions
                onCreateFile={() => {
                  setCreateFilePressed(performance.now())
                }}
                onCreateFolder={() => {
                  setCreateFolderPressed(performance.now())
                }}
                onRefreshExplorer={() => {
                  setRefresFolderPressed(performance.now())
                }}
                onCollapseExplorer={() => {
                  setCollapsedPressed(performance.now())
                }}
              ></FileExplorerHeaderActions>
            }
            onClose={props.onClose}
          />
          {theProject && file ? (
            <div className={'w-full h-full flex flex-col'}>
              <ProjectExplorer
                project={theProject}
                file={file}
                createFilePressed={createFilePressed}
                createFolderPressed={createFolderPressed}
                refreshExplorerPressed={refreshExplorerPressed}
                collapsePressed={collapsePressed}
                onRowClicked={onRowClicked}
                onRowEnter={onRowClicked}
                canNavigate={true}
                readOnly={false}
              ></ProjectExplorer>
            </div>
          ) : (
            <div></div>
          )}
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
    icon: 'bug',
    sidebarName: 'Debug',
    Content: (props: { id: SidebarType; onClose: () => void }) => {
      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon="bug"
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

export const sidebarPanesRight: SidebarPane[] = [
  {
    id: 'text-to-cad',
    icon: 'sparkles',
    keybinding: 'Shift + E',
    sidebarName: 'Text-to-CAD',
    Content: (props) => {
      const settings = useSettings()
      const user = useUser()
      const { context: contextModeling, theProject } = useModelingContext()
      const { file: loaderFile } = useLoaderData() as IndexLoaderData

      return (
        <>
          <ModelingPaneHeader
            id={props.id}
            icon="sparkles"
            title="Text-to-CAD"
            Menu={null}
            onClose={props.onClose}
          />
          <MlEphantConversationPane
            {...{
              mlEphantManagerActor,
              systemIOActor,
              kclManager,
              codeManager,
              contextModeling,
              theProject: theProject.current,
              loaderFile,
              settings,
              user,
            }}
          />
        </>
      )
    },
  },
]
