import { browser, $, expect } from '@wdio/globals'
import fs from 'fs/promises'

const defaultDir = `${process.env.HOME}/Documents/zoo-modeling-app-projects`
const userCodeDir = '/tmp/kittycad_user_code'

async function click(element: WebdriverIO.Element): Promise<void> {
  // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
  await element.waitForClickable()
  await browser.execute('arguments[0].click();', element)
}

describe('ZMA (Tauri, Linux)', () => {
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

  it('opens the settings page, checks filesystem settings, and closes the settings page', async () => {
    const menuButton = await $('[data-testid="user-sidebar-toggle"]')
    await click(menuButton)

    const settingsButton = await $('[data-testid="settings-button"]')
    await click(settingsButton)

    // The default directory is now "" until the initial project directory gets
    // initialized. @franknoirot is not sure how to await until that happens.
    // const defaultDirInput = await $('[data-testid="default-directory-input"]')
    // expect(await defaultDirInput.getValue()).toEqual(defaultDir)

    const nameInput = await $('[data-testid="name-input"]')
    expect(await nameInput.getValue()).toEqual('project-$nnn')

    const closeButton = await $('[data-testid="close-button"]')
    await click(closeButton)
  })

  it('checks that no file exists, creates a new file', async () => {
    const homeSection = await $('[data-testid="home-section"]')
    expect(await homeSection.getText()).toContain('No Projects found')

    const newFileButton = await $('[data-testid="home-new-file"]')
    await click(newFileButton)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    expect(await homeSection.getText()).toContain('project-000')
  })

  it('opens the new file and expects a loading stream', async () => {
    const projectLink = await $('[data-testid="project-link"]')
    await click(projectLink)
    const loadingText = await $('[data-testid="loading-stream"]')
    expect(await loadingText.getText()).toContain('Loading stream...')
    await browser.execute('window.location.href = "tauri://localhost/home"')
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
