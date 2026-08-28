import { randomUUID } from 'node:crypto'
import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
} from '@e2e/playwright/guiFuzzUtils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { observeZookeeperMessageProvenance } from '@e2e/playwright/zookeeperMessageProbe'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// See zookeeper/text_to_cad/zookeeper_magic_bypass.py. This keeps the
// production-safe transport probe deterministic and confines its known CAD
// edit to the fixture's fresh browser-local project.
const ZK_MOCK_REPLY_MARKER =
  'ZOO_MAGIC_STRING_TRIGGER_MOCK_REPLY_D39D279C6F84FA63AD49364FDEFB4A27D0E15BA7FB0975D4D6E003A8A594E460'

test.describe(
  'GUI fuzz: Zookeeper message provenance',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test('one completed prompt remains singular after conversation replay', async ({
      copilot,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const probeId = `codex-zds-message-${randomUUID()}`
      const provenance = await observeZookeeperMessageProvenance(page, {
        probeId,
      })
      const prompt =
        `Authorized GUI QA probe ${probeId}. Return the deterministic test reply. ` +
        `[${ZK_MOCK_REPLY_MARKER}]`

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)
        await scene.connectionEstablished()
        await scene.settled()

        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
        await expect(copilot.conversationInput).toBeVisible()
        await expect(copilot.submitButton).toBeEnabled({ timeout: 30_000 })
        await expect(copilot.welcomeSection).toBeVisible()
        await provenance.captureCheckpoint('zookeeper-ready')
        await captureGuiFuzzStep(page, testInfo, 0, 'zookeeper-ready')

        await copilot.setMode('fast')
        await copilot.conversationInput.fill(prompt)
        await provenance.captureCheckpoint('prompt-filled')
        await captureGuiFuzzStep(page, testInfo, 1, 'prompt-filled')

        await copilot.submitButton.click()
        await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(1)
        await provenance.captureCheckpoint('single-submit-visible')
        await captureGuiFuzzStep(page, testInfo, 2, 'single-submit-visible')

        await expect(copilot.cancelButton).not.toBeVisible({ timeout: 45_000 })
        await expect(copilot.placeHolderResponse).not.toBeVisible()
        await expect(page.getByTestId('ml-response-chat-bubble')).toHaveCount(1)
        await provenance.captureCheckpoint('single-response-complete')
        await captureGuiFuzzStep(page, testInfo, 3, 'single-response-complete')

        await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
        await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
        await expect(copilot.conversationInput).toBeVisible()
        await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(1)
        await expect(page.getByTestId('ml-response-chat-bubble')).toHaveCount(1)
        // Keep the final transport observation window open long enough to
        // capture delayed control frames without making duplication an
        // expected test outcome.
        await page.waitForTimeout(500)
        await provenance.captureCheckpoint('completed-conversation-replayed')
        await captureGuiFuzzStep(
          page,
          testInfo,
          4,
          'completed-conversation-replayed'
        )
      } finally {
        await provenance.attach(testInfo)
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
