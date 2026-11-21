import { Logo } from '@src/components/Logo'
import Tooltip from '@src/components/Tooltip'
import { PATHS } from '@src/lib/paths'
import { Link } from 'react-router-dom'

export function ProjectNavigation({
  onHomeNavigate,
}: {
  onHomeNavigate?: () => void
}) {
  return (
    <div className="relative group/home shrink-0 [-webkit-app-region:no-drag]">
      <Link
        to={PATHS.HOME}
        onClick={onHomeNavigate}
        aria-label="Projects"
        data-testid="app-logo"
        className="cursor-pointer relative group-hover/home:before:outline h-full grid flex-none place-content-center group p-1.5 before:block before:content-[''] before:absolute before:inset-0 before:bottom-1 before:z-[-1] before:bg-primary before:rounded-b-sm hover:hue-rotate-0 dark:hover:brightness-100 hover:before:drop-shadow-tab-sm"
      >
        <Logo data-onboarding-id="app-logo" className="h-4 w-auto text-white" />
      </Link>
      <Tooltip position="bottom-left">Go home</Tooltip>
    </div>
  )
}
