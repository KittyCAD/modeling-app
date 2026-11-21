import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import { ProjectNavigation } from '@src/components/ProjectNavigation'
import { ProjectSessionMenu } from '@src/components/ProjectSessionMenu'
import UserSidebarMenu from '@src/components/UserSidebarMenu'
import { APP_NAME } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import { type AppHeaderItemProps } from '@src/registry/contracts/appHeader'

export function ProjectHeaderItem({ app, context }: AppHeaderItemProps) {
  switch (context.type) {
    case 'project':
      return <ProjectSessionMenu app={app} session={context.session} />
    case 'legacy-project':
      return (
        <ProjectSidebarMenu app={app} enableMenu {...context}>
          {context.projectMenuChildren}
        </ProjectSidebarMenu>
      )
    case 'home':
      return (
        <div className="flex items-stretch gap-2">
          <ProjectNavigation />
          <span className="hidden self-center px-2 text-sm lg:block">
            {APP_NAME}
          </span>
        </div>
      )
  }
}

export function AccountHeaderItem({ app, context }: AppHeaderItemProps) {
  const user = app.auth.useUser()
  return (
    <UserSidebarMenu
      user={user}
      fileOperations={app.fileOperations}
      onSignOut={() => app.auth.send({ type: 'Log out' })}
      onSignOutAll={() => app.auth.send({ type: 'Log out all' })}
      settingsBasePath={
        context.type === 'legacy-project'
          ? (context.absoluteFilePath ?? PATHS.HOME)
          : PATHS.HOME
      }
    />
  )
}
