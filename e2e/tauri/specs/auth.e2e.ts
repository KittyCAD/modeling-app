import { browser, $, expect } from '@wdio/globals'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const isWin32 = os.platform() === 'win32'
const documentsDir = path.join(os.homedir(), 'Documents')
const userSettingsDir = path.join(
  os.homedir(),
  '.config',
  'dev.zoo.modeling-app'
)
const defaultProjectDir = path.join(documentsDir, 'zoo-modeling-app-projects')
const newProjectDir = path.join(documentsDir, 'a-different-directory')
const tmp = process.env.TEMP || '/tmp'
const userCodeDir = path.join(tmp, 'kittycad_user_code')

async function click(element: WebdriverIO.Element): Promise<void> {
  // Workaround for .click(), see https://github.com/tauri-apps/tauri/issues/6541
  await element.waitForClickable()
  await browser.execute('arguments[0].click();', element)
}

/* Shoutout to @Sheap on Github for a great workaround utility:
 * https://github.com/tauri-apps/tauri/issues/6541#issue-1638944060
 */
async function setDatasetValue(
  field: WebdriverIO.Element,
  property: string,
  value: string
) {
  await browser.execute(`arguments[0].dataset.${property} = "${value}"`, field)
}

describe('ZMA (Tauri)', () => {
  it('opens the auth page and signs in', async () => {
    // Clean up filesystem from previous tests
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await fs.rm(defaultProjectDir, { force: true, recursive: true })
    await fs.rm(newProjectDir, { force: true, recursive: true })
    await fs.rm(userCodeDir, { force: true })
    await fs.rm(userSettingsDir, { force: true, recursive: true })
    await fs.mkdir(defaultProjectDir, { recursive: true })
    await fs.mkdir(newProjectDir, { recursive: true })

    const signInButton = await $('[data-testid="sign-in-button"]')
    expect(await signInButton.getText()).toEqual('Sign in')

    await click(signInButton)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Get from main.rs
    const userCode = await (await fs.readFile(userCodeDir)).toString()
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
    await new Promise((resolve) => setTimeout(resolve, 10000))
    const newFileButton = await $('[data-testid="home-new-file"]')
    expect(await newFileButton.getText()).toEqual('New project')
  })

  it('opens the settings page, checks filesystem settings, and closes the settings page', async () => {
    const menuButton = await $('[data-testid="user-sidebar-toggle"]')
    await click(menuButton)

    const settingsButton = await $('[data-testid="settings-button"]')
    await click(settingsButton)

    const projectDirInput = await $('[data-testid="project-directory-input"]')
    expect(await projectDirInput.getValue()).toEqual(defaultProjectDir)

    /*
     * We've set up the project directory input (in initialSettings.tsx)
     * to be able to skip the folder selection dialog if data-testValue
     * has a value, allowing us to test the input otherwise works.
     */
    // TODO: understand why we need to force double \ on Windows
    await setDatasetValue(
      projectDirInput,
      'testValue',
      isWin32 ? newProjectDir.replaceAll('\\', '\\\\') : newProjectDir
    )
    const projectDirButton = await $('[data-testid="project-directory-button"]')
    await click(projectDirButton)
    await new Promise((resolve) => setTimeout(resolve, 500))
    // This line is broken. I need a different way to grab the toast
    await expect(await $('div*=Set project directory to')).toBeDisplayed()

    const nameInput = await $('[data-testid="projects-defaultProjectName"]')
    expect(await nameInput.getValue()).toEqual('project-$nnn')

    // Setting it back (for back to back local tests)
    await new Promise((resolve) => setTimeout(resolve, 5000))
    await setDatasetValue(
      projectDirInput,
      'testValue',
      isWin32 ? defaultProjectDir.replaceAll('\\', '\\\\') : newProjectDir
    )
    await click(projectDirButton)

    const closeButton = await $('[data-testid="settings-close-button"]')
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
    if (isWin32) {
      // TODO: actually do something to check that the stream is up
      await new Promise((resolve) => setTimeout(resolve, 5000))
    } else {
      const errorText = await $('[data-testid="unexpected-error"]')
      expect(await errorText.getText()).toContain('unexpected error')
    }
    const base = isWin32 ? 'http://tauri.localhost' : 'tauri://localhost'
    await browser.execute(`window.location.href = "${base}/home"`)
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
