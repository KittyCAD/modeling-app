import type { InteractionDefinition } from '@src/lib/interactionPerformance/types'

// These endpoints describe the rendered outcome, including the normal UI
// transition. Unknown controls are still recorded, without claiming completion.
export const interactions = {
  commandPaletteOpen: {
    id: 'zds.commandPalette.open',
    testId: 'command-bar-open-button',
    budgetMs: 150,
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
  commandPaletteClose: {
    id: 'zds.commandPalette.close',
    testId: 'command-bar-close-button',
    budgetMs: 150,
    outcome: 'Command palette is no longer rendered',
    isReady(document) {
      const panel = document.querySelector(
        '[data-testid="command-bar-wrapper"]'
      )
      return !panel || !panel.checkVisibility({ checkVisibilityCSS: true })
    },
  },
} satisfies Record<string, InteractionDefinition>

export const interactionDefinitions: readonly InteractionDefinition[] =
  Object.values(interactions)
