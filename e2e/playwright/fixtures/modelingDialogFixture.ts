import { expect, type Locator, type Page } from '@playwright/test'
import { escapeRegExp } from '@e2e/playwright/test-utils'

// Match the full label, ignoring case and the required-field marker.
const fieldLabel = (label: string) =>
  new RegExp(`^${escapeRegExp(label)}(?: \\*)?$`, 'i')

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

  input(label: string) {
    return this.locator.getByRole('textbox', { name: fieldLabel(label) })
  }

  async fillInput(label: string, value: string) {
    const input = this.input(label)
    await input.press('ControlOrMeta+A')
    if (value) {
      await this.page.keyboard.insertText(value)
      await expect(input).toHaveText(value)
    } else {
      await input.press('Backspace')
    }
  }

  options(label: string) {
    return this.locator.getByRole('combobox', { name: fieldLabel(label) })
  }

  selection(label: string) {
    return this.locator.getByRole('button', {
      name: `Select ${label}`,
      exact: true,
    })
  }
}
