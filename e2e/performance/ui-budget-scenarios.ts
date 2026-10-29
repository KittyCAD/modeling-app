import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import type {
  BudgetFixtures,
  BudgetScenario,
} from '@e2e/performance/budget-scenarios'
import { prepareHome, prepareModeling } from '@e2e/performance/scenarios'
import { zookeeperFixtureReply } from '@e2e/performance/zookeeper-protocol'
import { assertModelLoaded, isErrorProfile } from '@e2e/performance/models'
import { attachOutcomeDiagnostics } from '@e2e/performance/capture'
import {
  dialogOpeningFinished,
  uiInteractions,
} from '@src/lib/interactionPerformance/uiOutcomes'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

const scalar = 'auditLength = 13mm'
const convertedName = 'auditConvertedLength'
const copiedCodeMessage = "Copied current file's code to clipboard."
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

async function prepareSettings(fixtures: BudgetFixtures, modeling: boolean) {
  await (modeling ? prepareModeling : prepareHome)(fixtures)
  await fixtures.toolbar.userSidebarButton.click()
  await expect(fixtures.page.getByTestId('user-settings')).toBeVisible()
}

async function openSettings({ page }: BudgetFixtures) {
  await page.getByTestId('user-settings').click()
}

async function closeSettings({ page }: BudgetFixtures) {
  await page.getByTestId('settings-close-button').click()
}

function telemetryDialog(page: BudgetFixtures['page']) {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Telemetry', exact: true }),
  })
}

async function prepareTelemetry(fixtures: BudgetFixtures) {
  await prepareModeling(fixtures)
  await fixtures.cmdBar.openCmdBar()
  await fixtures.cmdBar.cmdSearchInput.fill('Go to Telemetry')
  await expect(
    fixtures.cmdBar.cmdOptions.getByText('Go to Telemetry', { exact: true })
  ).toBeVisible()
}

async function openTelemetry({ cmdBar }: BudgetFixtures) {
  await cmdBar.chooseCommand('Go to Telemetry')
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
  await expect(
    fixtures.page.getByRole('status').filter({ hasText: copiedCodeMessage })
  ).toHaveCount(0)
  await openCodeMenu(fixtures)
}

async function openCodeMenu({ page }: BudgetFixtures) {
  await page
    .locator('#code-pane button')
    .filter({ has: page.locator('svg[aria-label="three-dots"]') })
    .click()
}

async function copyCode({ page, tronApp }: BudgetFixtures) {
  // Match copyKclCodeToClipboard's source string, not CodeMirror's innerText
  // serialization, which can insert extra line breaks.
  const source = await page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('Copy code requires the executing editor')
    return editor.code
  })
  await page.getByRole('menuitem', { name: 'Copy code', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: copiedCodeMessage })
  ).toBeVisible()
  const clipboard = await tronApp.electron.evaluate(({ clipboard }) =>
    clipboard.readText()
  )
  expect(clipboard).toBe(source)
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
    definition: uiInteractions.convertVariableApply,
    unavailableWithErrors: variableChangesCode,
    prepare: async (fixtures) => {
      await prepareVariable(fixtures)
      await openVariable(fixtures)
      await waitForOwnerAnimations(fixtures.page.getByRole('dialog'))
      await fixtures.page.getByLabel('Create new variable').fill(convertedName)
      await expect(
        fixtures.page.getByRole('button', { name: /Add variable$/ })
      ).toBeEnabled()
    },
    act: async ({ page }) => {
      await page.getByRole('button', { name: /Add variable$/ }).click()
    },
    verify: async (fixtures) => {
      await expect(fixtures.page.getByLabel('Create new variable')).toHaveCount(
        0
      )
      const converted = await fixtures.page.evaluate((name) => {
        const editor = window.app.project?.executingEditor.value
        if (!editor) throw new Error('Conversion requires the executing editor')
        return {
          added: editor.ast.body.some(
            (node) =>
              node.type === 'VariableDeclaration' &&
              node.declaration.id.name === name &&
              node.declaration.init.type === 'Literal' &&
              node.declaration.init.raw === '13mm'
          ),
          replaced: editor.ast.body.some(
            (node) =>
              node.type === 'VariableDeclaration' &&
              node.declaration.id.name === 'auditLength' &&
              node.declaration.init.type === 'Name' &&
              node.declaration.init.name.name === name
          ),
          code: editor.code,
          addedValue: editor.execState.variables[name],
          replacedValue: editor.execState.variables.auditLength,
        }
      }, convertedName)
      expect(converted.added).toBe(true)
      expect(converted.replaced).toBe(true)
      expect(converted.code).toContain(`${convertedName} = 13mm`)
      expect(converted.code).toContain(`auditLength = ${convertedName}`)
      expect(converted.addedValue).toMatchObject({ type: 'Number', value: 13 })
      expect(converted.replacedValue).toMatchObject({
        type: 'Number',
        value: 13,
      })
    },
  },
  {
    definition: uiInteractions.telemetryOpen,
    prepare: prepareTelemetry,
    act: openTelemetry,
    verify: async ({ page }) => {
      await expect(
        telemetryDialog(page).getByRole('heading', {
          name: 'Raw Marks',
          exact: true,
        })
      ).toBeVisible()
      await expect(
        telemetryDialog(page).getByTestId('settings-close-button')
      ).toBeEnabled()
    },
  },
  {
    definition: uiInteractions.telemetryClose,
    prepare: async (fixtures) => {
      await prepareTelemetry(fixtures)
      await openTelemetry(fixtures)
      await waitForOwnerAnimations(telemetryDialog(fixtures.page))
    },
    act: async ({ page }) => {
      await telemetryDialog(page).getByTestId('settings-close-button').click()
    },
    verify: async (fixtures) => {
      await expect(telemetryDialog(fixtures.page)).toHaveCount(0)
      await assertModelLoaded(fixtures)
    },
  },
  ...['home', 'modeling'].flatMap((context): BudgetScenario[] => {
    const modeling = context === 'modeling'
    const prepare = (fixtures: BudgetFixtures) =>
      prepareSettings(fixtures, modeling)
    return [
      {
        definition: modeling
          ? uiInteractions.modelSettingsOpen
          : uiInteractions.settingsOpen,
        context: modeling ? undefined : 'home',
        prepare,
        act: openSettings,
        verify: async ({ page }) => {
          await expect(page.getByTestId('settings-dialog-panel')).toBeVisible()
        },
      },
      {
        definition: modeling
          ? uiInteractions.modelSettingsClose
          : uiInteractions.settingsClose,
        context: modeling ? undefined : 'home',
        prepare: async (fixtures) => {
          await prepare(fixtures)
          await openSettings(fixtures)
          await waitForOwnerAnimations(fixtures.page.getByRole('dialog'))
        },
        act: closeSettings,
        verify: async (fixtures) => {
          await expect(
            fixtures.page.getByTestId('settings-dialog-panel')
          ).toHaveCount(0)
          if (modeling) await assertModelLoaded(fixtures)
        },
      },
    ]
  }),
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
  {
    definition: uiInteractions.copyCode,
    prepare: prepareCopyCode,
    act: copyCode,
    verify: async ({ page }) => {
      await expect(
        page.getByRole('status').filter({ hasText: copiedCodeMessage })
      ).toBeVisible()
    },
  },
  {
    definition: uiInteractions.zookeeperSend,
    tags: ['@zookeeper'],
    prepare: async (fixtures) => {
      // Deterministic server input exercises the real consumer and UI after the
      // native Send click. This is not a benchmark of AI/service response time.
      await fixtures.page.routeWebSocket('**/ws/ml/copilot**', (client) => {
        client.onMessage((message) => {
          const response = zookeeperFixtureReply(message, infoText)
          if (response) client.send(JSON.stringify(response))
        })
      })
      await prepareModeling(fixtures)
      await fixtures.toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await fixtures.copilot.conversationInput.fill(
        'Show an informational status'
      )
      await expect(fixtures.copilot.submitButton).toBeEnabled()
      await expect(
        fixtures.page.getByTestId('ml-response-info-chat-bubble')
      ).toHaveCount(0)
    },
    act: async ({ copilot }) => {
      await copilot.submitButton.click()
    },
    verify: async ({ page }) => {
      await expect(
        page.getByTestId('ml-response-info-chat-bubble')
      ).toContainText(infoText)
      await expect(
        page.getByTestId('ml-response-info-chat-bubble')
      ).toBeVisible()
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
