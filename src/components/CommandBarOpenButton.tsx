import { COMMAND_PALETTE_HOTKEY } from '@src/components/CommandBar/CommandBar'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { CustomIcon } from '@src/components/CustomIcon'

export function CommandBarOpenButton() {
  const platform = usePlatform()

  return (
    <button
      type="button"
      className="flex gap-1 items-center py-0 px-0.5 m-0 text-primary dark:text-inherit bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 border border-solid border-primary/50 hover:border-primary active:border-primary"
      onClick={() => commandBarActor.send({ type: 'Open' })}
      data-testid="command-bar-open-button"
    >
      <CustomIcon name="command" className="w-5 h-5" />
      <span>Commands</span>
      <kbd className="dark:bg-chalkboard-80 font-mono rounded-sm text-primary/70 dark:text-inherit inline-block px-1">
        {hotkeyDisplay(COMMAND_PALETTE_HOTKEY, platform)}
      </kbd>
    </button>
  )
}
