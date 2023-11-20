const fs = require('fs/promises');

describe('Modeling App', () => {
  it('open the sign in page', async () => {
    // Clean up previous tests
    await new Promise(resolve => setTimeout(resolve, 100))
    await fs.rm('/tmp/kittycad_user_code', { force: true })
    await browser.execute('window.localStorage.clear()');

    const button = await $('#signin')
    expect(button).toHaveText('Sign in')

    // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
    await button.waitForClickable()
    await browser.execute('arguments[0].click();', button)
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get from main.rs
    const userCode = await (await fs.readFile('/tmp/kittycad_user_code')).toString()
    console.log(`Found user code ${userCode}`)

    // Device flow: verify
    const token = process.env.KITTYCAD_API_TOKEN
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      "Content-Type": "application/json",
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
    const newFileButton = await $('#new_file')
    await newFileButton.waitForClickable({ timeout: 30000 })
    expect(newFileButton).toHaveText('New file')
  })
})
