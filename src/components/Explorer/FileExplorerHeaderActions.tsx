import { ActionButton } from '@src/components/ActionButton'
import Tooltip from '@src/components/Tooltip'

/**
 * The set of action buttons that are displayed in the file explorer header
 * Based on your selection level
 *
 * A purely functional component, pass content in!
 */
export const FileExplorerHeaderActions = ({
  onCreateFile,
  onCreateFolder,
  onRefreshExplorer,
  onCollapseExplorer,
  onDownloadProject,
}: {
  onCreateFile: () => void
  onCreateFolder: () => void
  onRefreshExplorer: () => void
  onCollapseExplorer: () => void
  onDownloadProject?: () => void
}) => {
  return (
    <>
      <ActionButton
        Element="button"
        data-testid="create-file-button"
        iconStart={{
          icon: 'filePlus',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={onCreateFile}
      >
        <Tooltip position="bottom-right">New File...</Tooltip>
      </ActionButton>

      <ActionButton
        Element="button"
        data-testid="create-folder-button"
        iconStart={{
          icon: 'folderPlus',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={onCreateFolder}
      >
        <Tooltip position="bottom-right">New Folder...</Tooltip>
      </ActionButton>

      <ActionButton
        Element="button"
        data-testid="refresh-explorer"
        iconStart={{
          icon: 'subtract',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={onRefreshExplorer}
      >
        <Tooltip position="bottom-right">Refresh Explorer</Tooltip>
      </ActionButton>

      {onDownloadProject && (
        <ActionButton
          Element="button"
          data-testid="download-project-zip"
          iconStart={{
            icon: 'download',
            iconClassName: '!text-current',
            bgClassName: 'bg-transparent',
          }}
          className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
          onClick={onDownloadProject}
        >
          <Tooltip position="bottom-right">Download project files</Tooltip>
        </ActionButton>
      )}

      <ActionButton
        Element="button"
        data-testid="collapse-all-folders-explorer"
        iconStart={{
          icon: 'collapse',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={onCollapseExplorer}
      >
        <Tooltip position="bottom-right">Collapse Folders in Explorer</Tooltip>
      </ActionButton>
    </>
  )
}
