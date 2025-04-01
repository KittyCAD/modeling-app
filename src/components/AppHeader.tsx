import { RefreshButton } from 'components/RefreshButton'
import UserSidebarMenu from 'components/UserSidebarMenu'
import { isDesktop } from 'lib/isDesktop'
import { type IndexLoaderData } from 'lib/types'
import { useUser } from 'machines/appMachine'

import { Toolbar } from '../Toolbar'
import styles from './AppHeader.module.css'
import { CommandBarOpenButton } from './CommandBarOpenButton'
import ProjectSidebarMenu from './ProjectSidebarMenu'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
  project?: Omit<IndexLoaderData, 'code'>
  className?: string
  enableMenu?: boolean
  style?: React.CSSProperties
}

export const AppHeader = ({
  showToolbar = true,
  project,
  children,
  className = '',
  style,
  enableMenu = false,
}: AppHeaderProps) => {
  const user = useUser()

  return (
    <header
      id="app-header"
      className={
        'w-full grid ' +
        styles.header +
        ` ${
          isDesktop() ? styles.desktopApp + ' ' : ''
        }overlaid-panes sticky top-0 z-20 px-2 items-start ` +
        className
      }
      style={style}
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
          </>
        )}
        <UserSidebarMenu user={user} />
      </div>
    </header>
  )
}
