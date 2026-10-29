import type { KclManager } from '@src/lang/KclManager'
import {
  animationsEnded,
  isVisible,
  transitionsEnded,
} from '@src/lib/interactionPerformance/outcomes'
import { createRenderedViewOutcome } from '@src/lib/interactionPerformance/renderedView'
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
  convertVariableApply: {
    id: 'zds.variable.apply',
    testId: 'create-new-variable',
    budgetMs: 150,
    outcome:
      'Adding a variable replaces the selected expression, successfully executes the new code, and restores the rendered model',
  },
  telemetryOpen: {
    id: 'zds.telemetry.open',
    testId: 'cmd-bar-option',
    budgetMs: 150,
    outcome:
      'Go to Telemetry opens a readable, settled Telemetry dialog with usable controls',
  },
  telemetryClose: {
    id: 'zds.telemetry.close',
    testId: 'settings-close-button',
    budgetMs: 150,
    outcome: 'Closing Telemetry restores the usable rendered model',
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
    outcome:
      'Closing Settings restores the usable model and a newly presented model frame',
  },
  paneBadgeHover: {
    id: 'zds.paneBadge.hover',
    testId: 'code-badge',
    budgetMs: 150,
    outcome: 'Hovered code diagnostic badge is visible and settled',
  },
  copyCode: {
    id: 'zds.editor.copyCode',
    testId: 'code-pane',
    budgetMs: 150,
    outcome:
      'Copy code finished writing the clipboard and its complete success notification is readable and settled',
  },
  zookeeperSend: {
    id: 'zds.zookeeper.send',
    testId: 'ml-ephant-conversation-input-button',
    budgetMs: 150,
    outcome:
      'Sending a Zookeeper request produced a readable status response with finite UI effects finished',
  },
  featureTreeTooltip: {
    id: 'zds.featureTree.tooltip',
    testId: 'feature-tree-operation-item',
    budgetMs: 150,
    outcome: 'Hovered feature-tree operation has a readable, settled tooltip',
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
    (dialog) =>
      Array.from(dialog.querySelectorAll('h1')).some(
        (heading) => heading.textContent?.trim() === 'Telemetry'
      )
  )
}

function settingsReady(document: Document) {
  const dialog = settingsDialog(document)
  return Boolean(
    dialogOpeningFinished(dialog) &&
      isVisible(dialog?.querySelector('[role="combobox"]:enabled')) &&
      isVisible(
        dialog?.querySelector('[data-testid="settings-close-button"]:enabled')
      ) &&
      Array.from(
        dialog?.querySelectorAll(
          'section input:enabled, section select:enabled, section button:enabled'
        ) ?? []
      ).some(isVisible)
  )
}

function modelPreserved(getEditor: () => KclManager | undefined) {
  const editor = getEditor()
  const code = editor?.code
  const lastSuccessfulCode = editor?.lastSuccessfulCode
  const artifacts = editor?.artifactGraph.size
  const hasErrors = editor?.hasErrors()
  const hasParseErrors = editor?.hasParseErrors()
  return () => {
    const current = getEditor()
    return Boolean(
      current &&
        current.code === code &&
        current.lastSuccessfulCode === lastSuccessfulCode &&
        current.artifactGraph.size === artifacts &&
        current.artifactGraph.size > 0 &&
        current.hasErrors() === hasErrors &&
        current.hasParseErrors() === hasParseErrors &&
        !current.isExecuting &&
        Object.keys(current.engineCommandManager.pendingCommands).length === 0
    )
  }
}

function settled(element: Element | null | undefined) {
  return Boolean(
    element &&
      isVisible(element) &&
      Number(getComputedStyle(element).opacity) === 1 &&
      transitionsEnded(element) &&
      animationsEnded(element)
  )
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

const copySuccessMessage = "Copied current file's code to clipboard."
const statusSelector = '[role="status"]'
const infoSelector = '[data-testid="ml-response-info-chat-bubble"]'

export function createUiOutcomes(
  getEditor: () => KclManager | undefined
): InteractionDefinition[] {
  const settingsOpen = {
    matchesTarget: (target: Element) =>
      Boolean(target.closest('[data-testid="user-settings"]')),
    isReady: settingsReady,
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
      ...uiInteractions.convertVariableApply,
      matchesTarget: (target) =>
        target.closest('button')?.textContent?.trim() === 'Add variable' &&
        Boolean(variableDialog(target.ownerDocument)?.contains(target)),
      prepareOutcome(document) {
        const editor = getEditor()
        const input = document.querySelector('#create-new-variable')
        const name = input instanceof HTMLInputElement ? input.value : ''
        const range =
          editor?.modelingState?.context.selectionRanges.graphSelections[0]
            ?.codeRef?.range
        const original = editor?.ast.body.find(
          (node) =>
            node.type === 'VariableDeclaration' &&
            range &&
            node.start <= range[0] &&
            node.end >= range[1]
        )
        const destination =
          original?.type === 'VariableDeclaration'
            ? original.declaration.id.name
            : undefined
        const raw =
          original?.type === 'VariableDeclaration' &&
          original.declaration.init.type === 'Literal'
            ? original.declaration.init.raw
            : undefined
        const previousCode = editor?.code
        const generation = editor?.engineSceneGenerationSignal.value
        const value = destination
          ? editor?.execState.variables[destination]
          : undefined
        const artifacts = editor?.artifactGraph.size
        const hadImportedGeometry = Array.from(
          editor?.artifactGraph.values() ?? []
        ).some(
          (artifact) =>
            'codeRef' in artifact &&
            artifact.codeRef &&
            artifact.codeRef.range[2] !== 0
        )
        const dialog = variableDialog(document)
        return createRenderedViewOutcome({
          document,
          getScene: () => getEditor()?.sceneInfra,
          kind: 'stream',
          isReady: () => {
            const current = getEditor()
            if (!current || !name || !destination || !raw) return false
            const declaration = current.ast.body.find(
              (node) =>
                node.type === 'VariableDeclaration' &&
                node.declaration.id.name === name
            )
            const replacement = current.ast.body.find(
              (node) =>
                node.type === 'VariableDeclaration' &&
                node.declaration.id.name === destination
            )
            const executed = current.execState.variables[name]
            const replacedValue = current.execState.variables[destination]
            let mainArtifacts = 0
            let importedArtifacts = 0
            for (const artifact of current.artifactGraph.values()) {
              if ('codeRef' in artifact && artifact.codeRef) {
                if (artifact.codeRef.range[2] === 0) mainArtifacts++
                else importedArtifacts++
              }
            }
            // This command executes the new AST before updating the editor
            // source. Its lastSuccessfulCode text therefore still names the
            // old source; use the actual new execution values and scene receipt.
            return Boolean(
              current === editor &&
                current.code !== previousCode &&
                current.code.includes(`${name} = ${raw}`) &&
                current.code.includes(`${destination} = ${name}`) &&
                !current.hasErrors() &&
                !current.isExecuting &&
                Object.keys(current.engineCommandManager.pendingCommands)
                  .length === 0 &&
                generation !== undefined &&
                current.engineSceneGenerationSignal.value > generation &&
                value?.type === 'Number' &&
                executed?.type === 'Number' &&
                executed.value === value.value &&
                replacedValue?.type === 'Number' &&
                replacedValue.value === value.value &&
                current.artifactGraph.size === artifacts &&
                current.artifactGraph.size > 0 &&
                (!hadImportedGeometry || importedArtifacts > mainArtifacts) &&
                declaration?.type === 'VariableDeclaration' &&
                declaration.declaration.init.type === 'Literal' &&
                declaration.declaration.init.raw === raw &&
                replacement?.type === 'VariableDeclaration' &&
                replacement.declaration.init.type === 'Name' &&
                replacement.declaration.init.name.name === name &&
                (!dialog?.isConnected || !isVisible(dialog))
            )
          },
        })
      },
      isReady: () => false,
    },
    {
      ...uiInteractions.telemetryOpen,
      matchesTarget: (target) =>
        target
          .closest('[data-testid="cmd-bar-option"]')
          ?.querySelector('p')
          ?.textContent?.trim() === 'Go to Telemetry',
      isReady: (document) => {
        const dialog = telemetryDialog(document)
        return Boolean(
          dialogOpeningFinished(dialog) &&
            isVisible(
              dialog?.querySelector(
                '[data-testid="settings-close-button"]:enabled'
              )
            ) &&
            Array.from(dialog?.querySelectorAll('h1') ?? []).some(
              (heading) => heading.textContent?.trim() === 'Raw Marks'
            ) &&
            !isVisible(
              document.querySelector('[data-testid="command-bar-wrapper"]')
            )
        )
      },
    },
    {
      ...uiInteractions.telemetryClose,
      matchesTarget: (target) =>
        Boolean(target.closest('[data-testid="settings-close-button"]')) &&
        Boolean(telemetryDialog(target.ownerDocument)?.contains(target)),
      prepareOutcome(document) {
        const dialog = telemetryDialog(document)
        const preserved = modelPreserved(getEditor)
        return createRenderedViewOutcome({
          document,
          getScene: () => getEditor()?.sceneInfra,
          kind: 'stream',
          isReady: () =>
            (!dialog?.isConnected || !isVisible(dialog)) && preserved(),
        })
      },
      isReady: (document) => !isVisible(telemetryDialog(document)),
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
      prepareOutcome(document) {
        const dialog = settingsDialog(document)
        const preserved = modelPreserved(getEditor)
        return createRenderedViewOutcome({
          document,
          getScene: () => getEditor()?.sceneInfra,
          kind: 'stream',
          isReady: () =>
            (!dialog?.isConnected || !isVisible(dialog)) && preserved(),
        })
      },
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
      ...uiInteractions.copyCode,
      matchesTarget: (target) =>
        getEditor() !== undefined &&
        target.closest('[role="menuitem"]')?.textContent?.trim() ===
          'Copy code',
      prepareOutcome(document) {
        const previous = new Set(document.querySelectorAll(statusSelector))
        return () =>
          Array.from(document.querySelectorAll(statusSelector)).some(
            (message) => {
              if (
                previous.has(message) ||
                message.textContent?.trim() !== copySuccessMessage ||
                !isVisible(message)
              ) {
                return false
              }
              // Production creates this success toast only after writeText
              // resolves. Include the whole notification and its positioner,
              // not just an icon or the first appearance of the message.
              const bar = message.closest('[data-rht-toaster] > div > div')
              return settled(bar) && settled(bar?.parentElement)
            }
          )
      },
      isReady: () => false,
    },
    {
      ...uiInteractions.zookeeperSend,
      matchesTarget: (target) =>
        Boolean(
          target.closest('[data-testid="ml-ephant-conversation-input-button"]')
        ),
      prepareOutcome(document) {
        const previous = new Set(document.querySelectorAll(infoSelector))
        return () =>
          Array.from(document.querySelectorAll(infoSelector)).some(
            (response) =>
              !previous.has(response) &&
              Boolean(response.textContent?.trim()) &&
              settled(response)
          )
      },
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
