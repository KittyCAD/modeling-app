import { Toolbar } from '../Toolbar'
import UserSidebarMenu from './UserSidebarMenu'
import { IndexLoaderData } from '../Router'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import styles from './AppHeader.module.css'
import { NetworkHealthIndicator } from './NetworkHealthIndicator'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { ActionButton } from './ActionButton'

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
  const { setCommandBarOpen } = useCommandsContext()
  const { auth } = useGlobalStateContext()
  const user = auth?.context?.user

  return (
    <header
      className={
        'w-full grid ' +
        styles.header +
        ' overlaid-panes sticky top-0 z-20 py-1 px-5 bg-chalkboard-10/70 dark:bg-chalkboard-100/50 border-b dark:border-b-2 border-chalkboard-30 dark:border-chalkboard-90 items-center ' +
        className
      }
    >
      <ProjectSidebarMenu
        renderAsLink={!enableMenu}
        project={project?.project}
        file={project?.file}
      />
      {/* Toolbar if the context deems it */}
      <div className="flex-grow flex justify-center max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-4xl 2xl:max-w-5xl">
        {showToolbar ? (
          <Toolbar />
        ) : (
          <ActionButton
            Element="button"
            onClick={() => setCommandBarOpen(true)}
            className="text-sm self-center flex items-center w-fit gap-3"
          >
            Command Palette{' '}
            <kbd className="bg-energy-10/50 dark:bg-chalkboard-100 dark:text-energy-10 inline-block px-1 py-0.5 border-energy-10 dark:border-chalkboard-90">
              ⌘K
            </kbd>
          </ActionButton>
        )}
      </div>
      <div className="flex items-center gap-1 ml-auto">
        {/* If there are children, show them, otherwise show User menu */}
        {children || (
          <>
            <NetworkHealthIndicator />
            <UserSidebarMenu user={user} />
          </>
        )}
      </div>
    </header>
  )
}
