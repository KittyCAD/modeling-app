import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import type { MlCopilotServerMessage } from '@kittycad/lib'
import type {
  BudgetFixtures,
  BudgetScenario,
} from '@e2e/performance/budget-scenarios'
import { prepareHome, prepareModeling } from '@e2e/performance/scenarios'
import { assertModelLoaded, isErrorProfile } from '@e2e/performance/models'
import { attachOutcomeDiagnostics } from '@e2e/performance/capture'
import {
  dialogOpeningFinished,
  uiInteractions,
} from '@src/lib/interactionPerformance/uiOutcomes'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

const scalar = 'auditLength = 13mm'
const existingTextFile = 'audit-existing.txt'
const variableChangesCode =
  'Variable-conversion preparation edits and executes KCL; preserved error profiles must keep their loaded error state unchanged.'

async function waitForOwnerAnimations(owner: Locator) {
  try {
    await expect(owner).toBeVisible({ timeout: 35_000 })
    await expect
      .poll(() => owner.evaluate(dialogOpeningFinished), { timeout: 35_000 })
      .toBe(true)
  } catch (error) {
    await attachOutcomeDiagnostics(
      owner.page(),
      test.info(),
      'Dialog opening preparation did not settle'
    )
    throw error
  }
}

async function prepareModelSettings(fixtures: BudgetFixtures) {
  await prepareModeling(fixtures)
  await fixtures.toolbar.userSidebarButton.click()
  await expect(fixtures.page.getByTestId('user-settings')).toBeVisible()
}

async function openSettings({ page }: BudgetFixtures) {
  await page.getByTestId('user-settings').click()
}

async function closeSettings({ page }: BudgetFixtures) {
  await page.getByTestId('settings-close-button').click()
}

async function prepareVariable(fixtures: BudgetFixtures) {
  await prepareModeling(fixtures)
  const { editor, scene, page } = fixtures
  const code = await editor.getCurrentCode()
  await scene.waitForExecutionDoneAfter(() =>
    // Keep this independent scalar before geometry source ranges. Imported
    // artifacts currently overlap main-file offsets during editor selection.
    editor.replaceCode('', `${scalar}\n${code}`)
  )
  await editor.selectText('13mm')
  await openCodeMenu(fixtures)
  await expect(
    page.getByRole('menuitem', { name: /Convert to Variable/ })
  ).toBeVisible()
}

async function openVariable({ page }: BudgetFixtures) {
  await page.getByRole('menuitem', { name: /Convert to Variable/ }).click()
}

async function prepareCopyCode(fixtures: BudgetFixtures) {
  await prepareModeling(fixtures)
  await openCodeMenu(fixtures)
}

async function openCodeMenu({ page }: BudgetFixtures) {
  await page
    .locator('#code-pane button')
    .filter({ has: page.locator('svg[aria-label="three-dots"]') })
    .click()
}

async function copyCode({ page }: BudgetFixtures) {
  await page.getByRole('menuitem', { name: 'Copy code', exact: true }).click()
}

async function prepareInvalidCode(fixtures: BudgetFixtures) {
  await prepareModeling(fixtures)
  if (isErrorProfile(fixtures.modelProfile)) {
    await expect(fixtures.page.locator('#code-badge')).toBeVisible()
    return
  }
  const previous = await fixtures.page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('Diagnostic badge requires a loaded model')
    return {
      code: editor.code,
      lastSuccessfulCode: editor.lastSuccessfulCode,
      artifacts: editor.artifactGraph.size,
    }
  })
  // Keep the full selected model in both the source and cached scene. A real
  // parse error is required for this error badge; warnings do not create it.
  await fixtures.editor.replaceCode('', `${previous.code}\nauditInvalid = (`)
  await expect(fixtures.page.locator('#code-badge')).toBeVisible()
  await fixtures.page.waitForFunction((previous) => {
    const editor = window.app.project?.executingEditor.value
    return Boolean(
      editor &&
        !editor.isExecutingSignal.value &&
        Object.keys(editor.engineCommandManager.pendingCommands).length === 0 &&
        editor.lastSuccessfulCode === previous.lastSuccessfulCode &&
        editor.artifactGraph.size === previous.artifacts
    )
  }, previous)
}

const infoText = 'Performance audit streamed info'

export const uiBudgetScenarios: BudgetScenario[] = [
  {
    definition: uiInteractions.convertVariableOpen,
    unavailableWithErrors: variableChangesCode,
    prepare: prepareVariable,
    act: openVariable,
    verify: async ({ page }) => {
      await expect(page.getByLabel('Create new variable')).toBeEditable()
    },
  },
  {
    definition: uiInteractions.convertVariableClose,
    unavailableWithErrors: variableChangesCode,
    prepare: async (fixtures) => {
      await prepareVariable(fixtures)
      await openVariable(fixtures)
      await waitForOwnerAnimations(fixtures.page.getByRole('dialog'))
    },
    act: async ({ page }) => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
    },
    verify: async ({ page }) => {
      await expect(page.getByLabel('Create new variable')).toHaveCount(0)
    },
  },
  {
    definition: uiInteractions.settingsOpen,
    context: 'home',
    prepare: async (fixtures) => {
      await prepareHome(fixtures)
      await fixtures.toolbar.userSidebarButton.click()
      await expect(fixtures.page.getByTestId('user-settings')).toBeVisible()
    },
    act: openSettings,
    verify: async ({ page }) => {
      await expect(page.getByTestId('settings-dialog-panel')).toBeVisible()
    },
  },
  {
    definition: uiInteractions.settingsClose,
    context: 'home',
    prepare: async (fixtures) => {
      await prepareHome(fixtures)
      await fixtures.toolbar.userSidebarButton.click()
      await openSettings(fixtures)
      await waitForOwnerAnimations(fixtures.page.getByRole('dialog'))
    },
    act: closeSettings,
    verify: async ({ page }) => {
      await expect(page.getByTestId('settings-dialog-panel')).toHaveCount(0)
    },
  },
  {
    definition: uiInteractions.modelSettingsOpen,
    prepare: prepareModelSettings,
    act: openSettings,
    verify: async ({ page }) => {
      await expect(page.getByTestId('settings-dialog-panel')).toBeVisible()
    },
  },
  {
    definition: uiInteractions.modelSettingsClose,
    prepare: async (fixtures) => {
      await prepareModelSettings(fixtures)
      await openSettings(fixtures)
      await waitForOwnerAnimations(fixtures.page.getByRole('dialog'))
      if (isErrorProfile(fixtures.modelProfile)) {
        try {
          await assertModelLoaded(fixtures)
        } catch (error) {
          // model-setup retains the initial receipt; this records what the real
          // Settings navigation left behind before any close sample is armed.
          await attachOutcomeDiagnostics(
            fixtures.page,
            test.info(),
            'Settings close preparation lost the required error-state model'
          )
          throw error
        }
      }
    },
    act: closeSettings,
    verify: async (fixtures) => {
      await expect(
        fixtures.page.getByTestId('settings-dialog-panel')
      ).toHaveCount(0)
    },
  },
  {
    definition: uiInteractions.telemetryOpen,
    context: 'home',
    prepare: prepareHome,
    act: async ({ page }) => {
      // Telemetry is an existing diagnostic route without a launcher button.
      // Hash navigation keeps the recorder in the same desktop document.
      const url = new URL(page.url())
      url.hash = `${url.hash.replace(/\/$/, '')}/telemetry`
      await page.goto(url.toString())
    },
    verify: async ({ page }) => {
      await expect(
        page.getByRole('heading', { name: 'Telemetry', exact: true })
      ).toBeVisible()
    },
  },
  {
    definition: uiInteractions.paneBadgeHover,
    allowCodeErrors: true,
    prepare: async (fixtures) => {
      await prepareInvalidCode(fixtures)
      await fixtures.editor.closePane()
      await fixtures.page.mouse.move(1190, 790)
    },
    act: async ({ page }) => {
      await page.locator('#code-badge').hover()
    },
  },
  ...[
    uiInteractions.toastEnter,
    uiInteractions.toastExit,
    uiInteractions.toastSuccessIcon,
  ].map(
    (definition): BudgetScenario => ({
      definition,
      prepare: prepareCopyCode,
      act: copyCode,
    })
  ),
  {
    definition: uiInteractions.toastStack,
    prepare: async (fixtures) => {
      await prepareCopyCode(fixtures)
      await copyCode(fixtures)
      await expect(
        fixtures.page.getByText("Copied current file's code to clipboard.", {
          exact: true,
        })
      ).toBeVisible()
      await openCodeMenu(fixtures)
    },
    act: copyCode,
  },
  {
    definition: uiInteractions.toastErrorIcon,
    prepare: async (fixtures) => {
      await prepareModeling(fixtures)
      const currentFile = await fixtures.page.evaluate(() => {
        const editor = window.app.project?.executingEditor.value
        if (!editor) throw new Error('Duplicate file needs an open project')
        return editor.path
      })
      await fixtures.fs.writeFile(
        await fixtures.fs.join(
          await fixtures.fs.dirname(currentFile),
          existingTextFile
        ),
        new TextEncoder().encode('Existing performance audit text file.\n')
      )
      await fixtures.toolbar.openPane(DefaultLayoutPaneID.Files)
      await expect(
        fixtures.page
          .getByTestId('file-pane-scroll-container')
          .getByRole('treeitem', { name: existingTextFile, exact: true })
      ).toBeVisible()
      await fixtures.toolbar.createFileBtn.click()
      await fixtures.toolbar.treeInputField.fill(existingTextFile)
    },
    act: async ({ toolbar }) => {
      await toolbar.treeInputField.press('Enter')
    },
    verify: async ({ page }) => {
      await expect(
        page.getByText(`File ${existingTextFile} already exists`, {
          exact: true,
        })
      ).toBeVisible()
    },
  },
  {
    definition: uiInteractions.toastCustomIcon,
    prepare: prepareModeling,
    act: async ({ page, fs, editor }) => {
      const code = await editor.getCurrentCode()
      const file = await page.evaluate(() => {
        const editor = window.app.project?.executingEditor.value
        if (!editor) throw new Error('External edit requires an open model')
        return editor.path
      })
      // Write directly: folderSetupFn reloads the page and is setup-only. The
      // native file watcher owns this notification and file reload.
      await fs.writeFile(
        file,
        new TextEncoder().encode(`${code}\n// External edit\n`)
      )
    },
    verify: async ({ page }) => {
      await expect(
        page.getByText('Reloading file from disk.', { exact: true })
      ).toBeVisible()
    },
  },
  {
    definition: uiInteractions.zookeeperInfoFade,
    tags: ['@zookeeper'],
    prepare: async (fixtures) => {
      await fixtures.page.routeWebSocket('**/ws/ml/copilot**', (client) => {
        client.onMessage((message) => {
          if (typeof message !== 'string') return
          const request: unknown = JSON.parse(message)
          if (
            typeof request === 'object' &&
            request !== null &&
            'type' in request &&
            request.type === 'headers'
          ) {
            const response: MlCopilotServerMessage = {
              conversation_id: {
                conversation_id: '00000000-0000-4000-8000-000000000001',
              },
            }
            client.send(JSON.stringify(response))
          }
          if (
            typeof request === 'object' &&
            request !== null &&
            'type' in request &&
            request.type === 'user'
          ) {
            // Typed wire input exercises the real protocol consumer and card.
            // No generated response, fake UI, or artificial delay is involved.
            const response: MlCopilotServerMessage = {
              info: { text: infoText },
            }
            client.send(JSON.stringify(response))
          }
        })
      })
      await prepareModeling(fixtures)
      await fixtures.toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await fixtures.copilot.conversationInput.fill(
        'Show an informational status'
      )
      await expect(fixtures.copilot.submitButton).toBeEnabled()
    },
    act: async ({ copilot }) => {
      await copilot.submitButton.click()
    },
    verify: async ({ page }) => {
      await expect(
        page.getByTestId('ml-response-info-chat-bubble')
      ).toContainText(infoText)
    },
  },
  {
    definition: uiInteractions.featureTreeTooltip,
    prepare: async (fixtures) => {
      await prepareModeling(fixtures)
      await fixtures.toolbar.openFeatureTreePane()
      await fixtures.page.mouse.move(1190, 790)
    },
    act: async ({ toolbar }) => {
      await (await toolbar.getFeatureTreeOperation('boxVisible', 0)).hover()
    },
    verify: async ({ page }) => {
      await expect(
        page.getByRole('tooltip').filter({ hasText: 'boxVisible' })
      ).toBeVisible()
    },
  },
]

export const unsupportedUiBudgetScenarios = [
  {
    definition: uiInteractions.loadingCountdownFade,
    reason:
      'Dormant: the only caller supplies isRetrying=false and retryAttemptCountdown=0. No real running-app countdown can be exercised without changing production behavior.',
  },
]
