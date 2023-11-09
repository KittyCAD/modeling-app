describe('Modeling App', () => {
  it('open the sign in page', async () => {
    const button = await $('#signin')
    expect(button).toHaveText('Sign in')
    
    // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
    await button.waitForClickable()
    await browser.execute('arguments[0].click();', button)
    // TODO: handle auth
    await new Promise(resolve => setTimeout(resolve, 1000))
  })
})
