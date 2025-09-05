import { CommandBarOpenButton } from '@src/components/CommandBarOpenButton'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import UserSidebarMenu from '@src/components/UserSidebarMenu'
import { isDesktop } from '@src/lib/isDesktop'
import type { IndexLoaderData } from '@src/lib/types'
import { useUser } from '@src/lib/singletons'

import styles from './AppHeader.module.css'
import type { ReactNode } from 'react'

interface AppHeaderProps extends React.PropsWithChildren {
  project?: Omit<IndexLoaderData, 'code'>
  className?: string
  enableMenu?: boolean
  style?: React.CSSProperties
  nativeFileMenuCreated: boolean
  projectMenuChildren?: ReactNode
}

export const AppHeader = ({
  project,
  children,
  className = '',
  style,
  enableMenu = false,
  nativeFileMenuCreated,
  projectMenuChildren,
}: AppHeaderProps) => {
  const user = useUser()

  return (
    <header
      id="app-header"
      data-testid="app-header"
      className={`w-full flex ${styles.header || ''} ${
        isDesktop() ? styles.desktopApp : ''
      } overlaid-panes sticky top-0 z-20 px-2 justify-between ${className || ''} bg-chalkboard-10 dark:bg-chalkboard-90 border-b border-chalkboard-30 dark:border-chalkboard-70`}
      data-native-file-menu={nativeFileMenuCreated}
      style={style}
    >
      <ProjectSidebarMenu
        enableMenu={enableMenu}
        project={project?.project}
        file={project?.file}
      >
        {projectMenuChildren}
      </ProjectSidebarMenu>
      <div className="flex items-center gap-2 py-1.5 ml-auto">
        {/* If there are children, show them, otherwise show User menu */}
        {children || <CommandBarOpenButton />}
        <UserSidebarMenu user={user} />
      </div>
    </header>
  )
}
