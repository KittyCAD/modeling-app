import { Toolbar } from '../Toolbar'
import UserSidebarMenu from './UserSidebarMenu'
import { type IndexLoaderData } from 'lib/types'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import styles from './AppHeader.module.css'
import { NetworkHealthIndicator } from './NetworkHealthIndicator'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { ActionButton } from './ActionButton'
import usePlatform from 'hooks/usePlatform'

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
  const platform = usePlatform()
  const { commandBarSend } = useCommandsContext()
  const { auth } = useSettingsAuthContext()
  const user = auth?.context?.user

  return (
    <header
      className={
        'w-full grid ' +
        styles.header +
        ' overlaid-panes sticky top-0 z-20 px-2 items-center ' +
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
            onClick={() => commandBarSend({ type: 'Open' })}
            className="text-sm self-center flex items-center w-fit gap-3"
          >
            Command Palette{' '}
            <kbd className="bg-primary/10 dark:bg-chalkboard-100 dark:text-primary inline-block px-1 py-0.5 border-primary dark:border-chalkboard-90">
              {platform === 'macos' ? '⌘K' : 'Ctrl+/'}
            </kbd>
          </ActionButton>
        )}
      </div>
      <div className="flex items-center gap-1 py-1 ml-auto">
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
