import {
  assertErrorModelPreserved,
  assertModelLoaded,
  ERROR_MODEL_PROFILES,
} from '@e2e/performance/models'
import { prepareModeling } from '@e2e/performance/scenarios'
import { expect, test } from '@e2e/performance/test'

for (const profile of ERROR_MODEL_PROFILES) {
  test.describe(profile, () => {
    test.use({ modelProfile: profile })

    test('error-profile guard rejects an accidental successful execution', async ({
      page,
      homePage,
      scene,
      fs,
      folderSetupFn,
      modelProfile,
    }) => {
      const fixtures = {
        page,
        homePage,
        scene,
        fs,
        folderSetupFn,
        modelProfile,
      }
      await prepareModeling(fixtures)
      const before = await assertModelLoaded(fixtures)

      // Exercise the regression through the real editor, not a fabricated receipt:
      // removing the trailing error must never turn this profile into a green run.
      await page.locator('#code-pane .cm-content').press('ControlOrMeta+A')
      await page.keyboard.insertText(before.lastSuccessfulCode)
      await page.waitForFunction(() => {
        const editor = window.app.project?.executingEditor.value
        return Boolean(
          editor &&
            !editor.isExecutingSignal.value &&
            !editor.hasErrors() &&
            editor.lastSuccessfulCode === editor.code &&
            Object.keys(editor.engineCommandManager.pendingCommands).length ===
              0
        )
      })
      await expect(assertErrorModelPreserved(fixtures, before)).rejects.toThrow(
        'The expected error disappeared'
      )
    })
  })
}
