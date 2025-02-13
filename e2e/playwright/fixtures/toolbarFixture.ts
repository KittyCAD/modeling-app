import type { Page, Locator } from '@playwright/test'
import { expect } from '../zoo-test'
import {
  checkIfPaneIsOpen,
  closePane,
  doAndWaitForImageDiff,
  openPane,
} from '../test-utils'
import { SidebarType } from 'components/ModelingSidebar/ModelingPanes'
import { SIDEBAR_BUTTON_SUFFIX } from 'lib/constants'

export class ToolbarFixture {
  public page: Page

  extrudeButton!: Locator
  loftButton!: Locator
  sweepButton!: Locator
  filletButton!: Locator
  chamferButton!: Locator
  shellButton!: Locator
  revolveButton!: Locator
  offsetPlaneButton!: Locator
  helixButton!: Locator
  startSketchBtn!: Locator
  lineBtn!: Locator
  tangentialArcBtn!: Locator
  circleBtn!: Locator
  rectangleBtn!: Locator
  lengthConstraintBtn!: Locator
  exitSketchBtn!: Locator
  editSketchBtn!: Locator
  fileTreeBtn!: Locator
  createFileBtn!: Locator
  fileCreateToast!: Locator
  filePane!: Locator
  treeInputField!: Locator
  /** The sidebar button for the Feature Tree pane */
  featureTreeId = 'feature-tree' as const
  /** The pane element for the Feature Tree */
  featureTreePane!: Locator

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
  }
  reConstruct = (page: Page) => {
    this.page = page
    this.extrudeButton = page.getByTestId('extrude')
    this.loftButton = page.getByTestId('loft')
    this.sweepButton = page.getByTestId('sweep')
    this.filletButton = page.getByTestId('fillet3d')
    this.chamferButton = page.getByTestId('chamfer3d')
    this.shellButton = page.getByTestId('shell')
    this.revolveButton = page.getByTestId('revolve')
    this.offsetPlaneButton = page.getByTestId('plane-offset')
    this.helixButton = page.getByTestId('helix')
    this.startSketchBtn = page.getByTestId('sketch')
    this.lineBtn = page.getByTestId('line')
    this.tangentialArcBtn = page.getByTestId('tangential-arc')
    this.circleBtn = page.getByTestId('circle-center')
    this.rectangleBtn = page.getByTestId('corner-rectangle')
    this.lengthConstraintBtn = page.getByTestId('constraint-length')
    this.exitSketchBtn = page.getByTestId('sketch-exit')
    this.editSketchBtn = page.getByText('Edit Sketch')
    this.fileTreeBtn = page.locator('[id="files-button-holder"]')
    this.createFileBtn = page.getByTestId('create-file-button')
    this.treeInputField = page.getByTestId('tree-input-field')

    this.filePane = page.locator('#files-pane')
    this.featureTreePane = page.locator('#feature-tree-pane')
    this.fileCreateToast = page.getByText('Successfully created')
  }

  get logoLink() {
    return this.page.getByTestId('app-logo')
  }

  get exeIndicator() {
    return this.page.getByTestId('model-state-indicator-receive-reliable')
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
  selectCenterRectangle = async () => {
    await this.page
      .getByRole('button', { name: 'caret down Corner rectangle:' })
      .click()
    await expect(
      this.page.getByTestId('dropdown-center-rectangle')
    ).toBeVisible()
    await this.page.getByTestId('dropdown-center-rectangle').click()
  }

  selectCircleThreePoint = async () => {
    await this.page
      .getByRole('button', { name: 'caret down Center circle:' })
      .click()
    await expect(
      this.page.getByTestId('dropdown-circle-three-points')
    ).toBeVisible()
    await this.page.getByTestId('dropdown-circle-three-points').click()
  }

  async closePane(paneId: SidebarType) {
    return closePane(this.page, paneId + SIDEBAR_BUTTON_SUFFIX)
  }
  async openPane(paneId: SidebarType) {
    return openPane(this.page, paneId + SIDEBAR_BUTTON_SUFFIX)
  }
  async checkIfPaneIsOpen(paneId: SidebarType) {
    return checkIfPaneIsOpen(this.page, paneId + SIDEBAR_BUTTON_SUFFIX)
  }

  async openFeatureTreePane() {
    return this.openPane(this.featureTreeId)
  }
  async closeFeatureTreePane() {
    await this.closePane(this.featureTreeId)
  }
  async checkIfFeatureTreePaneIsOpen() {
    return this.checkIfPaneIsOpen(this.featureTreeId)
  }

  /**
   * Get a specific operation button from the Feature Tree pane.
   * Index is 0-based.
   */
  async getFeatureTreeOperation(operationName: string, operationIndex: number) {
    await this.openFeatureTreePane()
    await expect(this.featureTreePane).toBeVisible()
    return this.featureTreePane
      .getByRole('button', {
        name: operationName,
      })
      .nth(operationIndex)
  }

  /**
   * View source on a specific operation in the Feature Tree pane.
   * @param operationName The name of the operation type
   * @param operationIndex The index out of operations of this type
   */
  async viewSourceOnOperation(operationName: string, operationIndex: number) {
    const operationButton = await this.getFeatureTreeOperation(
      operationName,
      operationIndex
    )
    const viewSourceMenuButton = this.page.getByRole('button', {
      name: 'View KCL source code',
    })

    await operationButton.click({ button: 'right' })
    await expect(viewSourceMenuButton).toBeVisible()
    await viewSourceMenuButton.click()
  }

  /**
   * Go to definition on a specific operation in the Feature Tree pane
   */
  async goToDefinitionOnOperation(
    operationName: string,
    operationIndex: number
  ) {
    const operationButton = await this.getFeatureTreeOperation(
      operationName,
      operationIndex
    )
    const goToDefinitionMenuButton = this.page.getByRole('button', {
      name: 'View function definition',
    })

    await operationButton.click({ button: 'right' })
    await expect(goToDefinitionMenuButton).toBeVisible()
    await goToDefinitionMenuButton.click()
  }
}
