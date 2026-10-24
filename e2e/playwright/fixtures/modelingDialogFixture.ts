import { expect, type Locator, type Page } from '@playwright/test'

export class ModelingDialogFixture {
  readonly locator: Locator
  readonly submitButton: Locator
  readonly cancelButton: Locator
  readonly advanced: Locator

  constructor(private readonly page: Page) {
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

  async moveTo(position: { x: number; y: number }) {
    await this.locator.locator('header').dragTo(this.page.locator('body'), {
      sourcePosition: { x: 20, y: 20 },
      targetPosition: { x: position.x + 20, y: position.y + 20 },
    })
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

  async fillInput(label: string | RegExp, value: string) {
    const input = this.input(label)
    await input.press('ControlOrMeta+A')
    if (value) await this.page.keyboard.insertText(value)
    else await input.press('Backspace')
    await expect(input).toHaveText(value)
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
