import type { Page, Locator } from '@playwright/test'
import { doAndWaitForImageDiff } from './test-utils'

export class ToolbarFixture {
  public readonly page: Page
  readonly extrudeButton: Locator
  readonly startSketchBtn: Locator
  readonly rectangleBtn: Locator
  readonly exitSketchBtn: Locator

  constructor(page: Page) {
    this.page = page
    this.extrudeButton = page.getByTestId('extrude')
    this.startSketchBtn = page.getByTestId('sketch')
    this.rectangleBtn = page.getByTestId('corner-rectangle')
    this.exitSketchBtn = page.getByTestId('sketch-exit')
  }

  startSketchPlaneSelection = async () =>
    doAndWaitForImageDiff(this.page, () => this.startSketchBtn.click(), 500)
}
