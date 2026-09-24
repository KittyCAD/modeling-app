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
  codePaneOpen: {
    id: 'zds.codePane.open',
    testId: 'code-pane-button',
    budgetMs: 150,
    outcome:
      'Code editor content is visible and editable; its opening transitions ended',
  },
  codePaneClose: {
    id: 'zds.codePane.close',
    testId: 'code-pane-button',
    budgetMs: 150,
    outcome: 'Code editor pane is no longer rendered',
  },
  filesPaneOpen: {
    id: 'zds.filesPane.open',
    testId: 'files-pane-button',
    budgetMs: 150,
    outcome:
      'Project file list has visible, enabled entries; its opening transitions ended',
  },
  filesPaneClose: {
    id: 'zds.filesPane.close',
    testId: 'files-pane-button',
    budgetMs: 150,
    outcome: 'Project files pane is no longer rendered',
  },
} satisfies Record<string, InteractionDescription>
