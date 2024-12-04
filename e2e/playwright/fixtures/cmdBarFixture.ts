import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

type CmdBarSerialised =
  | {
      stage: 'commandBarClosed'
      // TODO no more properties needed but needs to be implemented in _serialiseCmdBar
    }
  | {
      stage: 'pickCommand'
      // TODO this will need more properties when implemented in _serialiseCmdBar
    }
  | {
      stage: 'arguments'
      currentArgKey: string
      currentArgValue: string
      headerArguments: Record<string, string>
      highlightedHeaderArg: string
      commandName: string
    }
  | {
      stage: 'review'
      headerArguments: Record<string, string>
      commandName: string
    }

export class CmdBarFixture {
  public page: Page

  constructor(page: Page) {
    this.page = page
  }
  reConstruct = (page: Page) => {
    this.page = page
  }

  private _serialiseCmdBar = async (): Promise<CmdBarSerialised> => {
    const reviewForm = this.page.locator('#review-form')
    const getHeaderArgs = async () => {
      const inputs = await this.page.getByTestId('cmd-bar-input-tab').all()
      const entries = await Promise.all(
        inputs.map((input) => {
          const key = input
            .locator('[data-test-name="arg-name"]')
            .innerText()
            .then((a) => a.trim())
          const value = input
            .getByTestId('header-arg-value')
            .innerText()
            .then((a) => a.trim())
          return Promise.all([key, value])
        })
      )
      return Object.fromEntries(entries)
    }
    const getCommandName = () =>
      this.page.getByTestId('command-name').textContent()
    if (await reviewForm.isVisible()) {
      const [headerArguments, commandName] = await Promise.all([
        getHeaderArgs(),
        getCommandName(),
      ])
      return {
        stage: 'review',
        headerArguments,
        commandName: commandName || '',
      }
    }
    const [
      currentArgKey,
      currentArgValue,
      headerArguments,
      highlightedHeaderArg,
      commandName,
    ] = await Promise.all([
      this.page.getByTestId('cmd-bar-arg-name').textContent(),
      this.page.getByTestId('cmd-bar-arg-value').textContent(),
      getHeaderArgs(),
      this.page
        .locator('[data-is-current-arg="true"]')
        .locator('[data-test-name="arg-name"]')
        .textContent(),
      getCommandName(),
    ])
    return {
      stage: 'arguments',
      currentArgKey: currentArgKey || '',
      currentArgValue: currentArgValue || '',
      headerArguments,
      highlightedHeaderArg: highlightedHeaderArg || '',
      commandName: commandName || '',
    }
  }
  expectState = async (expected: CmdBarSerialised) => {
    return expect.poll(() => this._serialiseCmdBar()).toEqual(expected)
  }
  /** The method will use buttons OR press enter randomly to progress the cmdbar,
   * this could have unexpected results depending on what's focused
   *
   * TODO: This method assumes the user has a valid input to the current stage,
   * and assumes we are past the `pickCommand` step.
   */
  progressCmdBar = async (shouldFuzzProgressMethod = true) => {
    if (shouldFuzzProgressMethod || Math.random() > 0.5) {
      const arrowButton = this.page.getByRole('button', {
        name: 'arrow right Continue',
      })
      if (await arrowButton.isVisible()) {
        await arrowButton.click()
      } else {
        await this.page
          .getByRole('button', { name: 'checkmark Submit command' })
          .click()
      }
    } else {
      await this.page.keyboard.press('Enter')
    }
  }
}
