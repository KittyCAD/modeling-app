const fs = require('fs/promises');

describe('Modeling App', () => {
  it('open the sign in page', async () => {
    const button = await $('#signin')
    expect(button).toHaveText('Sign in')

    // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
    await button.waitForClickable()
    await browser.execute('arguments[0].click();', button)
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Get from main.rs
    const verifyUrl = await (await fs.readFile('/tmp/kittycad_user_code')).toString()
    console.log(`Found ${verifyUrl}`)

    // Device flow: verify
    const token = process.env.KITTYCAD_API_TOKEN
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      "Content-Type": "application/json",
    }
    console.log(`GET ${verifyUrl}`)
    const vr = await fetch(verifyUrl, { headers })
    console.log(vr.status)
    const userCode = verifyUrl.split('user_code=')[1]

    // Device flow: confirm
    const confirmUrl = 'https://api.kittycad.io/oauth2/device/confirm'
    const data = JSON.stringify({ user_code: userCode })
    console.log(`POST ${confirmUrl}`)
    console.log(data)
    const cr = await fetch(confirmUrl, {
      headers,
      method: 'POST',
      body: data,
    })
    console.log(cr.status)

    // Now should be logged in
    await new Promise(resolve => setTimeout(resolve, 10000))
    const homeHeading = await $('section.flex.justify-between > h1')
    expect(homeHeading).toHaveText('Your Projects')
  })
})
