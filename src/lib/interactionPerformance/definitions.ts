import type { InteractionDefinition } from '@src/lib/interactionPerformance/types'

export const COMMAND_PALETTE_OPEN_INTERACTION = 'zds.commandPalette.open'
export const COMMAND_PALETTE_CLOSE_INTERACTION = 'zds.commandPalette.close'

// These endpoints describe the rendered outcome, including the normal UI
// transition. Unknown controls are still recorded, without claiming completion.
export const interactionDefinitions: readonly InteractionDefinition[] = [
  {
    id: COMMAND_PALETTE_OPEN_INTERACTION,
    outcome:
      'Command search is visible and enabled; its opening transition ended',
    isReady(document) {
      const panel = document.querySelector(
        '[data-testid="command-bar-wrapper"]'
      )
      const input = panel?.querySelector('input[role="combobox"]')
      return Boolean(
        input instanceof HTMLInputElement &&
          !input.disabled &&
          input.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          !panel
            ?.getAnimations({ subtree: true })
            .some((animation) => animation.playState === 'running')
      )
    },
  },
  {
    id: COMMAND_PALETTE_CLOSE_INTERACTION,
    outcome: 'Command palette is no longer rendered',
    isReady(document) {
      const panel = document.querySelector(
        '[data-testid="command-bar-wrapper"]'
      )
      return !panel || !panel.checkVisibility({ checkVisibilityCSS: true })
    },
  },
]
