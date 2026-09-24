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
  featureTreeOpen: {
    id: 'zds.featureTree.open',
    testId: 'feature-tree-pane-button',
    budgetMs: 150,
    outcome: 'Feature tree has visible, enabled operations',
  },
  featureTreeClose: {
    id: 'zds.featureTree.close',
    testId: 'feature-tree-pane-button',
    budgetMs: 150,
    outcome: 'Feature tree pane is no longer rendered',
  },
  sketchGroupExpand: {
    id: 'zds.featureTree.sketchGroup.expand',
    testId: 'operation-group-caret',
    budgetMs: 150,
    outcome: 'The first sketch group has visible, enabled child operations',
  },
  sketchGroupCollapse: {
    id: 'zds.featureTree.sketchGroup.collapse',
    testId: 'operation-group-caret',
    budgetMs: 150,
    outcome:
      'The first sketch group is collapsed and its children are unmounted',
  },
  transformMenuOpen: {
    id: 'zds.toolbar.transformMenu.open',
    testId: 'toolbar',
    budgetMs: 150,
    outcome: 'Transform menu has visible, enabled Translate and Rotate tools',
  },
  transformMenuClose: {
    id: 'zds.toolbar.transformMenu.close',
    testId: 'toolbar',
    budgetMs: 150,
    outcome: 'Transform menu and its tools are no longer visible',
  },
  extrudeOpen: {
    id: 'zds.toolbar.extrude.open',
    testId: 'extrude',
    budgetMs: 150,
    outcome:
      'Extrude has a visible selection prompt and enabled selection input',
  },
  extrudeCancel: {
    id: 'zds.toolbar.extrude.cancel',
    testId: 'command-bar-close-button',
    budgetMs: 150,
    outcome: 'Extrude command palette is no longer rendered',
  },
} satisfies Record<string, InteractionDescription>
