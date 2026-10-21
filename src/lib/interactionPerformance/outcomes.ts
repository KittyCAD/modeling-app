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

export function isVisible(element: Element | null | undefined) {
  return Boolean(
    element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  )
}

export function transitionsEnded(element: Element | null | undefined) {
  return !element
    ?.getAnimations({ subtree: true })
    .some(
      (animation) =>
        animation instanceof CSSTransition && animation.playState === 'running'
    )
}

/** Ignore perpetual loading/caret effects, but include delayed finite effects. */
export function animationsEnded(element: Element | null | undefined) {
  return !element?.getAnimations({ subtree: true }).some((animation) => {
    const endTime = animation.effect?.getComputedTiming().endTime
    return (
      animation.playState !== 'finished' &&
      animation.playState !== 'idle' &&
      typeof endTime === 'number' &&
      Number.isFinite(endTime)
    )
  })
}

function firstSketchGroup(document: Document) {
  return document.querySelector(
    '#operations-list-pane [data-testid="operation-group-caret"]'
  )
}

function matchesSketchGroup(target: Element, expanded: boolean) {
  const control = target.closest('[data-testid="operation-group-caret"]')
  return Boolean(
    control &&
      control === firstSketchGroup(target.ownerDocument) &&
      control.getAttribute('aria-expanded') === String(expanded)
  )
}

const transformButtonSelector =
  '[data-testid="toolbar"] [data-onboarding-id="transform-dropdown-button"]'

function matchesTransformMenu(target: Element, expanded: boolean) {
  return (
    target.closest(transformButtonSelector)?.getAttribute('aria-expanded') ===
    String(expanded)
  )
}

const extrudeDialogSelector =
  '[data-testid="modeling-dialog"][aria-label="Extrude"]'

function extrudeDialog(document: Document) {
  return document.querySelector(extrudeDialogSelector)
}

function extrudeIsOpen(document: Document) {
  return (
    isVisible(extrudeDialog(document)) ||
    document
      .querySelector('[data-testid="command-name"]')
      ?.textContent?.trim() === 'Extrude'
  )
}

function visibleOperation(panel: Element | null, readOnly: boolean) {
  return isVisible(
    panel?.querySelector(
      `[data-testid="feature-tree-operation-item"] > button${readOnly ? '' : ':not(:disabled)'}`
    )
  )
}

function featureTreeReady(document: Document, readOnly = false) {
  const panel = document.querySelector('#operations-list-pane')
  return visibleOperation(panel, readOnly) && transitionsEnded(panel)
}

function sketchGroupReady(document: Document, readOnly = false) {
  const control = firstSketchGroup(document)
  const panelId = control?.getAttribute('aria-controls')
  const panel = panelId ? document.getElementById(panelId) : null
  return (
    control?.getAttribute('aria-expanded') === 'true' &&
    visibleOperation(panel, readOnly) &&
    transitionsEnded(panel)
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
      matchesControl(target, interactions.commandPaletteClose.testId) &&
      !extrudeIsOpen(target.ownerDocument),
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
  featureTreeOpen: {
    ...interactions.featureTreeOpen,
    matchesTarget: (target) =>
      matchesControl(target, interactions.featureTreeOpen.testId, false),
    isReady: featureTreeReady,
  },
  featureTreeClose: {
    ...interactions.featureTreeClose,
    matchesTarget: (target) =>
      matchesControl(target, interactions.featureTreeClose.testId, true),
    isReady(document) {
      return document.querySelector('#operations-list-pane') === null
    },
  },
  sketchGroupExpand: {
    ...interactions.sketchGroupExpand,
    matchesTarget: (target) => matchesSketchGroup(target, false),
    isReady: sketchGroupReady,
  },
  sketchGroupCollapse: {
    ...interactions.sketchGroupCollapse,
    matchesTarget: (target) => matchesSketchGroup(target, true),
    isReady(document) {
      const control = firstSketchGroup(document)
      // Headless UI removes aria-controls when the child panel unmounts.
      return (
        control?.getAttribute('aria-expanded') === 'false' &&
        !control.hasAttribute('aria-controls')
      )
    },
  },
  transformMenuOpen: {
    ...interactions.transformMenuOpen,
    matchesTarget: (target) => matchesTransformMenu(target, false),
    isReady(document) {
      return ['translate', 'rotate'].every((tool) =>
        isVisible(
          document.querySelector(`[data-testid="dropdown-${tool}"]:enabled`)
        )
      )
    },
  },
  transformMenuClose: {
    ...interactions.transformMenuClose,
    matchesTarget: (target) => matchesTransformMenu(target, true),
    isReady(document) {
      return (
        document
          .querySelector(transformButtonSelector)
          ?.getAttribute('aria-expanded') === 'false' &&
        ['translate', 'rotate'].every(
          (tool) =>
            !isVisible(
              document.querySelector(`[data-testid="dropdown-${tool}"]`)
            )
        )
      )
    },
  },
  extrudeOpen: {
    ...interactions.extrudeOpen,
    matchesTarget: (target) =>
      matchesControl(target, interactions.extrudeOpen.testId),
    isReady(document) {
      const panel = extrudeDialog(document)
      if (isVisible(panel)) {
        return (
          isVisible(
            panel?.querySelector('button[aria-label="Select Profiles"]:enabled')
          ) &&
          isVisible(
            panel?.querySelector('button[aria-label="Cancel"]:enabled')
          ) &&
          transitionsEnded(panel) &&
          animationsEnded(panel)
        )
      }
      const palette = document.querySelector(
        '[data-testid="command-bar-wrapper"]'
      )
      const input = palette?.querySelector('#arg-form input[name="selection"]')
      // The shipped modeling_dialogs feature selects one of these real UIs.
      // The palette's transparent input overlays its visible selection prompt.
      return (
        extrudeIsOpen(document) &&
        isVisible(palette) &&
        input instanceof HTMLInputElement &&
        !input.disabled &&
        isVisible(input.closest('label')) &&
        isVisible(
          palette?.querySelector(
            '[data-testid="command-bar-close-button"]:enabled'
          )
        ) &&
        transitionsEnded(palette) &&
        animationsEnded(palette)
      )
    },
  },
  extrudeCancel: {
    ...interactions.extrudeCancel,
    matchesTarget: (target) =>
      Boolean(
        target.closest(`${extrudeDialogSelector} button[aria-label="Cancel"]`)
      ) ||
      (matchesControl(target, interactions.commandPaletteClose.testId) &&
        extrudeIsOpen(target.ownerDocument)),
    isReady(document) {
      return (
        extrudeDialog(document) === null &&
        document.querySelector('[data-testid="command-bar-wrapper"]') === null
      )
    },
  },
} satisfies Record<keyof typeof interactions, InteractionDefinition>

export function createInteractionOutcomes(hasParseErrors: () => boolean) {
  return {
    ...interactionOutcomes,
    featureTreeOpen: {
      ...interactionOutcomes.featureTreeOpen,
      isReady: (document: Document) =>
        featureTreeReady(document, hasParseErrors()),
    },
    sketchGroupExpand: {
      ...interactionOutcomes.sketchGroupExpand,
      isReady: (document: Document) =>
        sketchGroupReady(document, hasParseErrors()),
    },
  }
}
