import type { Project, FileEntry } from '@src/lib/project'
import {
  FileExplorer,
  constructPath,
} from '@src/components/Explorer/FileExplorer'
import type { FileExplorerEntry } from '@src/components/Explorer/FileExplorer'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { useState } from 'react'
import { systemIOActor } from '@src/lib/singletons'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'

/**
 * Wrap the header and the tree into a single component
 * This is important because the action header buttons need to know
 * the selection logic of the tree since add file will be based on your
 * selection within the tree.
 *
 * pass a Project type which is compatiable with the data stored in
 * the systemIOMachine
 *
 */
export const ProjectExplorer = ({
  project,
}: {
  project: Project
}) => {
  // cache the state of opened rows to allow nested rows to be opened if a parent one is closed
  // when the parent opens the children will already be opened
  const [openedRows, setOpenedRows] = useState<{ [key: string]: boolean }>({})
  const [selectedRow, setSelectedRow] = useState<FileExplorerEntry | null>(null)

  // fake row is used for new files or folders
  // you should not be able to have multiple fake rows for creation
  const [fakeRow, setFakeRow] = useState<{path: string, isFile: boolean} | null>(null)

  const onRowClickCallback = (file: FileExplorerEntry) => {
    const newOpenedRows = { ...openedRows }
    const key = constructPath({
      parentPath: file.parentPath,
      name: file.name,
    })
    const value = openedRows[key]
    newOpenedRows[key] = !value
    setOpenedRows(newOpenedRows)
    console.log(file)
    setSelectedRow(file)
  }

  return (
    <div>
      <div className="flex flex-row justify-between">
        <div>{project?.name || 'No Project Selected'}</div>
        <div className="h-6 flex flex-row gap-1">
          <FileExplorerHeaderActions
            onCreateFile={() => {
              // Use the selected level within the file tree or the root level of the project
              const folderPath = selectedRow?.parentPath ? constructPath({parentPath: selectedRow?.parentPath, name: selectedRow.name}) : null
              const parentPath = selectedRow?.parentPath
              const isFile = selectedRow?.children === null
              const path = (isFile ? parentPath : folderPath) || project.name
              setFakeRow({path, isFile})
            }}
            onCreateFolder={() => {
              console.log('onCreateFolder TODO')
            }}
            onRefreshExplorer={() => {
              // TODO: Refresh only this path from the Project. This will refresh your entire application project directory
              // It is correct but can be slow if there are many projects
              systemIOActor.send({
                type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
              })
            }}
            onCollapseExplorer={() => {
              setOpenedRows({})
            }}
          ></FileExplorerHeaderActions>
        </div>
      </div>
      <div className="h-96 overflow-y-auto overflow-x-hidden">
        {project && (
          <FileExplorer
            parentProject={project}
            openedRows={openedRows}
            selectedRow={selectedRow}
            onRowClickCallback={onRowClickCallback}
            fakeRow={fakeRow}
          ></FileExplorer>
        )}
      </div>
    </div>
  )
}
