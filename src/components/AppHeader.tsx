import { Link } from 'react-router-dom'
import { Toolbar } from '../Toolbar'
import { useStore } from '../useStore'
import UserSidebarMenu from './UserSidebarMenu'
import { paths } from '../Router'
import { isTauri } from '../lib/isTauri'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
  filename?: string
  className?: string
}

export const AppHeader = ({
  showToolbar = true,
  filename = '',
  children,
  className = '',
}: AppHeaderProps) => {
  const { user } = useStore((s) => ({
    user: s.user,
  }))

  return (
    <header
      className={
        'overlaid-panes sticky top-0 z-20 py-1 px-5 bg-chalkboard-10/50 dark:bg-chalkboard-100/50 border-b dark:border-b-2 border-chalkboard-30 dark:border-chalkboard-90 flex justify-between items-center ' +
        className
      }
    >
      <Link
        to={isTauri() ? paths.HOME : paths.INDEX}
        className="flex items-center gap-4"
      >
        <img
          src="/kitt-arcade-winking.svg"
          alt="KittyCAD App"
          className="h-9 w-auto"
        />
        <span className="text-sm text-chalkboard-110 dark:text-chalkboard-20 min-w-max">
          {isTauri() && filename ? filename : 'KittyCAD Modeling App'}
        </span>
      </Link>
      {/* Toolbar if the context deems it */}
      {showToolbar && (
        <div className="max-w-4xl">
          <Toolbar />
        </div>
      )}
      {/* If there are children, show them, otherwise show User menu */}
      {children || <UserSidebarMenu user={user} />}
    </header>
  )
}
