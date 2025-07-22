import type { Locator, Page } from '@playwright/test'
import { isArray, uuidv4 } from '@src/lib/utils'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'

import {
  closeDebugPanel,
  doAndWaitForImageDiff,
  getPixelRGBs,
  getUtils,
  openAndClearDebugPanel,
  sendCustomCmd,
} from '@e2e/playwright/test-utils'
import { expect } from '@e2e/playwright/zoo-test'
import { height } from 'happy-dom/lib/PropertySymbol'

type MouseParams = {
  pixelDiff?: number
  shouldDbClick?: boolean
  delay?: number
}
type MouseDragToParams = MouseParams & {
  fromPoint: { x: number; y: number }
}
type MouseDragFromParams = MouseParams & {
  toPoint: { x: number; y: number }
}

type SceneSerialised = {
  camera: {
    position: [number, number, number]
    target: [number, number, number]
  }
}

type ClickHandler = (clickParams?: MouseParams) => Promise<void | boolean>
type MoveHandler = (moveParams?: MouseParams) => Promise<void | boolean>
type DblClickHandler = (clickParams?: MouseParams) => Promise<void | boolean>
type DragToHandler = (dragParams: MouseDragToParams) => Promise<void | boolean>
type DragFromHandler = (
  dragParams: MouseDragFromParams
) => Promise<void | boolean>

export class SceneFixture {
  public page: Page
  public streamWrapper!: Locator
  public networkToggleConnected!: Locator
  public engineConnectionsSpinner!: Locator
  public startEditSketchBtn!: Locator
  public appHeader!: Locator

  constructor(page: Page) {
    this.page = page
    this.streamWrapper = page.getByTestId('stream')
    this.networkToggleConnected = page
      .getByTestId('network-toggle-ok')
      .or(page.getByTestId('network-toggle-other'))
    this.engineConnectionsSpinner = page.getByTestId(`loading-engine`)
    this.startEditSketchBtn = page
      .getByRole('button', { name: 'Start Sketch' })
      .or(page.getByRole('button', { name: 'Edit Sketch' }))
    this.appHeader = this.page.getByTestId('app-header')
  }
  private _serialiseScene = async (): Promise<SceneSerialised> => {
    const camera = await this.getCameraInfo()

    return {
      camera,
    }
  }

  expectState = async (expected: SceneSerialised) => {
    return expect
      .poll(async () => await this._serialiseScene(), {
        intervals: [1_000, 2_000, 10_000],
        timeout: 60000,
      })
      .toEqual(expected)
  }

  /**
   * We've written a lot of tests using hard-coded pixel coordinates.
   * This function translates those to stream-relative ones,
   * or can be used to get stream coordinates by ratio.
   */
  convertPagePositionToStream = async (
    x: number,
    y: number,
    format: 'pixels' | 'ratio' = 'pixels'
  ) => {
    const viewportSize = this.page.viewportSize()
    const streamBoundingBox = await this.streamWrapper.boundingBox()
    if (viewportSize === null) {
      throw Error('No viewport')
    }
    if (streamBoundingBox === null) {
      throw Error('No stream to click')
    }

    const resolvedX =
      (x / (format === 'pixels' ? viewportSize.width : 1)) *
        streamBoundingBox.width +
      streamBoundingBox.x
    const resolvedY =
      (y / (format === 'pixels' ? viewportSize.height : 1)) *
        streamBoundingBox.height +
      streamBoundingBox.y

    const resolvedPoint = {
      x: Math.round(resolvedX),
      y: Math.round(resolvedY),
    }

    return resolvedPoint
  }

  makeMouseHelpers = (
    x: number,
    y: number,
    { steps, format }: { steps: number; format: 'pixels' | 'ratio' } = {
      steps: 20,
      format: 'pixels',
    }
  ): [ClickHandler, MoveHandler, DblClickHandler] =>
    [
      async (clickParams?: MouseParams) => {
        const resolvedPoint = await this.convertPagePositionToStream(
          x,
          y,
          format
        )
        if (clickParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () =>
              clickParams?.shouldDbClick
                ? this.page.mouse.dblclick(resolvedPoint.x, resolvedPoint.y, {
                    delay: clickParams?.delay || 0,
                  })
                : this.page.mouse.click(resolvedPoint.x, resolvedPoint.y, {
                    delay: clickParams?.delay || 0,
                  }),
            clickParams.pixelDiff
          )
        }
        return clickParams?.shouldDbClick
          ? this.page.mouse.dblclick(resolvedPoint.x, resolvedPoint.y, {
              delay: clickParams?.delay || 0,
            })
          : this.page.mouse.click(resolvedPoint.x, resolvedPoint.y, {
              delay: clickParams?.delay || 0,
            })
      },
      async (moveParams?: MouseParams) => {
        const resolvedPoint = await this.convertPagePositionToStream(
          x,
          y,
          format
        )
        if (moveParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () =>
              this.page.mouse.move(resolvedPoint.x, resolvedPoint.y, { steps }),
            moveParams.pixelDiff
          )
        }
        return this.page.mouse.move(resolvedPoint.x, resolvedPoint.y, { steps })
      },
      async (clickParams?: MouseParams) => {
        const resolvedPoint = await this.convertPagePositionToStream(
          x,
          y,
          format
        )
        if (clickParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () => this.page.mouse.dblclick(resolvedPoint.x, resolvedPoint.y),
            clickParams.pixelDiff
          )
        }
        return this.page.mouse.dblclick(resolvedPoint.x, resolvedPoint.y)
      },
    ] as const
  makeDragHelpers = (
    x: number,
    y: number,
    { steps, format }: { steps: number; format: 'pixels' | 'ratio' } = {
      steps: 20,
      format: 'pixels',
    }
  ): [DragToHandler, DragFromHandler] =>
    [
      async (dragToParams: MouseDragToParams) => {
        const resolvedPoint = await this.convertPagePositionToStream(
          x,
          y,
          format
        )
        if (dragToParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () =>
              this.page.dragAndDrop('#stream', '#stream', {
                sourcePosition: dragToParams.fromPoint,
                targetPosition: { x: resolvedPoint.x, y: resolvedPoint.y },
              }),
            dragToParams.pixelDiff
          )
        }
        return this.page.dragAndDrop('#stream', '#stream', {
          sourcePosition: dragToParams.fromPoint,
          targetPosition: { x: resolvedPoint.x, y: resolvedPoint.y },
        })
      },
      async (dragFromParams: MouseDragFromParams) => {
        const resolvedPoint = await this.convertPagePositionToStream(
          x,
          y,
          format
        )
        if (dragFromParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () =>
              this.page.dragAndDrop('#stream', '#stream', {
                sourcePosition: { x: resolvedPoint.x, y: resolvedPoint.y },
                targetPosition: dragFromParams.toPoint,
              }),
            dragFromParams.pixelDiff
          )
        }
        return this.page.dragAndDrop('#stream', '#stream', {
          sourcePosition: { x: resolvedPoint.x, y: resolvedPoint.y },
          targetPosition: dragFromParams.toPoint,
        })
      },
    ] as const

  /** Likely no where, there's a chance it will click something in the scene, depending what you have in the scene.
   *
   * Expects the viewPort to be 1000x500 */
  clickNoWhere = () => this.page.mouse.click(998, 60)
  /** Likely no where, there's a chance it will click something in the scene, depending what you have in the scene.
   */
  moveNoWhere = async (steps?: number) => {
    const point = await this.convertPagePositionToStream(
      998 / 1000,
      60 / 500,
      'ratio'
    )
    return this.page.mouse.move(point.x, point.y, { steps })
  }

  /** Select the X-axis, the blue horizontal line. Must be in sketch mode. */
  clickXAxis = async () => {
    const pointOnXAxis = await this.convertPagePositionToStream(
      0.9,
      0.5,
      'ratio'
    )
    await this.page.mouse.click(pointOnXAxis.x, pointOnXAxis.y)
  }

  /** Select the Y-axis, the red vertical line. Must be in sketch mode. */
  clickYAxis = async () => {
    const pointOnYAxis = await this.convertPagePositionToStream(
      0.5,
      0.25,
      'ratio'
    )
    await this.page.mouse.click(pointOnYAxis.x, pointOnYAxis.y)
  }

  moveCameraTo = async (
    pos: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  ) => {
    await openAndClearDebugPanel(this.page)
    await doAndWaitForImageDiff(
      this.page,
      () =>
        sendCustomCmd(this.page, {
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_look_at',
            vantage: pos,
            center: target,
            up: { x: 0, y: 0, z: 1 },
          },
        }),
      300
    )
    await closeDebugPanel(this.page)
  }
  /** Forces a refresh of the camera position and target displayed
   *  in the debug panel and then returns the values of the fields
   */
  async getCameraInfo() {
    await openAndClearDebugPanel(this.page)
    await sendCustomCmd(this.page, {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await this.page
      .locator(`[data-receive-command-type="default_camera_get_settings"]`)
      .first()
      .waitFor()
    const position = await Promise.all([
      this.page.getByTestId('cam-x-position').inputValue().then(Number),
      this.page.getByTestId('cam-y-position').inputValue().then(Number),
      this.page.getByTestId('cam-z-position').inputValue().then(Number),
    ])
    const target = await Promise.all([
      this.page.getByTestId('cam-x-target').inputValue().then(Number),
      this.page.getByTestId('cam-y-target').inputValue().then(Number),
      this.page.getByTestId('cam-z-target').inputValue().then(Number),
    ])
    await closeDebugPanel(this.page)
    return {
      position,
      target,
    }
  }

  connectionEstablished = async () => {
    const timeout = 30_000
    await Promise.all([
      expect(this.networkToggleConnected).toBeVisible({ timeout }),
      expect(this.engineConnectionsSpinner).not.toBeVisible({ timeout }),
    ])
  }

  settled = async (cmdBar: CmdBarFixture) => {
    const u = await getUtils(this.page)

    await expect(this.startEditSketchBtn).not.toBeDisabled({ timeout: 15_000 })
    await expect(this.startEditSketchBtn).toBeVisible()
    await expect(this.engineConnectionsSpinner).not.toBeVisible()

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('Settings · app · show debug panel')
    await cmdBar.selectOption({ name: 'on' }).click()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()
  }

  expectPixelColor = async (
    colour: [number, number, number] | [number, number, number][],
    coords: { x: number; y: number },
    diff: number
  ) => {
    await expectPixelColor(this.page, colour, coords, diff)
  }

  expectPixelColorNotToBe = async (
    colour: [number, number, number] | [number, number, number][],
    coords: { x: number; y: number },
    diff: number
  ) => {
    await expectPixelColorNotToBe(this.page, colour, coords, diff)
  }

  get gizmo() {
    return this.page.locator('[aria-label*=gizmo]')
  }

  async clickGizmoMenuItem(name: string) {
    await this.gizmo.hover()
    await this.gizmo.click({ button: 'right' })
    const buttonToTest = this.page.getByRole('button', {
      name: name,
    })
    await expect(buttonToTest).toBeVisible()
    await buttonToTest.click()
  }

  isNativeFileMenuCreated = async () => {
    await expect(this.appHeader).toHaveAttribute(
      'data-native-file-menu',
      'true'
    )
  }
}

function isColourArray(
  colour: [number, number, number] | [number, number, number][]
): colour is [number, number, number][] {
  return isArray(colour[0])
}

type PixelColorMatchMode = 'matches' | 'differs'

export async function checkPixelColor(
  page: Page,
  colour: [number, number, number] | [number, number, number][],
  coords: { x: number; y: number },
  diff: number,
  mode: PixelColorMatchMode
) {
  let finalValue = colour
  const isMatchMode = mode === 'matches'
  const actionText = isMatchMode ? 'expecting' : 'not expecting'
  const functionName = isMatchMode
    ? 'ExpectPixelColor'
    : 'ExpectPixelColourNotToBe'

  await expect
    .poll(
      async () => {
        const pixel = (await getPixelRGBs(page)(coords, 1))[0]
        if (!pixel) return null
        finalValue = pixel

        let matches
        if (!isColourArray(colour)) {
          matches = pixel.every(
            (channel, index) => Math.abs(channel - colour[index]) < diff
          )
        } else {
          matches = colour.some((c) =>
            c.every((channel, index) => Math.abs(pixel[index] - channel) < diff)
          )
        }

        return isMatchMode ? matches : !matches
      },
      { timeout: 10_000 }
    )
    .toBeTruthy()
    .catch((cause) => {
      throw new Error(
        `${functionName}: point ${JSON.stringify(
          coords
        )} was ${actionText} ${colour} but got ${finalValue}`,
        { cause }
      )
    })
}

export async function expectPixelColor(
  page: Page,
  colour: [number, number, number] | [number, number, number][],
  coords: { x: number; y: number },
  diff: number
) {
  await checkPixelColor(page, colour, coords, diff, 'matches')
}

export async function expectPixelColorNotToBe(
  page: Page,
  colour: [number, number, number] | [number, number, number][],
  coords: { x: number; y: number },
  diff: number
) {
  await checkPixelColor(page, colour, coords, diff, 'differs')
}
