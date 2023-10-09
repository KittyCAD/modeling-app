import { ActionButton } from './ActionButton'
import { CustomIcon } from './CustomIcon'

interface FileTreeProps {
  className?: string
}

export const FileTree = ({ className = '' }: FileTreeProps) => {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 px-4 py-2 bg-chalkboard-30/50 dark:bg-chalkboard-70/50">
        <h2 className="flex-1 m-0 p-0 text-sm mono">Files</h2>
        <ActionButton
          Element="button"
          icon={{
            icon: 'createFile',
            iconClassName: '!text-energy-10 hover:text-energy-60 dark:text-energy-70',
            bgClassName: 'bg-transparent',
          }}
          className='pr-0 p-0 border-none bg-transparent'
        />
    
        <button>
          <CustomIcon name="createFolder" className="w-4 h-4" />
        </button>
      </div>
      
    </div>
  )
}
