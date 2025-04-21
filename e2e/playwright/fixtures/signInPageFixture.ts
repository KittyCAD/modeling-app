import type { Locator, Page } from '@playwright/test'

export class SignInPageFixture {
  public page: Page

  signInButton!: Locator
  cancelSignInButton!: Locator
  userCode!: Locator

  constructor(page: Page) {
    this.page = page

    this.signInButton = this.page.getByTestId('sign-in-button')
    this.cancelSignInButton = this.page.getByTestId('cancel-sign-in-button')
    this.userCode = this.page.getByTestId('sign-in-user-code')
  }
}
