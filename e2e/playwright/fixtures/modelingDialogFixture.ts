import { expect, type Locator, type Page } from '@playwright/test'
import { escapeRegExp } from '@e2e/playwright/test-utils'

// Match the full label, ignoring case and the required-field marker.
const fieldLabel = (label: string | RegExp) =>
  typeof label === 'string'
    ? new RegExp(`^${escapeRegExp(label)}(?: \\*)?$`, 'i')
    : label

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
    return this.locator.getByRole('textbox', { name: fieldLabel(label) })
  }

  async fillInput(label: string | RegExp, value: string) {
    const input = this.input(label)
    const native = await input.evaluate(
      (element) =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
    )
    if (native) {
      await input.fill(value)
      await expect(input).toHaveValue(value)
      return
    }
    const empty = await input.evaluate(
      (element) =>
        !element.textContent || !!element.querySelector('.cm-placeholder')
    )
    await expect(input).toBeEditable()
    if (empty) await input.click()
    else await input.press('ControlOrMeta+A')
    if (value) {
      // Native insertion into empty dialog fields crashes Mac WebKit.
      await input.evaluate((element, text) => {
        const clipboardData = new DataTransfer()
        clipboardData.setData('text/plain', text)
        element.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData,
            bubbles: true,
            cancelable: true,
          })
        )
      }, value)
      await expect(input).toHaveText(value)
    } else if (!empty) {
      await input.press('Backspace')
    }
  }

  options(label: string | RegExp) {
    return this.locator.getByRole('combobox', { name: fieldLabel(label) })
  }

  selectedOption(label: string | RegExp) {
    return this.options(label).locator('option:checked')
  }

  selection(label: string) {
    return this.locator.getByRole('button', {
      name: `Select ${label}`,
      exact: true,
    })
  }
}
