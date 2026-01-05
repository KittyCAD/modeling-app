import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export type CmdBarSerialised =
  | {
      stage: 'commandBarClosed'
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
      reviewValidationError?: string
    }

export class CmdBarFixture {
  public page: Page
  public cmdBarOpenBtn!: Locator
  public cmdBarElement!: Locator
  public cmdBarLoadingCheckingArguments!: Locator

  constructor(page: Page) {
    this.page = page
    this.cmdBarOpenBtn = this.page.getByTestId('command-bar-open-button')
    this.cmdBarElement = this.page.getByTestId('command-bar')
    this.cmdBarLoadingCheckingArguments = this.page.getByTestId(
      'command-bar-loading-checking-arguments'
    )
  }

  get currentArgumentInput() {
    return this.page.getByTestId('cmd-bar-arg-value')
  }

  private _serialiseCmdBar = async (): Promise<CmdBarSerialised> => {
    if (!(await this.page.getByTestId('command-bar-wrapper').isVisible())) {
      return { stage: 'commandBarClosed' }
    } else if (await this.page.getByTestId('cmd-bar-search').isVisible()) {
      return { stage: 'pickCommand' }
    }
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
    const getReviewValidationError = async () => {
      const locator = this.page.getByTestId('cmd-bar-review-validation-error')
      if (!(await locator.isVisible())) return undefined
      return (await locator.textContent()) || undefined
    }
    if (await reviewForm.isVisible()) {
      const [headerArguments, commandName, reviewValidationError] =
        await Promise.all([
          getHeaderArgs(),
          getCommandName(),
          getReviewValidationError(),
        ])
      return {
        stage: 'review',
        headerArguments,
        commandName: commandName || '',
        reviewValidationError,
      }
    }

    // Check if we're dealing with vector2d inputs
    const vector2dInputsExist = await this.page
      .getByTestId('vector2d-x-input')
      .isVisible()
      .catch(() => false)
    if (vector2dInputsExist) {
      // Validate that both vector2d inputs are present
      const inputsPresent = await Promise.all([
        this.page.getByTestId('vector2d-x-input').isVisible(),
        this.page.getByTestId('vector2d-y-input').isVisible(),
      ])

      if (!inputsPresent.every(Boolean)) {
        throw new Error('Not all vector2d inputs are present')
      }

      const [
        headerArguments,
        highlightedHeaderArg,
        commandName,
        xValue,
        yValue,
      ] = await Promise.all([
        getHeaderArgs(),
        this.page
          .locator('[data-is-current-arg="true"]')
          .locator('[data-test-name="arg-name"]')
          .textContent(),
        getCommandName(),
        this.page.getByTestId('vector2d-x-input').inputValue(),
        this.page.getByTestId('vector2d-y-input').inputValue(),
      ])

      const vectorValue = `[${xValue}, ${yValue}]`

      return {
        stage: 'arguments',
        currentArgKey: highlightedHeaderArg || '',
        currentArgValue: vectorValue,
        headerArguments,
        highlightedHeaderArg: highlightedHeaderArg || '',
        commandName: commandName || '',
      }
    }

    // Check if we're dealing with vector3d inputs
    const vector3dInputsExist = await this.page
      .getByTestId('vector3d-x-input')
      .isVisible()
      .catch(() => false)
    if (vector3dInputsExist) {
      // Validate that all three vector3d inputs are present
      const inputsPresent = await Promise.all([
        this.page.getByTestId('vector3d-x-input').isVisible(),
        this.page.getByTestId('vector3d-y-input').isVisible(),
        this.page.getByTestId('vector3d-z-input').isVisible(),
      ])

      if (!inputsPresent.every(Boolean)) {
        throw new Error('Not all vector3d inputs are present')
      }

      const [
        headerArguments,
        highlightedHeaderArg,
        commandName,
        xValue,
        yValue,
        zValue,
      ] = await Promise.all([
        getHeaderArgs(),
        this.page
          .locator('[data-is-current-arg="true"]')
          .locator('[data-test-name="arg-name"]')
          .textContent(),
        getCommandName(),
        this.page.getByTestId('vector3d-x-input').inputValue(),
        this.page.getByTestId('vector3d-y-input').inputValue(),
        this.page.getByTestId('vector3d-z-input').inputValue(),
      ])

      const vectorValue = `[${xValue}, ${yValue}, ${zValue}]`

      return {
        stage: 'arguments',
        currentArgKey: highlightedHeaderArg || '',
        currentArgValue: vectorValue,
        headerArguments,
        highlightedHeaderArg: highlightedHeaderArg || '',
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
    if (expected.stage === 'review') {
      await this.cmdBarLoadingCheckingArguments.waitFor({ state: 'hidden' })
    } else if (expected.stage === 'commandBarClosed') {
      await expect(this.cmdBarElement).not.toBeAttached()
    }

    return expect.poll(() => this._serialiseCmdBar()).toEqual(expected)
  }
  /**
   * This method is used to progress the command bar to the next step, defaulting to clicking the next button.
   * Optionally, with the `shouldUseKeyboard` parameter, it will hit `Enter` to progress.
   * * TODO: This method assumes the user has a valid input to the current stage,
   * and assumes we are past the `pickCommand` step.
   */
  progressCmdBar = async (shouldUseKeyboard = false) => {
    await this.page.waitForTimeout(2000)
    if (shouldUseKeyboard) {
      await this.page.keyboard.press('Enter')
      return
    }

    const arrowButton = this.page.getByTestId('command-bar-continue')
    if (await arrowButton.isVisible()) {
      await this.continue()
    } else {
      await this.submit()
    }
  }

  // Added data-testid to the command bar buttons
  // command-bar-continue are the buttons to go to the next step
  // does not include the submit which is the final button press
  // aka the right arrow button
  continue = async () => {
    const continueButton = this.page.getByTestId('command-bar-continue')
    await continueButton.click()
  }

  // Added data-testid to the command bar buttons
  // command-bar-submit is the button for the final step to submit
  // the command bar flow aka the checkmark button.
  submit = async () => {
    const submitButton = this.page.getByTestId('command-bar-submit')
    await submitButton.click()
  }

  openCmdBar = async () => {
    await this.cmdBarOpenBtn.click()
    await expect(this.page.getByPlaceholder('Search commands')).toBeVisible()
  }

  closeCmdBar = async () => {
    const cmdBarCloseBtn = this.page.getByTestId('command-bar-close-button')
    await cmdBarCloseBtn.click()
    await expect(this.cmdBarElement).not.toBeVisible()
  }

  get clearNonRequiredButton() {
    return this.page.getByTestId('command-bar-clear-non-required-button')
  }

  get cmdSearchInput() {
    return this.page.getByTestId('cmd-bar-search')
  }

  get argumentInput() {
    return this.page.getByTestId('cmd-bar-arg-value')
  }

  get variableCheckbox() {
    return this.page.getByTestId('cmd-bar-variable-checkbox')
  }

  get cmdOptions() {
    return this.page.getByTestId('cmd-bar-option')
  }

  chooseCommand = async (commandName: string) => {
    await this.cmdOptions.getByText(commandName).click()
  }

  /**
   * Select an option from the command bar
   */
  selectOption = (options: Parameters<typeof this.page.getByRole>[1]) => {
    return this.page.getByRole('option', options)
  }

  /**
   * Select an optional argument from the command bar during review
   */
  clickOptionalArgument = async (argName: string) => {
    await this.page.getByTestId(`cmd-bar-add-optional-arg-${argName}`).click()
  }

  /**
   * Select an argument in header from the command bar
   */
  clickHeaderArgument = async (argName: string) => {
    await this.page.getByTestId(`arg-name-${argName}`).click()
  }

  /**
   * Clicks the Create new variable button for kcl input
   */
  createNewVariable = async () => {
    await this.variableCheckbox.click()
  }

  async toBeOpened() {
    // Check that the command bar is opened
    await expect(this.cmdBarElement).toBeVisible({ timeout: 10_000 })
  }

  async toBeClosed() {
    // Check that the command bar is closed
    await expect(this.cmdBarElement).not.toBeVisible({ timeout: 10_000 })
  }

  async expectArgValue(value: string) {
    // Check the placeholder project name exists
    const actualArgument = await this.cmdBarElement
      .getByTestId('cmd-bar-arg-value')
      .inputValue()
    const expectedArgument = value
    expect(actualArgument).toBe(expectedArgument)
  }

  async expectCommandName(value: string) {
    // Check the placeholder project name exists
    const cmdNameElement = this.cmdBarElement.getByTestId('command-name')
    return await expect(cmdNameElement).toHaveText(value)
  }
}
