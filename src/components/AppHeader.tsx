import { faGear } from '@fortawesome/free-solid-svg-icons'
import { Toolbar } from '../Toolbar'
import { ActionButton } from './ActionButton'

export const AppHeader = ({ children }: React.PropsWithChildren) => {
  return (
    <header className="py-1 px-5 bg-chalkboard-10 border-b border-chalkboard-30 flex justify-between items-center">
      <button onClick={() => alert('A project menu pane is coming soon!')}>
        <img
          src="/kitt-arcade-winking.svg"
          alt="KittyCAD App"
          className="h-9 w-auto"
        />
        <span className="sr-only">KittyCAD App</span>
      </button>
      {/* Toolbar if the context deems it */}
      <div className="max-w-4xl">
        <Toolbar />
      </div>
      {/* If there are children, show them, otherwise... */}
      {children || (
        // TODO: If signed out, show the token paste field

        // If signed in, show the account avatar
        <ActionButton icon={{ icon: faGear }}
          onClick={() => alert('An account menu pane is coming soon!')}>
          Settings
        </ActionButton>
      )}
    </header>
  )
}
