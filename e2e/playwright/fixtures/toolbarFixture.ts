import { type Locator, type Page, test } from '@playwright/test'
import type { SidebarType } from '@src/components/ModelingSidebar/ModelingPanes'
import { SIDEBAR_BUTTON_SUFFIX } from '@src/lib/constants'
import type { ToolbarModeName } from '@src/lib/toolbar'

import {
  checkIfPaneIsOpen,
  closePane,
  doAndWaitForImageDiff,
  openPane,
} from '@e2e/playwright/test-utils'
import { expect } from '@e2e/playwright/zoo-test'
import { type baseUnitLabels } from '@src/lib/settings/settingsTypes'

type LengthUnitLabel = (typeof baseUnitLabels)[keyof typeof baseUnitLabels]

export class ToolbarFixture {
  public page: Page

  projectName!: Locator
  fileName!: Locator
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
  insertButton!: Locator
  lineBtn!: Locator
  tangentialArcBtn!: Locator
  circleBtn!: Locator
  rectangleBtn!: Locator
  lengthConstraintBtn!: Locator
  exitSketchBtn!: Locator
  fileTreeBtn!: Locator
  createFileBtn!: Locator
  fileCreateToast!: Locator
  filePane!: Locator
  treeInputField!: Locator
  /** The sidebar button for the Feature Tree pane */
  featureTreeId = 'feature-tree' as const
  /** The pane element for the Feature Tree */
  featureTreePane!: Locator
  gizmo!: Locator
  gizmoDisabled!: Locator
  loadButton!: Locator
  /** User button for the user sidebar menu */
  userSidebarButton!: Locator
  signOutButton!: Locator

  constructor(page: Page) {
    this.page = page

    this.projectName = page.getByTestId('app-header-project-name')
    this.fileName = page.getByTestId('app-header-file-name')
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
    this.insertButton = page.getByTestId('insert')
    this.lineBtn = page.getByTestId('line')
    this.tangentialArcBtn = page.getByTestId('tangential-arc')
    this.circleBtn = page.getByTestId('circle-center')
    this.rectangleBtn = page.getByTestId('corner-rectangle')
    this.lengthConstraintBtn = page.getByTestId('constraint-length')
    this.exitSketchBtn = page.getByTestId('sketch-exit')
    this.fileTreeBtn = page.locator('[id="files-button-holder"]')
    this.createFileBtn = page.getByTestId('create-file-button')
    this.treeInputField = page.getByTestId('tree-input-field')
    this.loadButton = page.getByTestId('add-file-to-project-pane-button')

    this.filePane = page.locator('#files-pane')
    this.featureTreePane = page.locator('#feature-tree-pane')
    this.fileCreateToast = page.getByText('Successfully created')

    // Note to test writers: having two locators like this is preferable to one
    // which changes another el property because it means our test "signal" is
    // completely decoupled from the elements themselves. It means the same
    // element or two different elements can represent these states.
    this.gizmo = page.getByTestId('gizmo')
    this.gizmoDisabled = page.getByTestId('gizmo-disabled')

    this.userSidebarButton = page.getByTestId('user-sidebar-toggle')
    this.signOutButton = page.getByTestId('user-sidebar-sign-out')
  }

  get logoLink() {
    return this.page.getByTestId('app-logo')
  }

  startSketchPlaneSelection = async () =>
    doAndWaitForImageDiff(this.page, () => this.startSketchBtn.click(), 500)

  waitUntilSketchingReady = async () => {
    await expect(this.gizmoDisabled).toBeVisible()
  }

  startSketchThenCallbackThenWaitUntilReady = async (
    cb: () => Promise<void>
  ) => {
    await this.startSketchBtn.click()
    await cb()
    await this.waitUntilSketchingReady()
  }

  exitSketch = async () => {
    await this.exitSketchBtn.click()
    await expect(
      this.page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()
    await expect(
      this.page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
  }

  editSketch = async (operationIndex = 0) => {
    await test.step(`Editing sketch`, async () => {
      await this.openFeatureTreePane()
      const operation = await this.getFeatureTreeOperation(
        'Sketch',
        operationIndex
      )
      await operation.dblclick()
      // One of the rare times we want to allow a arbitrary wait
      // this is for the engine animation, as it takes 500ms to complete
      await this.page.waitForTimeout(600)
      await expect(this.exitSketchBtn).toBeEnabled()
      await this.closeFeatureTreePane()
    })
  }
  private _getMode = () =>
    this.page.locator('[data-current-mode]').getAttribute('data-current-mode')
  expectToolbarMode = {
    toBe: (mode: ToolbarModeName) => expect.poll(this._getMode).toEqual(mode),
    not: {
      toBe: (mode: ToolbarModeName) =>
        expect.poll(this._getMode).not.toEqual(mode),
    },
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
   * Opens file by it's name
   */
  openFile = async (fileName: string) => {
    await this.filePane.getByText(fileName).click()
  }
  selectTangentialArc = async () => {
    await this.page.getByRole('button', { name: 'caret down arcs:' }).click()
    await expect(
      this.page.getByTestId('dropdown-three-point-arc')
    ).toBeVisible()
    await this.page.getByTestId('dropdown-tangential-arc').click()
  }
  selectCenterRectangle = async () => {
    await this.page
      .getByRole('button', { name: 'caret down rectangles:' })
      .click()
    await expect(
      this.page.getByTestId('dropdown-center-rectangle')
    ).toBeVisible()
    await this.page.getByTestId('dropdown-center-rectangle').click()
  }
  selectBoolean = async (operation: 'union' | 'subtract' | 'intersect') => {
    await this.page
      .getByRole('button', { name: 'caret down booleans: open menu' })
      .click()
    const operationTestId = `dropdown-boolean-${operation}`
    await expect(this.page.getByTestId(operationTestId)).toBeVisible()
    await this.page.getByTestId(operationTestId).click()
  }

  selectCircleThreePoint = async () => {
    await this.page.getByRole('button', { name: 'caret down circles:' }).click()
    await expect(
      this.page.getByTestId('dropdown-circle-three-points')
    ).toBeVisible()
    await this.page.getByTestId('dropdown-circle-three-points').click()
  }
  selectArc = async () => {
    await this.page.getByRole('button', { name: 'caret down arcs:' }).click()
    await expect(this.page.getByTestId('dropdown-tangential-arc')).toBeVisible()
    await this.page.getByTestId('dropdown-tangential-arc').click()
  }
  selectThreePointArc = async () => {
    await this.page.getByRole('button', { name: 'caret down arcs:' }).click()
    await expect(
      this.page.getByTestId('dropdown-three-point-arc')
    ).toBeVisible()
    await this.page.getByTestId('dropdown-three-point-arc').click()
  }
  selectLine = async () => {
    await this.page
      .getByRole('button', { name: 'line Line', exact: true })
      .click()
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

  async waitForFeatureTreeToBeBuilt() {
    await this.openFeatureTreePane()
    await expect(this.page.getByText('Building feature tree')).not.toBeVisible()
    await this.closeFeatureTreePane()
  }
  async closeFeatureTreePane() {
    await this.closePane(this.featureTreeId)
  }
  async checkIfFeatureTreePaneIsOpen() {
    return this.checkIfPaneIsOpen(this.featureTreeId)
  }
  async selectUnit(unit: LengthUnitLabel) {
    await this.page.getByTestId('units-menu').click()
    const optionLocator = this.page.getByRole('button', { name: unit })
    await expect(optionLocator).toBeVisible()
    await optionLocator.click()
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

  getDefaultPlaneVisibilityButton(plane: 'XY' | 'XZ' | 'YZ' = 'XY') {
    const index = plane === 'XZ' ? 0 : plane === 'XY' ? 1 : 2
    return this.featureTreePane
      .getByTestId('feature-tree-visibility-toggle')
      .nth(index)
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
