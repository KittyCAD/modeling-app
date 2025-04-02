import type { Locator, Page, Request, Route, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

type CmdBarSerialised =
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
    }

export class CmdBarFixture {
  public page: Page
  public cmdBarOpenBtn!: Locator
  public cmdBarElement!: Locator

  constructor(page: Page) {
    this.page = page
    this.cmdBarOpenBtn = this.page.getByTestId('command-bar-open-button')
    this.cmdBarElement = this.page.getByTestId('command-bar')
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
    // FIXME: Progressing the command bar is a race condition. We have an async useEffect that reports the final state via useCalculateKclExpression. If this does not run quickly enough, it will not "fail" the continue because you can press continue if the state is not ready. E2E tests do not know this.
    // Wait 1250ms to assume the await executeAst of the KCL input field is finished
    await this.page.waitForTimeout(1250)
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

  openCmdBar = async (selectCmd?: 'promptToEdit') => {
    await this.cmdBarOpenBtn.click()
    await expect(this.page.getByPlaceholder('Search commands')).toBeVisible()
    if (selectCmd === 'promptToEdit') {
      const promptEditCommand = this.page.getByText(
        'Use Zoo AI to edit your kcl'
      )
      await expect(promptEditCommand.first()).toBeVisible()
      await promptEditCommand.first().scrollIntoViewIfNeeded()
      await promptEditCommand.first().click()
    }
  }

  get cmdSearchInput() {
    return this.page.getByTestId('cmd-bar-search')
  }

  get argumentInput() {
    return this.page.getByTestId('cmd-bar-arg-value')
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
   * Captures a snapshot of the request sent to the text-to-cad API endpoint
   * and saves it to a file named after the current test.
   *
   * The snapshot file will be saved in the specified directory with a filename
   * derived from the test's full path (including describe blocks).
   *
   * @param testInfoInOrderToGetTestTitle The TestInfo object from the test context
   * @param customOutputDir Optional custom directory for the output file
   */
  async captureTextToCadRequestSnapshot(
    testInfoInOrderToGetTestTitle: TestInfo,
    customOutputDir = 'e2e/playwright/snapshots/prompt-to-edit'
  ) {
    // First sanitize each title component individually
    const sanitizedTitleComponents = [
      ...testInfoInOrderToGetTestTitle.titlePath.slice(0, -1), // Get all parent titles
      testInfoInOrderToGetTestTitle.title, // Add the test title
    ].map(
      (component) =>
        component
          .replace(/[^a-z0-9]/gi, '-') // Replace non-alphanumeric chars with hyphens
          .toLowerCase()
          .replace(/-+/g, '-') // Replace multiple consecutive hyphens with a single one
          .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    )

    // Join the sanitized components with -- as a clear separator
    const sanitizedTestName = sanitizedTitleComponents.join('--')

    // Create the output path
    const outputPath = path.join(
      customOutputDir,
      `${sanitizedTestName}.snap.json`
    )

    // Create a handler function that saves request bodies to a file
    const requestHandler = (route: Route, request: Request) => {
      try {
        const requestBody = request.postDataJSON()

        // Ensure directory exists
        const dir = path.dirname(outputPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        // Write the request body to the file
        fs.writeFileSync(outputPath, JSON.stringify(requestBody, null, 2))

        console.log(`Saved text-to-cad API request to: ${outputPath}`)
      } catch (error) {
        console.error('Error processing text-to-cad request:', error)
      }

      // Use void to explicitly mark the promise as ignored
      void route.continue()
    }

    // Start monitoring requests
    await this.page.route('**/ml/text-to-cad/iteration', requestHandler)

    console.log(
      `Monitoring text-to-cad API requests. Output will be saved to: ${outputPath}`
    )
  }
}
