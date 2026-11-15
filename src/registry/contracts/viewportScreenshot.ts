import { defineContract, defineService } from '@kittycad/registry'

export interface ViewportScreenshotService {
  /** A PNG data URL of the modeling viewport, or '' when it is not ready. */
  capture(): string
}

export const viewportScreenshotContract = defineContract({
  viewportScreenshotService: defineService<ViewportScreenshotService>(
    'viewport-screenshot'
  ),
})

export const { viewportScreenshotService } = viewportScreenshotContract
