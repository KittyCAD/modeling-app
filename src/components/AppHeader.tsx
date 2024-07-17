import { Toolbar } from '../Toolbar'
import UserSidebarMenu from 'components/UserSidebarMenu'
import { type IndexLoaderData } from 'lib/types'
import ProjectSidebarMenu, {
  AppLogoLink,
  ProjectMenuPopover,
} from './ProjectSidebarMenu'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import styles from './AppHeader.module.css'
import { RefreshButton } from 'components/RefreshButton'
import { CommandBarOpenButton } from './CommandBarOpenButton'
import { APP_NAME } from 'lib/constants'

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
      id="app-header"
      className={
        'w-full grid ' +
        styles.header +
        ' overlaid-panes sticky top-0 z-20 px-2 items-center ' +
        className
      }
    >
      <div className="!no-underline h-full mr-auto max-h-min min-h-12 min-w-max flex items-center gap-2">
        <AppLogoLink project={project?.project} file={project?.file} />
        <div className="flex items-center">
          <UserSidebarMenu user={user} />
          {enableMenu ? (
            <ProjectMenuPopover
              project={project?.project}
              file={project?.file}
            />
          ) : (
            <span
              className="hidden select-none cursor-default text-sm text-chalkboard-110 dark:text-chalkboard-20 whitespace-nowrap lg:block"
              data-testid="project-name"
            >
              {project?.project?.name ? project.project.name : APP_NAME}
            </span>
          )}
        </div>
      </div>
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
      </div>
    </header>
  )
}
