import { Link } from 'react-router-dom'
import { Toolbar } from '../Toolbar'
import { useStore } from '../useStore'
import UserSidebarMenu from './UserSidebarMenu'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
}

export const AppHeader = ({ showToolbar = true, children }: AppHeaderProps) => {
  const { user } = useStore((s) => ({
    user: s.user,
  }))

  return (
    <header className="py-1 px-5 bg-chalkboard-10 border-b border-chalkboard-30 flex justify-between items-center">
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
