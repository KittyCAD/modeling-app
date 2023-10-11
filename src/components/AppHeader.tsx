import { Toolbar } from '../Toolbar'
import UserSidebarMenu from './UserSidebarMenu'
import { IndexLoaderData } from '../Router'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import styles from './AppHeader.module.css'
import { NetworkHealthIndicator } from './NetworkHealthIndicator'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
  project?: Omit<IndexLoaderData, 'code'>
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
  const { auth } = useGlobalStateContext()
  const user = auth?.context?.user

  return (
    <header
      className={
        (showToolbar ? 'w-full grid ' : 'flex justify-between ') +
        styles.header +
        ' overlaid-panes sticky top-0 z-20 py-1 px-5 bg-chalkboard-10/70 dark:bg-chalkboard-100/50 border-b dark:border-b-2 border-chalkboard-30 dark:border-chalkboard-90 items-center ' +
        className
      }
    >
      {project && (
        <ProjectSidebarMenu
          renderAsLink={!enableMenu}
          project={project.project}
          file={project.file}
        />
      )}
      {/* Toolbar if the context deems it */}
      {showToolbar && (
        <div className="max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-4xl 2xl:max-w-5xl">
          <Toolbar />
        </div>
      )}
      {/* If there are children, show them, otherwise show User menu */}
      {children || (
        <div className="ml-auto flex items-center gap-1">
          <NetworkHealthIndicator />
          <UserSidebarMenu user={user} />
        </div>
      )}
    </header>
  )
}
