import { browser, $, expect } from '@wdio/globals'
import fs from 'fs/promises'

describe('KCMA (Tauri, Linux)', () => {
  it('opens the auth page and signs in', async () => {
    // Clean up previous tests
    await new Promise((resolve) => setTimeout(resolve, 100))
    await fs.rm('/tmp/kittycad_user_code', { force: true })
    await browser.execute('window.localStorage.clear()')

    const signInButton = await $('[data-testid="sign-in-button"]')
    expect(await signInButton.getText()).toEqual('Sign in')

    // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
    await signInButton.waitForClickable()
    await browser.execute('arguments[0].click();', signInButton)
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
    const apiBaseUrl = process.env.VITE_KC_API_BASE_URL
    const verifyUrl = `${apiBaseUrl}/oauth2/device/verify?user_code=${userCode}`
    console.log(`GET ${verifyUrl}`)
    const vr = await fetch(verifyUrl, { headers })
    console.log(vr.status)

    // Device flow: confirm
    const confirmUrl = `${apiBaseUrl}/oauth2/device/confirm`
    const data = JSON.stringify({ user_code: userCode })
    console.log(`POST ${confirmUrl} ${data}`)
    const cr = await fetch(confirmUrl, {
      headers,
      method: 'POST',
      body: data,
    })
    console.log(cr.status)

    // Now should be signed in
    const newFileButton = await $('[data-testid="home-new-file"]')
    expect(await newFileButton.getText()).toEqual('New file')
  })

  it('creates a new file', async () => {
    const newFileButton = await $('[data-testid="home-new-file"]')
    await newFileButton.waitForClickable()
    await browser.execute('arguments[0].click();', newFileButton)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    // TODO: check that it worked, and oepen it
  })

  it('signs out', async () => {
    const menuButton = await $('[data-testid="user-sidebar-toggle"]')
    await menuButton.waitForClickable()
    await browser.execute('arguments[0].click();', menuButton)
    const signoutButton = await $('[data-testid="user-sidebar-sign-out"]')
    await signoutButton.waitForClickable()
    await browser.execute('arguments[0].click();', signoutButton)
    const newSignInButton = await $('[data-testid="sign-in-button"]')
    expect(await newSignInButton.getText()).toEqual('Sign in')
  })
})
