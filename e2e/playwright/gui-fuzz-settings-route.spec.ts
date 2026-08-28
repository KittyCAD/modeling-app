import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
} from '@e2e/playwright/guiFuzzUtils'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

test.describe(
  'GUI fuzz minimization: Settings route normalization',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('reload exposes a normalized Settings link for a file route', async ({
      editor,
      page,
      scene,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Settle the fresh file route', async () => {
          await scene.connectionEstablished()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 0, 'file-route-ready')
        })

        const fileUrl = new URL(page.url())
        const expectedSettingsHref = `${fileUrl.pathname}/settings?tab=project`

        await test.step('Reload and inspect the Settings status link', async () => {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await scene.connectionEstablished()
          await scene.settled()

          const settingsLink = page.getByTestId('settings-link')
          await expect(settingsLink).toBeVisible()
          const actualSettingsHref = await settingsLink.getAttribute('href')
          await testInfo.attach('settings-link-href.txt', {
            body: `expected: ${expectedSettingsHref}\nactual: ${actualSettingsHref ?? '<missing>'}\n`,
            contentType: 'text/plain',
          })
          await captureGuiFuzzStep(
            page,
            testInfo,
            1,
            'settings-link-after-reload'
          )

          await settingsLink.click()
          await expect(page.getByTestId('settings-dialog-panel')).toBeVisible()
          await expect(page).toHaveURL(
            new RegExp(`${fileUrl.pathname}/settings\\?tab=project$`)
          )
          const settingsHrefWhileOpen = await settingsLink.getAttribute('href')
          await testInfo.attach('settings-link-href-while-open.txt', {
            body: `expected: ${expectedSettingsHref}\nactual: ${settingsHrefWhileOpen ?? '<missing>'}\n`,
            contentType: 'text/plain',
          })
          await captureGuiFuzzStep(page, testInfo, 2, 'project-settings-opened')

          await page.getByTestId('settings-close-button').click()
          await expect(page.getByTestId('settings-dialog-panel')).toHaveCount(0)
          await captureGuiFuzzStep(page, testInfo, 3, 'returned-to-file-route')

          expect(actualSettingsHref).toBe(expectedSettingsHref)
          expect.soft(settingsHrefWhileOpen).toBe(expectedSettingsHref)
          const doubleSlashWarnings = runtimeEvents.filter((event) =>
            event.message.includes(
              'Pathnames cannot have embedded double slashes'
            )
          )
          await testInfo.attach('embedded-double-slash-warnings.txt', {
            body: doubleSlashWarnings.map((event) => event.message).join('\n'),
            contentType: 'text/plain',
          })
          expect(doubleSlashWarnings).toHaveLength(0)
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
