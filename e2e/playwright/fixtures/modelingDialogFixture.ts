import { expect, type Locator, type Page } from '@playwright/test'

export class ModelingDialogFixture {
  readonly locator: Locator
  readonly submitButton: Locator
  readonly cancelButton: Locator
  readonly advanced: Locator

  constructor(page: Page) {
    this.locator = page.getByTestId('modeling-dialog')
    this.submitButton = this.locator.getByRole('button', {
      name: 'Submit',
      exact: true,
    })
    this.cancelButton = this.locator.getByRole('button', {
      name: 'Cancel',
      exact: true,
    })
    this.advanced = this.locator.getByText('Advanced', { exact: true })
  }

  async submit() {
    await this.submitButton.click()
    await expect(this.locator).not.toBeAttached()
  }

  variableCheckbox(argumentName: string) {
    return this.locator.locator(
      `#command-kcl-input-${argumentName}-variable-checkbox`
    )
  }

  input(label: string | RegExp) {
    return this.locator.getByRole('textbox', { name: label, exact: true })
  }

  options(label: string | RegExp) {
    return this.locator.getByRole('combobox', { name: label, exact: true })
  }

  selection(label: string) {
    return this.locator.getByRole('button', {
      name: `Select ${label}`,
      exact: true,
    })
  }
}
