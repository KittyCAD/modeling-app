import type { Project, FileEntry } from '@src/lib/project'
import {
  FileExplorer,
  constructPath,
} from '@src/components/Explorer/FileExplorer'
import type { FileExplorerEntry } from '@src/components/Explorer/FileExplorer'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { useState, useRef, useEffect } from 'react'
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
  // -1 is the parent container, -2 is nothing is selected
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const fileExplorerContainer = useRef(null)

  // fake row is used for new files or folders
  // you should not be able to have multiple fake rows for creation
  const [fakeRow, setFakeRow] = useState<{
    entry: FileExplorerEntry | null
    isFile: boolean
  } | null>(null)

  const onRowClickCallback = (file: FileExplorerEntry, domIndex: number) => {
    const newOpenedRows = { ...openedRows }
    const key = constructPath({
      parentPath: file.parentPath,
      name: file.name,
    })
    const value = openedRows[key]
    newOpenedRows[key] = !value
    setOpenedRows(newOpenedRows)
    setSelectedRow(file)
    setActiveIndex(domIndex)
  }

  // Handle outside clicks
  useEffect(() => {
    const handleClickOutside = (event) => {
      const path = event.composedPath ? event.composedPath() : [];

      if (!path.includes(fileExplorerContainer.current)) {
        setActiveIndex(-2);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  return (
    <div>
      <div className="flex flex-row justify-between">
        <div>{project?.name || 'No Project Selected'}</div>
        <div className="h-6 flex flex-row gap-1">
          <FileExplorerHeaderActions
            onCreateFile={() => {
              setFakeRow({ entry: selectedRow, isFile: true })
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
      <div
        className={`h-96 overflow-y-auto overflow-x-hidden border border-transparent ${activeIndex === -1 ? 'border-sky-500' : ''}`}
        tabIndex={0}
        role="tree"
        aria-label="Files Explorer"
        ref={fileExplorerContainer}
        onClick={(event) => {
          if (event.target === fileExplorerContainer.current) {
            setActiveIndex(-1)
            setSelectedRow(null)
          }
        }}
      >
        {activeIndex}
        {project && (
          <FileExplorer
            parentProject={project}
            openedRows={openedRows}
            selectedRow={selectedRow}
            onRowClickCallback={onRowClickCallback}
            fakeRow={fakeRow}
            activeIndex={activeIndex}
          ></FileExplorer>
        )}
      </div>
    </div>
  )
}
