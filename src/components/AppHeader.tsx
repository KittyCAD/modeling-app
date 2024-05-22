import { Toolbar } from '../Toolbar'
import UserSidebarMenu from 'components/UserSidebarMenu'
import { type IndexLoaderData } from 'lib/types'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import styles from './AppHeader.module.css'
import { RefreshButton } from 'components/RefreshButton'
import { CommandBarOpenButton } from './CommandBarOpenButton'

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
        enableMenu={enableMenu}
        project={project?.project}
        file={project?.file}
      />
      {/* Toolbar if the context deems it */}
      <div className="flex-grow flex justify-center max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-4xl 2xl:max-w-5xl">
        {showToolbar && <Toolbar />}
      </div>
      <div className="flex items-center gap-1 py-1 ml-auto">
        {/* If there are children, show them, otherwise show User menu */}
        {children || (
          <>
            <CommandBarOpenButton />
            <RefreshButton />
            <UserSidebarMenu user={user} />
          </>
        )}
      </div>
    </header>
  )
}
