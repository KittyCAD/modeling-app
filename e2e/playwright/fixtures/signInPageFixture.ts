import type { Locator, Page } from '@playwright/test'
import { secrets } from '@e2e/playwright/secrets'

export class SignInPageFixture {
  public page: Page

  signInButton!: Locator
  cancelSignInButton!: Locator
  userCode!: Locator

  apiBaseUrl!: string

  constructor(page: Page) {
    this.page = page

    this.signInButton = this.page.getByTestId('sign-in-button')
    this.cancelSignInButton = this.page.getByTestId('cancel-sign-in-button')
    this.userCode = this.page.getByTestId('sign-in-user-code')

    // TODO: set this thru env var
    this.apiBaseUrl = 'https://api.dev.zoo.dev'
  }

  async vefifyAndConfirmAuth(userCode: string) {
    // Device flow: stolen from the tauri days
    // https://github.com/KittyCAD/modeling-app/blob/d916c7987452e480719004e6d11fd2e595c7d0eb/e2e/tauri/specs/app.spec.ts#L19
    const headers = {
      Authorization: `Bearer ${secrets.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    const verifyUrl = `${this.apiBaseUrl}/oauth2/device/verify?user_code=${userCode}`
    console.log(`GET ${verifyUrl}`)
    const vr = await fetch(verifyUrl, { headers })
    console.log(vr.status)

    // Device flow: confirm
    const confirmUrl = `${this.apiBaseUrl}/oauth2/device/confirm`
    const data = JSON.stringify({ user_code: userCode })
    console.log(`POST ${confirmUrl} ${data}`)
    const cr = await fetch(confirmUrl, {
      headers,
      method: 'POST',
      body: data,
    })
    console.log(cr.status)
  }
}
