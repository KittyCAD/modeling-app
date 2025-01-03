import type { Page, Locator } from '@playwright/test'
import { expect } from './fixtureSetup'
import { doAndWaitForImageDiff } from '../test-utils'

export class ToolbarFixture {
  public page: Page

  extrudeButton!: Locator
  loftButton!: Locator
  filletButton!: Locator
  shellButton!: Locator
  offsetPlaneButton!: Locator
  startSketchBtn!: Locator
  lineBtn!: Locator
  rectangleBtn!: Locator
  exitSketchBtn!: Locator
  editSketchBtn!: Locator
  fileTreeBtn!: Locator
  createFileBtn!: Locator
  fileCreateToast!: Locator
  filePane!: Locator
  exeIndicator!: Locator
  treeInputField!: Locator

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
  }
  reConstruct = (page: Page) => {
    this.page = page
    this.extrudeButton = page.getByTestId('extrude')
    this.loftButton = page.getByTestId('loft')
    this.filletButton = page.getByTestId('fillet3d')
    this.shellButton = page.getByTestId('shell')
    this.offsetPlaneButton = page.getByTestId('plane-offset')
    this.startSketchBtn = page.getByTestId('sketch')
    this.lineBtn = page.getByTestId('line')
    this.rectangleBtn = page.getByTestId('corner-rectangle')
    this.exitSketchBtn = page.getByTestId('sketch-exit')
    this.editSketchBtn = page.getByText('Edit Sketch')
    this.fileTreeBtn = page.locator('[id="files-button-holder"]')
    this.createFileBtn = page.getByTestId('create-file-button')
    this.treeInputField = page.getByTestId('tree-input-field')

    this.filePane = page.locator('#files-pane')
    this.fileCreateToast = page.getByText('Successfully created')
    this.exeIndicator = page.getByTestId('model-state-indicator-execution-done')
  }

  startSketchPlaneSelection = async () =>
    doAndWaitForImageDiff(this.page, () => this.startSketchBtn.click(), 500)

  editSketch = async () => {
    await this.editSketchBtn.first().click()
    // One of the rare times we want to allow a arbitrary wait
    // this is for the engine animation, as it takes 500ms to complete
    await this.page.waitForTimeout(600)
  }

  private _serialiseFileTree = async () => {
    return this.page
      .locator('#files-pane')
      .getByTestId('file-tree-item')
      .allInnerTexts()
  }
  /**
   * TODO folders, in expect state
   */
  expectFileTreeState = async (expected: string[]) => {
    await expect.poll(this._serialiseFileTree).toEqual(expected)
  }
  createFile = async (args: {
    fileName: string
    waitForToastToDisappear: boolean
  }) => {
    await this.createFileBtn.click()
    await this.treeInputField.fill(args.fileName)
    await this.treeInputField.press('Enter')
    await expect(this.fileCreateToast).toBeVisible()
    if (args.waitForToastToDisappear) {
      await this.fileCreateToast.waitFor({ state: 'detached' })
    }
  }
  /**
   * Opens file by it's name and waits for execution to finish
   */
  openFile = async (
    fileName: string,
    { wait }: { wait?: boolean } = { wait: true }
  ) => {
    await this.filePane.getByText(fileName).click()
    if (wait) {
      await expect(this.exeIndicator).toBeVisible({ timeout: 15_000 })
    }
  }
}
