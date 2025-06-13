import type { Project, FileEntry } from '@src/lib/project'
import {
  FileExplorer,
  constructPath,
} from '@src/components/Explorer/FileExplorer'
import type { FileExplorerEntry } from '@src/components/Explorer/FileExplorer'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { useState } from 'react'

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
  const [selectedRow, setSelectedRow] = useState<FileEntry | null>(null)

  const onRowClickCallback = (file: FileExplorerEntry) => {
    const newOpenedRows = { ...openedRows }
    const key = constructPath({
      parentPath: file.parentPath,
      name: file.name,
    })
    const value = openedRows[key]
    newOpenedRows[key] = !value
    setOpenedRows(newOpenedRows)
    setSelectedRow(file)
  }

  return (
    <div>
      <div className="flex flex-row justify-between">
        <div>{project?.name || 'No Project Selected'}</div>
        <div className="h-6 flex flex-row gap-1">
          <FileExplorerHeaderActions
            onCreateFile={() => {
              console.log('onCreateFile TODO')
            }}
            onCreateFolder={() => {
              console.log('onCreateFolder TODO')
            }}
            onRefreshExplorer={() => {
              console.log('onRefreshExplorer TODO')
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
          ></FileExplorer>
        )}
      </div>
    </div>
  )
}
