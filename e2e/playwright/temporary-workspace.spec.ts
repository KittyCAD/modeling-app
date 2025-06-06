import { expect, test } from '@e2e/playwright/zoo-test'
import { stringToBase64 } from '@src/lib/base64'

test.describe('Temporary workspace', () => {
  test(
    'Opening a share link creates a temporary environment that is not saved.',
    { tag: ['@web'] },
    async ({ page, editor, scene, cmdBar, homePage }) => {
      await test.step('Pre-condition: editor is empty', async () => {
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('')
      })

      await test.step('Go to share link, check new content present, make a change, refresh page', async () => {
        const code = `sketch001 = startSketchOn(XY)
  profile001 = startProfile(sketch001, at = [-124.89, -186.4])
    |> line(end = [391.31, 444.04])
    |> line(end = [96.21, -493.07])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(profile001, length = 5)
`

        const codeQueryParam = encodeURIComponent(stringToBase64(code))
        const targetURL = `?create-file=true&browser=test&code=${codeQueryParam}&ask-open-desktop=true`
        await page.goto(page.url() + targetURL)
        expect(page.url()).toContain(targetURL)
        const button = page.getByRole('button', { name: 'Continue to web app' })
        await button.click()

        await editor.expectEditor.toContain(code, { shouldNormalise: true })
        await editor.scrollToText('-124.89', true)
        await page.keyboard.press('9')
        await page.keyboard.press('9')
        await page.reload()
      })

      await test.step('Post-condition: empty editor once again (original state)', async () => {
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('')
      })
    }
  )

  test(
    'happens on sample load request',
    { tag: ['@web'] },
    async ({ page, editor, scene, cmdBar, homePage }) => {
      await test.step('Pre-condition: editor is empty', async () => {
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('')
      })

      await test.step('Load sample, make an edit, and refresh', async () => {
        await page.goto(
          `${page.url()}/?cmd=add-kcl-file-to-project&groupId=application&projectName=browser&source=kcl-samples&sample=brake-rotor/main.kcl`
        )

        await editor.scrollToText('114.3', true)
        await page.keyboard.press('9')
        await page.keyboard.press('9')
        await page.reload()
      })

      await test.step('Post-condition: empty editor once again (original state)', async () => {
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('')
      })
    }
  )
})
