import { ActionButton } from './ActionButton'
import { CustomIcon } from './CustomIcon'
import Tooltip from './Tooltip'

interface FileTreeProps {
  className?: string
}

export const FileTree = ({ className = '' }: FileTreeProps) => {
  return (
    <div className={className}>
      <div className="flex items-center gap-1 px-4 py-1 bg-chalkboard-30/50 dark:bg-chalkboard-70/50">
        <h2 className="flex-1 m-0 p-0 text-sm mono">Files</h2>
        <ActionButton
          Element="button"
          icon={{
            icon: 'createFile',
            iconClassName:
              '!text-energy-80 dark:!text-energy-20',
            bgClassName: 'hover:bg-energy-10/50 dark:hover:bg-transparent',
          }}
          className="!p-0 border-none bg-transparent"
        >
          <Tooltip position='blockEnd' delay={750}>Create File</Tooltip>
        </ActionButton>

        <ActionButton
          Element="button"
          icon={{
            icon: 'createFolder',
            iconClassName:
              '!text-energy-80 dark:!text-energy-20',
            bgClassName: 'hover:bg-energy-10/50 dark:hover:bg-transparent',
          }}
          className="!p-0 border-none bg-transparent"
        >
          <Tooltip position='blockEnd' delay={750}>Create Folder</Tooltip>
        </ActionButton>
      </div>
    </div>
  )
}
