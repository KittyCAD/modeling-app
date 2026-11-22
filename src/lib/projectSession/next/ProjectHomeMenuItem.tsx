import { ActionButton } from '@src/components/ActionButton'
import { PATHS } from '@src/lib/paths'
import type { ProjectMenuItemProps } from '@src/lib/projectSession/next/projectMenu'

export function ProjectHomeMenuItem({
  className,
  close,
}: ProjectMenuItemProps) {
  return (
    <li className="contents">
      <ActionButton
        Element="link"
        to={PATHS.HOME}
        tabIndex={0}
        className={className}
        onClick={() => close()}
      >
        Go to Home
      </ActionButton>
    </li>
  )
}
