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
        className="relative grid h-full place-content-center bg-primary p-1.5 text-white"
      >
        <Logo data-onboarding-id="app-logo" className="h-4 w-auto" />
      </Link>
      <Tooltip position="bottom-left">Go home</Tooltip>
    </div>
  )
}
