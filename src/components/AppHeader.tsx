import { Toolbar } from '@src/Toolbar'
import { CommandBarOpenButton } from '@src/components/CommandBarOpenButton'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import UserSidebarMenu from '@src/components/UserSidebarMenu'
import { isDesktop } from '@src/lib/isDesktop'
import { type IndexLoaderData } from '@src/lib/types'
import { useUser } from '@src/lib/singletons'
import { LOCAL_STORAGE_TEMPORARY_WORKSPACE } from '@src/lib/constants'

import styles from './AppHeader.module.css'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
  project?: Omit<IndexLoaderData, 'code'>
  className?: string
  enableMenu?: boolean
  style?: React.CSSProperties
  nativeFileMenuCreated: boolean
}

export const AppHeader = ({
  showToolbar = true,
  project,
  children,
  className = '',
  style,
  enableMenu = false,
  nativeFileMenuCreated,
}: AppHeaderProps) => {
  const user = useUser()
  const isInTemporaryWorkspace = Boolean(
    localStorage.getItem(LOCAL_STORAGE_TEMPORARY_WORKSPACE)
  )

  return (
    <header
      id="app-header"
      data-testid="app-header"
      className={
        'w-full grid ' +
        styles.header +
        ` ${
          isDesktop() ? styles.desktopApp + ' ' : ''
        }overlaid-panes sticky top-0 z-20 px-2 items-start ` +
        className
      }
      data-native-file-menu={nativeFileMenuCreated}
      style={style}
    >
      <ProjectSidebarMenu
        enableMenu={enableMenu}
        project={project?.project}
        file={project?.file}
      />
      {/* Toolbar if the context deems it */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex-grow flex justify-center max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-4xl 2xl:max-w-5xl">
          {showToolbar && <Toolbar />}
        </div>
        {isInTemporaryWorkspace && (
          <div className="animate-pulse w-fit uppercase text-xs rounded-full ml-2 px-2 py-1 border border-chalkboard-40 dark:text-chalkboard-40">
            Temporary workspace
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 py-1 ml-auto">
        {/* If there are children, show them, otherwise show User menu */}
        {children || <CommandBarOpenButton />}
        <UserSidebarMenu user={user} />
      </div>
    </header>
  )
}
