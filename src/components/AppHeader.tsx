import { useSignals } from '@preact/signals-react/runtime'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import UserSidebarMenu from '@src/components/UserSidebarMenu'
import { useApp } from '@src/lib/boot'
import { isDesktop } from '@src/lib/isDesktop'
import type { FileEntry, Project } from '@src/lib/project'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import type { ReactNode } from 'react'
import styles from './AppHeader.module.css'

interface AppHeaderProps extends React.PropsWithChildren {
  project?: Project
  file?: FileEntry
  className?: string
  enableMenu?: boolean
  style?: React.CSSProperties
  nativeFileMenuCreated: boolean
  projectMenuChildren?: ReactNode
}

export const AppHeader = ({
  project,
  file,
  children,
  className = '',
  style,
  enableMenu = false,
  nativeFileMenuCreated,
  projectMenuChildren,
}: AppHeaderProps) => {
  useSignals()
  const app = useApp()
  const { auth } = app
  const user = auth.useUser()
  const appHeaderItems = app.registry.signal(appHeaderItemsValueSpec).value
  const appHeaderItemClassName =
    'relative inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border border-chalkboard-30 bg-chalkboard-10/80 px-1 text-chalkboard-100 transition-colors hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/50 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 dark:hover:bg-chalkboard-100 focus-visible:outline-appForeground active:border-primary disabled:cursor-default disabled:opacity-70'

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
      <ProjectSidebarMenu enableMenu={enableMenu} project={project} file={file}>
        {projectMenuChildren}
      </ProjectSidebarMenu>
      <div className="flex items-center gap-2 py-1.5 ml-auto">
        {children ||
          appHeaderItems.map(({ id, Component }) => (
            <Component key={id} app={app} className={appHeaderItemClassName} />
          ))}
        <UserSidebarMenu user={user} />
      </div>
    </header>
  )
}
