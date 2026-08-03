import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { HomeSidebarItemProps } from '@src/registry/contracts/homeSidebar'
import type { ProjectExplorerProjectMenuItemComponentProps } from '@src/registry/contracts/projectExplorer'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'
import type { MouseEventHandler } from 'react'

function GetDesktopAppLink({
  className,
  testId,
  onMouseUp,
  showIcon = false,
}: {
  className: string
  testId: string
  onMouseUp?: MouseEventHandler<HTMLAnchorElement>
  showIcon?: boolean
}) {
  return (
    <ActionButton
      Element="externalLink"
      to={withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)}
      className={className}
      aria-label="Get desktop app"
      data-testid={testId}
      onMouseUp={onMouseUp}
    >
      {showIcon ? (
        <CustomIcon name="download" className="h-5 w-5 flex-none" />
      ) : null}
      <span className="flex-1">Get desktop app</span>
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
