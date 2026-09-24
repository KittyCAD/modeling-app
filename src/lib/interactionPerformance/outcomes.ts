import { interactions } from '@src/lib/interactionPerformance/definitions'
import type { InteractionDefinition } from '@src/lib/interactionPerformance/types'

function matchesControl(target: Element, testId: string, pressed?: boolean) {
  const control = target.closest(`[data-testid="${testId}"]`)
  return Boolean(
    control &&
      (pressed === undefined ||
        control.getAttribute('aria-pressed') === String(pressed))
  )
}

// These endpoints include normal UI transitions. Unknown controls are recorded
// without claiming completion.
export const interactionOutcomes = {
  commandPaletteOpen: {
    ...interactions.commandPaletteOpen,
    matchesTarget: (target) =>
      matchesControl(target, interactions.commandPaletteOpen.testId),
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
    matchesTarget: (target) =>
      matchesControl(target, interactions.commandPaletteClose.testId),
    isReady(document) {
      const panel = document.querySelector(
        '[data-testid="command-bar-wrapper"]'
      )
      return !panel || !panel.checkVisibility({ checkVisibilityCSS: true })
    },
  },
  codePaneOpen: {
    ...interactions.codePaneOpen,
    matchesTarget: (target) =>
      matchesControl(target, interactions.codePaneOpen.testId, false),
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
    matchesTarget: (target) =>
      matchesControl(target, interactions.codePaneClose.testId, true),
    isReady(document) {
      return document.querySelector('#code-pane') === null
    },
  },
  filesPaneOpen: {
    ...interactions.filesPaneOpen,
    matchesTarget: (target) =>
      matchesControl(target, interactions.filesPaneOpen.testId, false),
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
    matchesTarget: (target) =>
      matchesControl(target, interactions.filesPaneClose.testId, true),
    isReady(document) {
      return document.querySelector('#files-pane') === null
    },
  },
} satisfies Record<keyof typeof interactions, InteractionDefinition>
