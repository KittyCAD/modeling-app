import type { Project } from '@src/lib/project'
import type { FileExplorerEntry } from '@src/components/Explorer/utils'
import type { IndexLoaderData } from '@src/lib/types'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { ProjectExplorer } from '@src/components/Explorer/ProjectExplorer'
import { addPlaceHoldersForNewFileAndFolder } from '@src/components/Explorer/utils'
import { ToastInsert } from '@src/components/ToastInsert'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import { FILE_EXT, INSERT_FOREIGN_TOAST_ID } from '@src/lib/constants'
import {
  PATHS,
  getEXTNoPeriod,
  isExtensionARelevantExtension,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import { systemIOActor, commandBarActor, kclManager } from '@src/lib/singletons'
import {
  useFolders,
  useProjectDirectoryPath,
} from '@src/machines/systemIO/hooks'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useRef, useState, useEffect, use } from 'react'
import toast from 'react-hot-toast'
import { useRouteLoaderData } from 'react-router-dom'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import type { AreaTypeComponentProps } from '@src/lib/layout'

export function ProjectExplorerPane(props: AreaTypeComponentProps) {
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const projects = useFolders()
  const projectDirectoryPath = useProjectDirectoryPath()
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const projectRef = useRef(loaderData.project)
  const [theProject, setTheProject] = useState<Project | null>(null)
  const { project, file } = loaderData
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
  const [refreshExplorerPressed, setRefresFolderPressed] = useState<number>(0)
  const [collapsePressed, setCollapsedPressed] = useState<number>(0)

  const onRowClicked = (entry: FileExplorerEntry) => {
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
      return isExtensionARelevantExtension(extension, RELEVANT_FILE_EXTENSIONS)
    }

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
    } else if (
      window.electron &&
      isRelevantFile(entry.path) &&
      projectRef.current?.path
    ) {
      // Allow insert if it is a importable file
      const electron = window.electron
      toast.custom(
        ToastInsert({
          onInsert: () => {
            const relativeFilePath = entry.path.replace(
              projectRef.current?.path + electron.path.sep,
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
    <LayoutPanel
      title={props.layout.label}
      onClose={props.onClose}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
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
          />
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
            overrideApplicationProjectDirectory={projectDirectoryPath}
          />
        </div>
      ) : (
        <div />
      )}
    </LayoutPanel>
  )
}
