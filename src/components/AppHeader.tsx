import { Toolbar } from '../Toolbar'
import UserSidebarMenu from './UserSidebarMenu'
import { ProjectWithEntryPointMetadata } from '../Router'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { GlobalStateContext } from './GlobalStateProvider'
import { useContext } from 'react'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
  project?: ProjectWithEntryPointMetadata
  className?: string
  enableMenu?: boolean
}

export const AppHeader = ({
  showToolbar = true,
  project,
  children,
  className = '',
  enableMenu = false,
}: AppHeaderProps) => {
  const {
    auth: {
      context: { user },
    },
  } = useContext(GlobalStateContext)

  return (
    <header
      className={
        'overlaid-panes sticky top-0 z-20 py-1 px-5 bg-chalkboard-10/50 dark:bg-chalkboard-100/50 border-b dark:border-b-2 border-chalkboard-30 dark:border-chalkboard-90 flex justify-between items-center ' +
        className
      }
    >
      <ProjectSidebarMenu renderAsLink={!enableMenu} project={project} />
      {/* Toolbar if the context deems it */}
      {showToolbar && (
        <div className="max-w-4xl">
          <Toolbar />
        </div>
      )}
      {/* If there are children, show them, otherwise show User menu */}
      {children || <UserSidebarMenu user={user} />}
    </header>
  )
}
