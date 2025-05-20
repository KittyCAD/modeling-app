import * as fs from 'fs'
import * as path from 'path'
import type { Locator, Page, Request, Route, TestInfo } from '@playwright/test'
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
    await this.page.waitForTimeout(2000)
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
      const promptEditCommand = this.selectOption({ name: 'Text-to-CAD Edit' })
      await expect(promptEditCommand.first()).toBeVisible()
      await promptEditCommand.first().scrollIntoViewIfNeeded()
      await promptEditCommand.first().click()
    }
  }

  closeCmdBar = async () => {
    const cmdBarCloseBtn = this.page.getByTestId('command-bar-close-button')
    await cmdBarCloseBtn.click()
    await expect(this.cmdBarElement).not.toBeVisible()
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
   * Clicks the Create new variable button for kcl input
   */
  createNewVariable = async () => {
    await this.page.getByRole('button', { name: 'Create new variable' }).click()
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
        // Get the raw post data
        const postData = request.postData()
        if (!postData) {
          console.error('No post data found in request')
          return
        }

        // Extract all parts from the multipart form data
        const boundary = postData.match(/------WebKitFormBoundary[^\r\n]*/)?.[0]
        if (!boundary) {
          console.error('Could not find form boundary')
          return
        }

        const parts = postData.split(boundary).filter((part) => part.trim())
        const files: Record<string, string> = {}
        let eventData = null

        for (const part of parts) {
          // Skip the final boundary marker
          if (part.startsWith('--')) continue

          const nameMatch = part.match(/name="([^"]+)"/)
          if (!nameMatch) continue

          const name = nameMatch[1]
          const content = part.split(/\r?\n\r?\n/)[1]?.trim()
          if (!content) continue

          if (name === 'event') {
            eventData = JSON.parse(content)
          } else {
            files[name] = content
          }
        }

        if (!eventData) {
          console.error('Could not find event JSON in multipart form data')
          return
        }

        const requestBody = {
          ...eventData,
          files,
        }

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
    await this.page.route(
      '**/ml/text-to-cad/multi-file/iteration',
      requestHandler
    )

    console.log(
      `Monitoring text-to-cad API requests. Output will be saved to: ${outputPath}`
    )
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
    const actual = await this.cmdBarElement
      .getByTestId('command-name')
      .textContent()
    const expected = value
    expect(actual).toBe(expected)
  }
}
