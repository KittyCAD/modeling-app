export async function click(element: WebdriverIO.Element): Promise<void> {
  // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
  await element.waitForClickable()
  await browser.execute('arguments[0].click();', element)
}
