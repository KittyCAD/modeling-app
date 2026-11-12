import { expect, test } from '@e2e/playwright/base-test'
import { ModelingDialogFixture } from '@e2e/playwright/fixtures/modelingDialogFixture'
import type { Page } from '@playwright/test'
import type * as ModelingDialogFields from '@e2e/playwright/lib/modelingDialogFieldTestUtils'

async function openDialog(page: Page, contents = '') {
  await page.route('**/__modeling_dialog_fixture__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<div id="dialog" data-testid="modeling-dialog">${contents}</div>`,
    })
  )
  await page.goto('/__modeling_dialog_fixture__')
  return new ModelingDialogFixture(page)
}

for (const initial of ['', '5']) {
  test(
    `replaces and clears ${initial ? 'prefilled' : 'empty optional'} CodeMirror fields`,
    { tag: '@web' },
    async ({ page }) => {
      const dialog = await openDialog(page)
      const editor = await page.evaluateHandle(async (initial) => {
        const modulePath = '/e2e/playwright/lib/modelingDialogFieldTestUtils.ts'
        const fields: typeof ModelingDialogFields = await import(modulePath)
        return fields.createModelingDialogField(initial)
      }, initial)
      for (const value of ['12', '[1mm, 2mm, 3mm]', '"named value"', '', '3']) {
        await dialog.fillInput('Length', value)
        await expect
          .poll(() => editor.evaluate((editor) => editor.contents()))
          .toBe(value)
      }
    }
  )
}

test(
  'updates native color and text fields through input events',
  { tag: '@web' },
  async ({ page }) => {
    const dialog = await openDialog(
      page,
      '<input type="color" role="textbox" name="color" aria-label="Color" value="#000000"><input name="tag" aria-label="Tag">'
    )
    const inputs = await page.evaluateHandle(() => {
      const values: Record<string, string> = {}
      document.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement)
          values[event.target.name] = event.target.value
      })
      return values
    })
    await dialog.fillInput('Color', '#ff0000')
    await dialog.fillInput('Tag', 'cap')
    expect(await inputs.jsonValue()).toEqual({ color: '#ff0000', tag: 'cap' })
  }
)
