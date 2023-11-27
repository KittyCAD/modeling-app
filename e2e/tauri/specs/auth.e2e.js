const fs = require('fs/promises')

describe('The tauri Linux KCMA', () => {
  it('opens the auth page, and proceeds to sign in', async () => {
    // Clean up previous tests
    await new Promise((resolve) => setTimeout(resolve, 100))
    await fs.rm('/tmp/kittycad_user_code', { force: true })
    await browser.execute('window.localStorage.clear()')

    const button = await $('[data-testid="sign-in-button"]')
    expect(button).toHaveText('Sign in')

    // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
    await button.waitForClickable()
    await browser.execute('arguments[0].click();', button)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Get from main.rs
    const userCode = await (
      await fs.readFile('/tmp/kittycad_user_code')
    ).toString()
    console.log(`Found user code ${userCode}`)

    // Device flow: verify
    const token = process.env.KITTYCAD_API_TOKEN
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    const verifyUrl = `https://api.kittycad.io/oauth2/device/verify?user_code=${userCode}`
    console.log(`GET ${verifyUrl}`)
    const vr = await fetch(verifyUrl, { headers })
    console.log(vr.status)

    // Device flow: confirm
    const confirmUrl = 'https://api.kittycad.io/oauth2/device/confirm'
    const data = JSON.stringify({ user_code: userCode })
    console.log(`POST ${confirmUrl} ${data}`)
    const cr = await fetch(confirmUrl, {
      headers,
      method: 'POST',
      body: data,
    })
    console.log(cr.status)

    // Now should be logged in
    const newFileButton = await $('[data-testid="home-new-file"]')
    await newFileButton.waitForClickable({ timeout: 30000 })
    expect(newFileButton).toHaveText('New file')

    // So let's log out!
    const menuButton = await $('[data-testid="user-sidebar-toggle"]')
    await menuButton.waitForClickable()
    await browser.execute('arguments[0].click();', menuButton)
    const signoutButton = await $('[data-testid="user-sidebar-sign-out"]')
    await signoutButton.waitForClickable()
    await browser.execute('arguments[0].click();', signoutButton)
  })
})
