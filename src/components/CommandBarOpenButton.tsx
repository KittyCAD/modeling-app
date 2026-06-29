import { useSignals } from '@preact/signals-react/runtime'
import {
  COMMAND_PALETTE_HOTKEY,
  COMMAND_PALETTE_OPEN_COMMAND_ID,
} from '@src/components/CommandBar/constants'
import { CustomIcon } from '@src/components/CustomIcon'
import usePlatform from '@src/hooks/usePlatform'
import type { App } from '@src/lib/app'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { memo } from 'react'

type CommandBarOpenButtonProps = {
  app: App
}

export const CommandBarOpenButton = memo(function CommandBarOpenButton({
  app,
}: CommandBarOpenButtonProps) {
  useSignals()
  const platform = usePlatform()
  const { commands } = app
  const keymap = app.registry.optional(keymapService)
  const commandPaletteKeybinding = keymapKeystrokesDisplay(
    keymap
      ? findKeymapItemForCommand(
          keymap.keymap.value,
          COMMAND_PALETTE_OPEN_COMMAND_ID,
          keymap.getCurrentScopes(),
          app.registry.signal(keymapScopesValueSpec).value
        )?.keystrokes
      : [COMMAND_PALETTE_HOTKEY],
    platform
  )

  return (
    <button
      type="button"
      className="flex gap-1 items-center py-0 pl-0.5 pr-1 sm:pr-0.5 m-0 text-primary dark:text-inherit bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 border border-solid border-primary/50 hover:border-primary active:border-primary"
      onClick={() => commands.send({ type: 'Open' })}
      data-testid="command-bar-open-button"
      data-onboarding-id="command-bar-open-button"
    >
      <CustomIcon name="command" className="w-5 h-5" />
      <span>Commands</span>
      {commandPaletteKeybinding && (
        <kbd className="hidden sm:block dark:bg-chalkboard-80 font-mono rounded-sm text-primary/70 dark:text-inherit inline-block px-1">
          {commandPaletteKeybinding}
        </kbd>
      )}
    </button>
  )
})
