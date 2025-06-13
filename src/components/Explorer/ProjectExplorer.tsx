import type { Project, FileEntry } from '@src/lib/project'
import { FileExplorer } from '@src/components/Explorer/FileExplorer'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'

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
export const ProjectExplorer = ({project}:{
  project: Project
}) => {
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
                console.log('onCollapseExplorer TODO')
              }}
            ></FileExplorerHeaderActions>
          </div>
        </div>
        <div className="h-96 overflow-y-auto overflow-x-hidden">
          {project && (
            <FileExplorer parentProject={project}></FileExplorer>
          )}
        </div>
    </div>
  )
}
