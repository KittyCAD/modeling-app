import { faGear } from '@fortawesome/free-solid-svg-icons'
import { Toolbar } from '../Toolbar'
import { ActionButton } from './ActionButton'

interface AppHeaderProps extends React.PropsWithChildren {
  showToolbar?: boolean
}

export const AppHeader = ({ showToolbar = true, children }: AppHeaderProps) => {
  return (
    <header className="py-1 px-5 bg-chalkboard-10 border-b border-chalkboard-30 flex justify-between items-center">
      <a href="/project-settings">
        <img
          src="/kitt-arcade-winking.svg"
          alt="KittyCAD App"
          className="h-9 w-auto"
        />
        <span className="sr-only">KittyCAD App</span>
      </a>
      {/* Toolbar if the context deems it */}
      {showToolbar && (
        <div className="max-w-4xl">
          <Toolbar />
        </div>
      )}
      {/* If there are children, show them, otherwise... */}
      {children || (
        // TODO: If signed out, show the token paste field

        // If signed in, show the account avatar
        <ActionButton as="link" icon={{ icon: faGear }} to="/settings">
          Settings
        </ActionButton>
      )}
    </header>
  )
}
