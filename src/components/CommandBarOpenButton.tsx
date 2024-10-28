import { useCommandsContext } from 'hooks/useCommandsContext'
import usePlatform from 'hooks/usePlatform'
import { hotkeyDisplay } from 'lib/hotkeyWrapper'
import { COMMAND_PALETTE_HOTKEY } from './CommandBar/CommandBar'
import { KEYBINDING_CATEGORIES } from 'lib/constants'
import { useMemo } from 'react'
import { useInteractionMapContext } from 'hooks/useInteractionMapContext'

export function CommandBarOpenButton() {
  const platform = usePlatform()
  const { commandBarSend } = useCommandsContext()
  const { state: interactionMapState } = useInteractionMapContext()

  const resolvedKeybinding = useMemo(
    () =>
      interactionMapState.context.overrides[
        `${KEYBINDING_CATEGORIES.COMMAND_BAR}.toggle`
      ] || COMMAND_PALETTE_HOTKEY,
    [interactionMapState.context.overrides]
  )

  return (
    <button
      className="group rounded-full flex items-center justify-center gap-2 px-2 py-1 bg-primary/10 dark:bg-chalkboard-90 dark:backdrop-blur-sm border-primary hover:border-primary dark:border-chalkboard-50 dark:hover:border-inherit text-primary dark:text-inherit"
      onClick={() => commandBarSend({ type: 'Open' })}
      data-testid="command-bar-open-button"
    >
      <span>Commands</span>
      <kbd className="bg-primary/10 dark:bg-chalkboard-80 dark:group-hover:bg-primary font-mono rounded-sm dark:text-inherit inline-block px-1 border-primary dark:border-chalkboard-90">
        {hotkeyDisplay(resolvedKeybinding, platform)}
      </kbd>
    </button>
  )
}
