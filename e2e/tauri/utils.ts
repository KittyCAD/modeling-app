import { browser } from '@wdio/globals'

export async function click(element: WebdriverIO.Element): Promise<void> {
  // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
  await element.waitForClickable()
  await browser.execute('arguments[0].click();', element)
}

/* Shoutout to @Sheap on Github for a great workaround utility:
 * https://github.com/tauri-apps/tauri/issues/6541#issue-1638944060
 */
export async function setDatasetValue(
  field: WebdriverIO.Element,
  property: string,
  value: string
) {
  await browser.execute(`arguments[0].dataset.${property} = "${value}"`, field)
}
