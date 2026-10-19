import type { KclManager } from '@src/lang/KclManager'
import {
  animationsEnded,
  isVisible,
  transitionsEnded,
} from '@src/lib/interactionPerformance/outcomes'
import type {
  InteractionDefinition,
  InteractionDescription,
} from '@src/lib/interactionPerformance/types'

export const uiInteractions = {
  convertVariableOpen: {
    id: 'zds.variable.open',
    testId: 'create-new-variable',
    budgetMs: 150,
    outcome: 'Convert-to-variable dialog and backdrop finished opening',
  },
  convertVariableClose: {
    id: 'zds.variable.close',
    testId: 'create-new-variable',
    budgetMs: 150,
    outcome: 'Convert-to-variable dialog finished closing',
  },
  settingsOpen: {
    id: 'zds.settings.open',
    testId: 'user-settings',
    budgetMs: 150,
    outcome: 'Settings panel and backdrop finished opening',
  },
  settingsClose: {
    id: 'zds.settings.close',
    testId: 'settings-close-button',
    budgetMs: 150,
    outcome: 'Settings dialog is no longer visible after closing',
  },
  modelSettingsOpen: {
    id: 'zds.settings.modeling.open',
    testId: 'user-settings',
    budgetMs: 150,
    outcome:
      'Settings and backdrop finished opening over the executed model profile',
  },
  modelSettingsClose: {
    id: 'zds.settings.modeling.close',
    testId: 'settings-close-button',
    budgetMs: 150,
    outcome: 'Settings finished closing over the executed model profile',
  },
  telemetryOpen: {
    id: 'zds.telemetry.open',
    testId: 'telemetry-dialog',
    budgetMs: 150,
    outcome: 'Telemetry backdrop transition finished after its native start',
  },
  browserHandoffOpen: {
    id: 'zds.browserHandoff.open',
    testId: 'continue-to-web-app-button',
    budgetMs: 150,
    outcome: 'Browser desktop-handoff screen finished its opening transition',
  },
  paneBadgeHover: {
    id: 'zds.paneBadge.hover',
    testId: 'code-badge',
    budgetMs: 150,
    outcome: 'Code diagnostic badge finished its hover enlargement',
  },
  toastEnter: {
    id: 'zds.toast.enter',
    testId: 'toast',
    budgetMs: 150,
    outcome: 'Toast entrance animation finished after its native start',
  },
  toastExit: {
    id: 'zds.toast.exit',
    testId: 'toast',
    budgetMs: 150,
    outcome: 'Toast exit animation finished, excluding its display lifetime',
  },
  toastStack: {
    id: 'zds.toast.stack',
    testId: 'toast',
    budgetMs: 150,
    outcome: 'Existing toast finished repositioning after the stack changed',
  },
  toastSuccessIcon: {
    id: 'zds.toast.successIcon',
    testId: 'toast',
    budgetMs: 150,
    outcome: 'Success icon and checkmark animations finished, including delay',
  },
  toastErrorIcon: {
    id: 'zds.toast.errorIcon',
    testId: 'toast',
    budgetMs: 150,
    outcome: 'Error icon and cross animations finished, including delay',
  },
  toastCustomIcon: {
    id: 'zds.toast.customIcon',
    testId: 'toast',
    budgetMs: 150,
    outcome: 'Custom string toast icon finished animating, including delay',
  },
  zookeeperInfoFade: {
    id: 'zds.zookeeper.infoFade',
    testId: 'ml-response-info-chat-bubble',
    budgetMs: 150,
    outcome: 'Streamed Zookeeper info text finished fading in, including delay',
  },
  loadingCountdownFade: {
    id: 'zds.loading.countdownFade',
    testId: 'loading-engine',
    budgetMs: 150,
    outcome: 'Connection retry countdown finished fading out',
  },
  featureTreeTooltip: {
    id: 'zds.featureTree.tooltip',
    testId: 'feature-tree-operation-item',
    budgetMs: 150,
    outcome:
      'Hovered feature-tree tooltip is visible and its transitions ended',
  },
} satisfies Record<string, InteractionDescription>

function variableDialog(document: Document) {
  return document
    .querySelector('#create-new-variable')
    ?.closest('[role="dialog"]')
}

function settingsDialog(document: Document) {
  return document
    .querySelector('[data-testid="settings-dialog-panel"]')
    ?.closest('[role="dialog"]')
}

function telemetryDialog(document: Document) {
  return Array.from(document.querySelectorAll('[role="dialog"]')).find(
    (dialog) => dialog.querySelector('h1')?.textContent === 'Telemetry'
  )
}

function settled(element: Element | null | undefined) {
  return isVisible(element) && transitionsEnded(element ?? null)
}

/** Also covers Headless UI's enterFrom frames before a transition exists. */
export function dialogOpeningFinished(dialog: Element | null | undefined) {
  if (!dialog) return false
  const entered = (element: Element | null) => {
    if (
      !element?.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      })
    ) {
      return false
    }
    const style = getComputedStyle(element)
    return (
      Number(style.opacity) === 1 &&
      (style.transform === 'none' ||
        new DOMMatrixReadOnly(style.transform).isIdentity)
    )
  }
  const panel = dialog.querySelector('[id^="headlessui-dialog-panel-"]')
  const backdrop = dialog.querySelector('[aria-hidden="true"].fixed.inset-0')
  return (
    entered(panel) &&
    entered(backdrop) &&
    dialog.getAnimations({ subtree: true }).every((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime
      return (
        endTime === Infinity ||
        animation.playState === 'finished' ||
        animation.playState === 'idle'
      )
    })
  )
}

function enters(target: Element, event: Event) {
  return (
    event instanceof PointerEvent &&
    (!(event.relatedTarget instanceof Node) ||
      !target.contains(event.relatedTarget))
  )
}

const toastWrapperSelector = '[data-rht-toaster] > div'
const toastBarSelector = `${toastWrapperSelector} > div`

function toastBar(target: Element) {
  return target.closest(toastBarSelector)
}

function toastIsVisible(target: Element) {
  // The library gives only active toast wrappers a class. Dismissed wrappers
  // remain mounted while their bar plays its exit animation.
  return Boolean(toastBar(target)?.parentElement?.classList.length)
}

function statusIcon(target: Element) {
  const bar = toastBar(target)
  return Boolean(
    bar && target.parentElement?.parentElement?.parentElement === bar
  )
}

function errorIcon(target: Element) {
  return (
    statusIcon(target) &&
    getComputedStyle(target, '::before').content !== 'none'
  )
}

function startsElementAnimation(event: Event) {
  // Pseudo-element animation events have the same target as the icon circle;
  // keep one sample per icon, not one per stroke.
  return event instanceof AnimationEvent && event.pseudoElement === ''
}

function animationOutcome(target: Element) {
  return () => target.isConnected && animationsEnded(target)
}

function ownAnimationOutcome(target: Element, event: Event) {
  const name = event instanceof AnimationEvent ? event.animationName : undefined
  return () =>
    !target.isConnected ||
    target
      .getAnimations()
      .every(
        (animation) =>
          !(animation instanceof CSSAnimation) ||
          animation.animationName !== name ||
          animation.playState === 'finished' ||
          animation.playState === 'idle'
      )
}

export function createUiOutcomes(
  getEditor: () => KclManager | undefined
): InteractionDefinition[] {
  const settingsOpen = {
    matchesTarget: (target: Element) =>
      Boolean(target.closest('[data-testid="user-settings"]')),
    isReady: (document: Document) =>
      dialogOpeningFinished(settingsDialog(document)),
  }
  const settingsClose = {
    matchesTarget: (target: Element) =>
      Boolean(target.closest('[data-testid="settings-close-button"]')) &&
      Boolean(settingsDialog(target.ownerDocument)?.contains(target)),
    prepareOutcome(document: Document) {
      const dialog = settingsDialog(document)
      return () => !dialog?.isConnected || !isVisible(dialog)
    },
    isReady: (document: Document) => !isVisible(settingsDialog(document)),
  }
  return [
    {
      ...uiInteractions.convertVariableOpen,
      matchesTarget: (target) =>
        getEditor() !== undefined &&
        target
          .closest('button')
          ?.textContent?.includes('Convert to Variable') === true,
      isReady: (document) => dialogOpeningFinished(variableDialog(document)),
    },
    {
      ...uiInteractions.convertVariableClose,
      matchesTarget: (target) =>
        target.closest('button')?.textContent?.trim() === 'Cancel' &&
        Boolean(variableDialog(target.ownerDocument)?.contains(target)),
      prepareOutcome(document) {
        const dialog = variableDialog(document)
        return () => !dialog?.isConnected || !isVisible(dialog)
      },
      isReady: (document) => !isVisible(variableDialog(document)),
    },
    {
      ...uiInteractions.settingsOpen,
      ...settingsOpen,
    },
    {
      ...uiInteractions.settingsClose,
      ...settingsClose,
    },
    {
      ...uiInteractions.modelSettingsOpen,
      ...settingsOpen,
    },
    {
      ...uiInteractions.modelSettingsClose,
      ...settingsClose,
    },
    {
      ...uiInteractions.telemetryOpen,
      events: ['transitionstart'],
      matchesTarget: (target) =>
        target.getAttribute('aria-hidden') === 'true' &&
        Boolean(telemetryDialog(target.ownerDocument)?.contains(target)),
      matchesEvent: (event) =>
        event instanceof TransitionEvent && event.propertyName === 'opacity',
      prepareOutcome: (_document, target) => () => transitionsEnded(target),
      isReady: (document) => dialogOpeningFinished(telemetryDialog(document)),
    },
    {
      ...uiInteractions.browserHandoffOpen,
      events: ['transitionstart'],
      matchesTarget: (target) =>
        Boolean(
          target.querySelector('[data-testid="continue-to-web-app-button"]')
        ),
      matchesEvent: (event) =>
        event instanceof TransitionEvent && event.propertyName === 'opacity',
      prepareOutcome: (_document, target) => () => transitionsEnded(target),
      isReady: (document) =>
        settled(
          document
            .querySelector('[data-testid="continue-to-web-app-button"]')
            ?.closest('.max-w-3xl')
        ),
    },
    {
      ...uiInteractions.paneBadgeHover,
      events: ['pointerover'],
      matchesTarget: (target) => Boolean(target.closest('#code-badge')),
      matchesEvent: (event, target) =>
        enters(target.closest('#code-badge') ?? target, event),
      isReady: (document) => settled(document.querySelector('#code-badge')),
    },
    {
      ...uiInteractions.toastEnter,
      events: ['animationstart'],
      matchesTarget: (target) =>
        target.matches(toastBarSelector) && toastIsVisible(target),
      matchesEvent: startsElementAnimation,
      prepareOutcome: (_document, target, event) =>
        ownAnimationOutcome(target, event),
      isReady: () => false,
    },
    {
      ...uiInteractions.toastExit,
      events: ['animationstart'],
      matchesTarget: (target) =>
        target.matches(toastBarSelector) && !toastIsVisible(target),
      matchesEvent: startsElementAnimation,
      prepareOutcome: (_document, target, event) =>
        ownAnimationOutcome(target, event),
      isReady: () => false,
    },
    {
      ...uiInteractions.toastStack,
      events: ['transitionstart'],
      matchesTarget: (target) => target.matches(toastWrapperSelector),
      matchesEvent: (event) =>
        event instanceof TransitionEvent && event.propertyName === 'transform',
      prepareOutcome: (_document, target) => () => transitionsEnded(target),
      isReady: () => false,
    },
    {
      ...uiInteractions.toastSuccessIcon,
      events: ['animationstart'],
      matchesTarget: (target) => statusIcon(target) && !errorIcon(target),
      matchesEvent: startsElementAnimation,
      prepareOutcome: (_document, target) => animationOutcome(target),
      isReady: () => false,
    },
    {
      ...uiInteractions.toastErrorIcon,
      events: ['animationstart'],
      matchesTarget: errorIcon,
      matchesEvent: startsElementAnimation,
      prepareOutcome: (_document, target) => animationOutcome(target),
      isReady: () => false,
    },
    {
      ...uiInteractions.toastCustomIcon,
      events: ['animationstart'],
      matchesTarget: (target) =>
        target.parentElement === toastBar(target) &&
        target.childElementCount === 0 &&
        Boolean(target.textContent?.trim()),
      matchesEvent: startsElementAnimation,
      prepareOutcome: (_document, target) => animationOutcome(target),
      isReady: () => false,
    },
    {
      ...uiInteractions.zookeeperInfoFade,
      events: ['animationstart'],
      matchesTarget: (target) =>
        target.matches(
          '[data-testid="ml-response-info-chat-bubble"] .animate-delta-in'
        ),
      matchesEvent: startsElementAnimation,
      prepareOutcome: (_document, target) => animationOutcome(target),
      isReady: () => false,
    },
    {
      ...uiInteractions.featureTreeTooltip,
      events: ['pointerover'],
      matchesTarget: (target) =>
        Boolean(target.closest('[data-testid="feature-tree-operation-item"]')),
      matchesEvent: (event, target) =>
        enters(
          target.closest('[data-testid="feature-tree-operation-item"]') ??
            target,
          event
        ),
      prepareOutcome(_document, target) {
        const row = target.closest(
          '[data-testid="feature-tree-operation-item"]'
        )
        return () => settled(row?.querySelector('[role="tooltip"]'))
      },
      isReady: () => false,
    },
  ]
}
