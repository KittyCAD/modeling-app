import { useSignals } from '@preact/signals-react/runtime'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { ProjectExplorer } from '@src/components/Explorer/ProjectExplorer'
import type { FileExplorerEntry } from '@src/components/Explorer/utils'
import { getProjectExplorerProjectWithPlaceholders } from '@src/components/layout/areas/ProjectExplorerPane.utils'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import {
  clearActiveTextFile,
  openActiveTextFile,
} from '@src/lib/activeTextFile'
import { useApp, useSingletons } from '@src/lib/boot'
import { FILE_EXT } from '@src/lib/constants'
import {
  type AreaTypeComponentProps,
  DefaultLayoutPaneID,
} from '@src/lib/layout'
import type { Project } from '@src/lib/project'
import { reportRejection } from '@src/lib/trap'
import { use, useCallback, useEffect, useRef, useState, useMemo } from 'react'

export function ProjectExplorerPane(props: AreaTypeComponentProps) {
  useSignals()
  const app = useApp()
  const { commands, fileOperations, project, layout } = app
  const { kclManager } = useSingletons()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const metadata = project?.projectIORefSignal.value
  const projects = useMemo(() => (metadata ? [metadata] : []), [metadata])
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

    const duplicated = getProjectExplorerProjectWithPlaceholders({
      loadedProject,
      projects,
    })

    if (!duplicated) {
      return
    }
    setTheProject(duplicated)
  }, [file, projects, project])

  const [createFilePressed, setCreateFilePressed] = useState<number>(0)
  const [createFolderPressed, setCreateFolderPressed] = useState<number>(0)
  const [refreshExplorerPressed, setRefresFolderPressed] = useState<number>(0)
  const [collapsePressed, setCollapsedPressed] = useState<number>(0)

  const openCodeEditorPaneIfClosed = useCallback(() => {
    layout.openPane(DefaultLayoutPaneID.Code)
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
      // Only open the file if it is a kcl file.
      if (
        projectRef.current?.value.name &&
        entry.children == null &&
        entry.path.endsWith(FILE_EXT)
      ) {
        // Leaving any open text file for the KCL editor.
        clearActiveTextFile()

        const navigateHelper = () => {
          app.projectSession
            .openFile(entry.path, { projectPath: project?.path })
            .catch(reportRejection)
        }
        const navigateAfterFlush = () => {
          void kclManager
            .flushWriteToFile()
            .then((saved) => {
              if (saved) navigateHelper()
            })
            .catch(reportRejection)
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
            navigateAfterFlush()
          })
        } else {
          // immediately navigate
          navigateAfterFlush()
        }
      } else if (projectRef.current?.value.name && entry.children == null) {
        // Inspect file contents before allowing edits, regardless of extension.
        openCodeEditorPaneIfClosed()
        openActiveTextFile(fileOperations, entry.path).catch(reportRejection)
      }
    },
    [
      fileOperations,
      kclManager,
      modelingActor,
      modelingMachineState,
      modelingSend,
      openCodeEditorPaneIfClosed,
      app,
      project,
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
            overrideApplicationProjectDirectory={app.projectDirectoryPath}
          />
        </div>
      ) : (
        <div />
      )}
    </LayoutPanel>
  )
}
