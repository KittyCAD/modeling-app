import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { ProjectExplorer } from '@src/components/Explorer/ProjectExplorer'
import type { FileExplorerEntry } from '@src/components/Explorer/utils'
import { ToastInsert } from '@src/components/ToastInsert'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { getProjectExplorerProjectWithPlaceholders } from '@src/components/layout/areas/ProjectExplorerPane.utils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import { useApp, useSingletons } from '@src/lib/boot'
import { FILE_EXT, INSERT_FOREIGN_TOAST_ID } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  type AreaTypeComponentProps,
  DefaultLayoutPaneID,
  getOpenPanes,
  togglePaneLayoutNode,
} from '@src/lib/layout'
import {
  getEXTNoPeriod,
  isExtensionARelevantExtension,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { reportRejection } from '@src/lib/trap'
import {
  useFolders,
  useProjectDirectoryPath,
} from '@src/machines/systemIO/hooks'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

export function ProjectExplorerPane(props: AreaTypeComponentProps) {
  const { commands, project, systemIOActor, layout } = useApp()
  const { kclManager } = useSingletons()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const projects = useFolders()
  const projectDirectoryPath = useProjectDirectoryPath()
  const projectRef = useRef(project?.projectIORefSignal)
  const [theProject, setTheProject] = useState<Project | null>(null)
  const file = project?.executingFileEntry.value
  const {
    state: modelingMachineState,
    send: modelingSend,
    actor: modelingActor,
  } = useModelingContext()

  useEffect(() => {
    // Have no idea why the project loader data doesn't have the children from the ls on disk
    // That means it is a different object or cached incorrectly?
    if (!project || !file) {
      return
    }

    const loadedProject = project.projectIORefSignal.value
    if (projects === undefined) {
      systemIOActor.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
    }

    const duplicated = getProjectExplorerProjectWithPlaceholders({
      loadedProject,
      projects,
    })

    if (!duplicated) {
      return
    }
    setTheProject(duplicated)
  }, [file, projects, project, systemIOActor])

  const [createFilePressed, setCreateFilePressed] = useState<number>(0)
  const [createFolderPressed, setCreateFolderPressed] = useState<number>(0)
  const [refreshExplorerPressed, setRefresFolderPressed] = useState<number>(0)
  const [collapsePressed, setCollapsedPressed] = useState<number>(0)

  const openCodeEditorPaneIfClosed = useCallback(() => {
    const rootLayout = layout.get()
    if (getOpenPanes({ rootLayout }).includes(DefaultLayoutPaneID.Code)) {
      return
    }
    layout.set(
      togglePaneLayoutNode({
        rootLayout: structuredClone(rootLayout),
        targetNodeId: DefaultLayoutPaneID.Code,
        shouldExpand: true,
      })
    )
  }, [layout])

  const downloadProjectZip = useCallback(() => {
    commands.send({
      type: 'Find and select command',
      data: {
        name: 'export-project-zip',
        groupId: 'application',
      },
    })
  }, [commands])

  const onRowDoubleClicked = useCallback(
    (entry: FileExplorerEntry) => {
      if (
        !projectRef.current?.value.name ||
        entry.children != null ||
        !entry.path.endsWith(FILE_EXT)
      ) {
        return
      }
      openCodeEditorPaneIfClosed()
    },
    [openCodeEditorPaneIfClosed]
  )

  const onRowClicked = useCallback(
    (entry: FileExplorerEntry) => {
      const requestedFileName = parentPathRelativeToProject(
        entry.path,
        projectDirectoryPath
      )

      const RELEVANT_FILE_EXTENSIONS = relevantFileExtensions(wasmInstance)
      const isRelevantFile = (filename: string): boolean => {
        const extension = getEXTNoPeriod(filename)
        if (!extension) {
          return false
        }
        return isExtensionARelevantExtension(
          extension,
          RELEVANT_FILE_EXTENSIONS
        )
      }

      // Only open the file if it is a kcl file.
      if (
        projectRef.current?.value.name &&
        entry.children == null &&
        entry.path.endsWith(FILE_EXT)
      ) {
        const name = projectRef.current.value.name.slice()

        const navigateHelper = () => {
          systemIOActor.send({
            type: SystemIOMachineEvents.navigateToFile,
            data: {
              requestedProjectName: name,
              requestedFileName: requestedFileName,
            },
          })
        }

        if (modelingMachineState.matches('Sketch')) {
          modelingSend({ type: 'Cancel' })
          const waitForIdlePromise = new Promise((resolve) => {
            const subscription = modelingActor.subscribe((state) => {
              if (state.matches('idle')) {
                subscription.unsubscribe()
                resolve(undefined)
              }
            })
          })
          waitForIdlePromise.catch(reportRejection).finally(() => {
            navigateHelper()
          })
        } else {
          // immediately navigate
          navigateHelper()
        }
      } else if (isRelevantFile(entry.path) && projectRef.current?.value.path) {
        // Allow insert if it is a importable file
        toast.custom(
          ToastInsert({
            onInsert: () => {
              const relativeFilePath = entry.path.replace(
                projectRef.current?.value.path + fsZds.sep,
                ''
              )
              commands.send({
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
    },
    [
      commands,
      modelingActor,
      modelingMachineState,
      modelingSend,
      projectDirectoryPath,
      systemIOActor,
      wasmInstance,
    ]
  )

  return (
    <LayoutPanel
      title={props.layout.label}
      onClose={props.onClose}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="folder"
        title={props.layout.label}
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
            onDownloadProject={
              !window.electron ? downloadProjectZip : undefined
            }
          />
        }
        onClose={props.onClose}
      />
      {theProject && file ? (
        <div className={'w-full h-full flex flex-col'}>
          <ProjectExplorer
            wasmInstance={wasmInstance}
            project={theProject}
            file={file}
            createFilePressed={createFilePressed}
            createFolderPressed={createFolderPressed}
            refreshExplorerPressed={refreshExplorerPressed}
            collapsePressed={collapsePressed}
            onRowClicked={onRowClicked}
            onRowDoubleClicked={onRowDoubleClicked}
            onRowEnter={onRowClicked}
            canNavigate={true}
            readOnly={false}
            overrideApplicationProjectDirectory={projectDirectoryPath}
          />
        </div>
      ) : (
        <div />
      )}
    </LayoutPanel>
  )
}
