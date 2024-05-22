import { useCommandsContext } from 'hooks/useCommandsContext'
import usePlatform from 'hooks/usePlatform'

export function CommandBarOpenButton() {
  const { commandBarSend } = useCommandsContext()
  const platform = usePlatform()

  return (
    <button
      className="group rounded-full flex items-center justify-center gap-2 px-2 py-1 bg-primary/10 dark:bg-chalkboard-90 dark:backdrop-blur-sm border-primary hover:border-primary dark:border-chalkboard-50 dark:hover:border-inherit text-primary dark:text-inherit"
      onClick={() => commandBarSend({ type: 'Open' })}
    >
      <span>Commands</span>
      <kbd className="bg-primary/10 dark:bg-chalkboard-80 dark:group-hover:bg-primary font-mono rounded-sm dark:text-inherit inline-block px-1 border-primary dark:border-chalkboard-90">
        {platform === 'macos' ? '⌘K' : '^/'}
      </kbd>
    </button>
  )
}
