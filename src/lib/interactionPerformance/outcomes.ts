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
  codePaneOpen: {
    ...interactions.codePaneOpen,
    isReady(document) {
      const panel = document.querySelector('#code-pane')
      const content = panel?.querySelector('.cm-content')
      return Boolean(
        content instanceof HTMLElement &&
          content.isContentEditable &&
          content.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          // Caret animations must not keep a usable editor pending.
          !panel
            ?.getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation instanceof CSSTransition &&
                animation.playState === 'running'
            )
      )
    },
  },
  codePaneClose: {
    ...interactions.codePaneClose,
    isReady(document) {
      return document.querySelector('#code-pane') === null
    },
  },
  filesPaneOpen: {
    ...interactions.filesPaneOpen,
    isReady(document) {
      const panel = document.querySelector('#files-pane')
      const content = panel?.querySelector(
        '[data-testid="file-pane-scroll-container"]'
      )
      const entry = content?.querySelector(
        '[role="treeitem"][aria-disabled="false"]'
      )
      return Boolean(
        content instanceof HTMLElement &&
          entry instanceof HTMLElement &&
          content.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          entry.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          !panel
            ?.getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation instanceof CSSTransition &&
                animation.playState === 'running'
            )
      )
    },
  },
  filesPaneClose: {
    ...interactions.filesPaneClose,
    isReady(document) {
      return document.querySelector('#files-pane') === null
    },
  },
} satisfies Record<keyof typeof interactions, InteractionDefinition>
