import type { InteractionDescription } from '@src/lib/interactionPerformance/types'

export const interactions = {
  commandPaletteOpen: {
    id: 'zds.commandPalette.open',
    testId: 'command-bar-open-button',
    budgetMs: 150,
    outcome:
      'Command search is visible and enabled; its opening transition ended',
  },
  commandPaletteClose: {
    id: 'zds.commandPalette.close',
    testId: 'command-bar-close-button',
    budgetMs: 150,
    outcome: 'Command palette is no longer rendered',
  },
} satisfies Record<string, InteractionDescription>
