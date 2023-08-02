import { Link } from 'react-router-dom'
import { Toolbar } from '../Toolbar'
import { useStore } from '../useStore'
import UserSidebarMenu from './UserSidebarMenu'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
  className?: string
}

export const AppHeader = ({
  showToolbar = true,
  children,
  className = '',
}: AppHeaderProps) => {
  const { user } = useStore((s) => ({
    user: s.user,
  }))

  return (
    <header
      className={
        'py-1 px-5 bg-chalkboard-10/50 dark:bg-chalkboard-100/50 border-b dark:border-b-2 border-chalkboard-30 dark:border-chalkboard-90 flex justify-between items-center ' +
        className
      }
    >
      <Link to="/">
        <img
          src="/kitt-arcade-winking.svg"
          alt="KittyCAD App"
          className="h-9 w-auto"
        />
        <span className="sr-only">KittyCAD App</span>
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
