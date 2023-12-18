import { browser, $, expect } from '@wdio/globals'
import fs from 'fs/promises'

const defaultDir = `${process.env.HOME}/Documents/kittycad-modeling-projects`
const userCodeDir = '/tmp/kittycad_user_code'

async function click(element: WebdriverIO.Element): Promise<void> {
  // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
  await element.waitForClickable()
  await browser.execute('arguments[0].click();', element)
}

describe('KCMA (Tauri, Linux)', () => {
  it('opens the auth page and signs in', async () => {
    // Clean up filesystem from previous tests
    await new Promise((resolve) => setTimeout(resolve, 100))
    await fs.rm(defaultDir, { force: true, recursive: true })
    await fs.rm(userCodeDir, { force: true })

    const signInButton = await $('[data-testid="sign-in-button"]')
    expect(await signInButton.getText()).toEqual('Sign in')

    await click(signInButton)
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

  it('opens the settings, checks the projecte dir, and closes the settings', async () => {
    const menuButton = await $('[data-testid="user-sidebar-toggle"]')
    await click(menuButton)

    const settingsButton = await $('[data-testid="settings-button"]')
    await click(settingsButton)
    const input = await $('[data-testid="default-directory-input"]')
    expect(await input.getValue()).toEqual(defaultDir)
    await new Promise((resolve) => setTimeout(resolve, 3000))

    const closeButton = await $('[data-testid="close-button"]')
    await click(closeButton)
  })

  it('creates a new file', async () => {
    const newFileButton = await $('[data-testid="home-new-file"]')
    await click(newFileButton)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    // TODO: check that it worked, and oepen it
  })

  it('signs out', async () => {
    const menuButton = await $('[data-testid="user-sidebar-toggle"]')
    await click(menuButton)
    const signoutButton = await $('[data-testid="user-sidebar-sign-out"]')
    await click(signoutButton)
    const newSignInButton = await $('[data-testid="sign-in-button"]')
    expect(await newSignInButton.getText()).toEqual('Sign in')
  })
})
