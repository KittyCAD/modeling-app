import { interactions } from '@src/lib/interactionPerformance/definitions'
import type { InteractionDefinition } from '@src/lib/interactionPerformance/types'

// These endpoints include normal UI transitions. Unknown controls are recorded
// without claiming completion.
export const interactionOutcomes = {
  commandPaletteOpen: {
    ...interactions.commandPaletteOpen,
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
  commandPaletteClose: {
    ...interactions.commandPaletteClose,
    isReady(document) {
      const panel = document.querySelector(
        '[data-testid="command-bar-wrapper"]'
      )
      return !panel || !panel.checkVisibility({ checkVisibilityCSS: true })
    },
  },
} satisfies Record<keyof typeof interactions, InteractionDefinition>
