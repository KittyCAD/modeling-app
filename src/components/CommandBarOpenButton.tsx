import { COMMAND_PALETTE_HOTKEY } from '@src/components/CommandBar/CommandBar'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { commandBarActor } from '@src/machines/commandBarMachine'

export function CommandBarOpenButton() {
  const { immediateState } = useNetworkContext()

  const platform = usePlatform()

  const isDisabled =
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished

  return (
    <button
      disabled={isDisabled}
      className="group rounded-full flex items-center justify-center gap-2 px-2 py-1 bg-primary/10 dark:bg-chalkboard-90 dark:backdrop-blur-sm border-primary hover:border-primary dark:border-chalkboard-50 dark:hover:border-inherit text-primary dark:text-inherit"
      onClick={() => commandBarActor.send({ type: 'Open' })}
      data-testid="command-bar-open-button"
    >
      <span>Commands</span>
      <kbd className="bg-primary/10 dark:bg-chalkboard-80 dark:group-hover:bg-primary font-mono rounded-sm dark:text-inherit inline-block px-1 border-primary dark:border-chalkboard-90">
        {hotkeyDisplay(COMMAND_PALETTE_HOTKEY, platform)}
      </kbd>
    </button>
  )
}
