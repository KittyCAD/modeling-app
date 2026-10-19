import type { KclManager } from '@src/lang/KclManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import { isVisible } from '@src/lib/interactionPerformance/outcomes'
import type {
  InteractionDefinition,
  InteractionDescription,
} from '@src/lib/interactionPerformance/types'

export const delayInteractions = {
  richTooltipReveal: {
    id: 'zds.toolbar.richTooltip.reveal',
    testId: 'extrude',
    budgetMs: 150,
    outcome: 'The hovered toolbar tooltip displays its rich description',
  },
  richTooltipHide: {
    id: 'zds.toolbar.richTooltip.hide',
    testId: 'extrude',
    budgetMs: 150,
    outcome: 'Moving away from the toolbar control hides its visible tooltip',
  },
  editorExecution: {
    id: 'zds.editor.automaticExecution',
    testId: 'code-pane',
    budgetMs: 150,
    outcome:
      'The edited code has successfully executed and execution has finished',
  },
  backfaceColor: {
    id: 'zds.settings.backfaceColor.commit',
    testId: 'backfaceColor',
    budgetMs: 150,
    outcome:
      'The Settings color input commits its value to the displayed hex setting',
  },
  density: {
    id: 'zds.physicalAnalysis.density.update',
    testId: 'physical-analysis-density',
    budgetMs: 150,
    outcome:
      'Physical analysis displays updated results for the changed density',
  },
  folderDragExpand: {
    id: 'zds.files.folder.dragExpand',
    testId: 'file-tree-item',
    budgetMs: 150,
    outcome:
      'Dragging over a closed folder expands it and reveals its children',
  },
  hoverCode: {
    id: 'zds.scene.hoverCode',
    testId: 'stream',
    budgetMs: 150,
    outcome: 'Hovering geometry displays its corresponding code highlight',
  },
  streamResize: {
    id: 'zds.scene.resize',
    testId: 'stream',
    budgetMs: 150,
    outcome:
      'The resized window has matching engine and delivered video dimensions',
  },
  planesShow: {
    id: 'zds.scene.defaultPlanes.showAfterEdit',
    testId: 'code-pane',
    budgetMs: 150,
    outcome:
      'Clearing geometry executes the edited code and shows all default planes',
  },
  planesHide: {
    id: 'zds.scene.defaultPlanes.hideAfterEdit',
    testId: 'code-pane',
    budgetMs: 150,
    outcome:
      'Adding geometry executes the edited code and hides all default planes',
  },
} satisfies Record<string, InteractionDescription>

const editorSelector = '#code-pane .cm-content'
const extrudeSelector = '[data-testid="toolbar"] [data-testid="extrude"]'
const densitySelector = '[data-testid="physical-analysis-density"]'
const analysisSelector = 'button[title="Copy physical analysis"]'

function toolbarTooltip(target: Element) {
  return (
    target
      .closest(extrudeSelector)
      ?.parentElement?.querySelector('[role="tooltip"]') ?? null
  )
}

function crossesControlBoundary(
  event: Event,
  target: Element,
  selector: string
) {
  if (!(event instanceof PointerEvent)) {
    return false
  }
  const control = target.closest(selector)
  return Boolean(
    control &&
      (!(event.relatedTarget instanceof Node) ||
        !control.parentElement?.contains(event.relatedTarget))
  )
}

function inputIsEditor(target: Element) {
  return target.closest(editorSelector) !== null
}

function successfulEdit(
  editor: KclManager | undefined,
  previousCode: string | undefined
) {
  return Boolean(
    editor &&
      editor.code !== previousCode &&
      editor.lastSuccessfulCode === editor.code &&
      !editor.isExecuting &&
      editor.errors.length === 0
  )
}

function planeVisibility(editor: KclManager | undefined, visible: boolean) {
  const visibility = editor?.modelingState?.context.defaultPlaneVisibility
  return Boolean(
    visibility &&
      visibility.xy === visible &&
      visibility.xz === visible &&
      visibility.yz === visible
  )
}

export function createDelayOutcomes(
  getEditor: () => KclManager | undefined
): InteractionDefinition[] {
  return [
    {
      ...delayInteractions.richTooltipReveal,
      events: ['pointerover'],
      matchesTarget: (target) => target.closest(extrudeSelector) !== null,
      matchesEvent: (event, target) =>
        crossesControlBoundary(event, target, extrudeSelector),
      prepareOutcome: (_document, target) => {
        const tooltip = toolbarTooltip(target)
        return () =>
          isVisible(tooltip) && isVisible(tooltip?.querySelector('p'))
      },
      isReady: () => false,
    },
    {
      ...delayInteractions.richTooltipHide,
      events: ['pointerout'],
      matchesTarget: (target) => isVisible(toolbarTooltip(target)),
      matchesEvent: (event, target) =>
        crossesControlBoundary(event, target, extrudeSelector),
      prepareOutcome: (_document, target) => {
        const tooltip = toolbarTooltip(target)
        return () => !isVisible(tooltip)
      },
      isReady: () => false,
    },
    {
      ...delayInteractions.editorExecution,
      events: ['input'],
      coalesce: 'last',
      matchesTarget: inputIsEditor,
      prepareOutcome: () => {
        const previousCode = getEditor()?.lastSuccessfulCode
        return () => successfulEdit(getEditor(), previousCode)
      },
      isReady: () => false,
    },
    {
      ...delayInteractions.backfaceColor,
      events: ['input'],
      matchesTarget: (target) =>
        target.matches('#backfaceColor input[type="color"]'),
      prepareOutcome: (_document, target) => {
        const value =
          target instanceof HTMLInputElement ? target.value.toUpperCase() : ''
        const section = target.closest('#backfaceColor')
        return () =>
          Boolean(
            value &&
              [...(section?.querySelectorAll('span') ?? [])].some(
                (span) => span.textContent?.trim() === value
              )
          )
      },
      isReady: () => false,
    },
    {
      ...delayInteractions.density,
      events: ['input'],
      matchesTarget: (target) => target.matches(densitySelector),
      prepareOutcome: (document) => {
        const initialResult =
          document.querySelector(analysisSelector)?.textContent
        return () => {
          const result = document.querySelector(analysisSelector)
          return (
            isVisible(result) &&
            Boolean(result?.textContent && result.textContent !== initialResult)
          )
        }
      },
      isReady: () => false,
    },
    {
      ...delayInteractions.folderDragExpand,
      events: ['dragover'],
      coalesce: 'first',
      matchesTarget: (target) =>
        Boolean(
          target
            .closest('[role="treeitem"][aria-expanded="false"]')
            ?.querySelector('svg[aria-label="folder"]')
        ),
      matchesEvent: (event) =>
        event instanceof DragEvent &&
        Boolean(event.dataTransfer?.types.includes('json')),
      prepareOutcome: (_document, target) => {
        const folder = target.closest('[role="treeitem"]')
        const childLevel = Number(folder?.getAttribute('aria-level')) + 1
        return () =>
          folder?.getAttribute('aria-expanded') === 'true' &&
          isVisible(folder.nextElementSibling) &&
          folder.nextElementSibling?.getAttribute('aria-level') ===
            String(childLevel)
      },
      isReady: () => false,
    },
    {
      ...delayInteractions.hoverCode,
      events: ['pointerover'],
      matchesTarget: (target) => target.closest('#stream') !== null,
      matchesEvent: (event) =>
        event instanceof PointerEvent &&
        (!(event.relatedTarget instanceof Element) ||
          !event.relatedTarget.closest('#stream')),
      prepareOutcome: (document) => {
        const previous = document.querySelector(
          '[data-testid="hover-highlight"]'
        )?.textContent
        return () => {
          const highlight = document.querySelector(
            '[data-testid="hover-highlight"]'
          )
          return (
            isVisible(highlight) &&
            Boolean(
              highlight?.textContent && highlight.textContent !== previous
            )
          )
        }
      },
      isReady: () => false,
    },
    {
      ...delayInteractions.streamResize,
      events: ['resize'],
      coalesce: 'first',
      matchesTarget: () => Boolean(getEditor()),
      matchesEvent: (event, target) =>
        event.target === target.ownerDocument.defaultView,
      prepareOutcome: (document) => {
        const stream = document.querySelector('#stream')
        const initial = getEditor()?.engineCommandManager.streamDimensions
        return () => {
          if (!(stream instanceof HTMLElement)) {
            return false
          }
          const expected = getDimensions(
            stream.clientWidth,
            stream.clientHeight
          )
          const actual = getEditor()?.engineCommandManager.streamDimensions
          const video = document.querySelector('#video-stream')
          return Boolean(
            actual &&
              (actual.width !== initial?.width ||
                actual.height !== initial?.height) &&
              actual.width === expected.width &&
              actual.height === expected.height &&
              video instanceof HTMLVideoElement &&
              video.videoWidth === expected.width &&
              video.videoHeight === expected.height
          )
        }
      },
      isReady: () => false,
    },
    ...[true, false].map(
      (visible): InteractionDefinition => ({
        ...(visible
          ? delayInteractions.planesShow
          : delayInteractions.planesHide),
        events: ['input'],
        coalesce: 'last',
        matchesTarget: (target) =>
          inputIsEditor(target) && !planeVisibility(getEditor(), visible),
        prepareOutcome: () => {
          const previousCode = getEditor()?.lastSuccessfulCode
          return () =>
            successfulEdit(getEditor(), previousCode) &&
            planeVisibility(getEditor(), visible) &&
            Object.keys(getEditor()?.engineCommandManager.pendingCommands ?? {})
              .length === 0
        },
        isReady: () => false,
      })
    ),
  ]
}
