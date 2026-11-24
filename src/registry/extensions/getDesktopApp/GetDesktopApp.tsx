import { ActionButton } from '@src/components/ActionButton'
import { getDesktopHandoffUrl } from '@src/lib/browserHandoff'
import { PATHS } from '@src/lib/routePaths'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { HomeSidebarItemProps } from '@src/registry/contracts/homeSidebar'
import type { ProjectExplorerProjectMenuItemComponentProps } from '@src/registry/contracts/projectExplorer'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'

const downloadIcon = {
  icon: 'download' as const,
  bgClassName: '!bg-transparent rounded-sm',
}

function GetDesktopAppLink({
  className,
  testId,
  onMouseUp,
  showIcon = false,
}: {
  className: string
  testId: string
  onMouseUp?: () => void
  showIcon?: boolean
}) {
  return (
    <ActionButton
      Element="externalLink"
      to={withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)}
      className={className}
      iconStart={showIcon ? downloadIcon : undefined}
      aria-label="Get desktop app"
      data-testid={testId}
      onMouseUp={onMouseUp}
    >
      <span className="min-w-0 flex-1 truncate">Get desktop app</span>
    </ActionButton>
  )
}

export function HomeGetDesktopApp({ className }: HomeSidebarItemProps) {
  return (
    <GetDesktopAppLink
      className={className}
      testId="home-get-desktop-app"
      showIcon
    />
  )
}

export function ProjectMenuGetDesktopApp({
  className,
  close,
}: ProjectExplorerProjectMenuItemComponentProps) {
  return (
    <li className="contents">
      <GetDesktopAppLink
        className={className}
        testId="project-menu-get-desktop-app"
        onMouseUp={close}
      />
    </li>
  )
}

export function ProjectMenuOpenInDesktopApp({
  context: { project },
  className,
  close,
}: ProjectExplorerProjectMenuItemComponentProps) {
  const id = project.cloudProjectId
  if (!id) return null

  return (
    <li className="contents">
      <ActionButton
        Element="button"
        className={className}
        onClick={() => {
          window.location.href = getDesktopHandoffUrl(
            new URL(`${PATHS.PROJECT}/${id}`, window.location.origin)
          )
          close()
        }}
      >
        <span className="min-w-0 flex-1 truncate">Open in desktop app</span>
      </ActionButton>
    </li>
  )
}
