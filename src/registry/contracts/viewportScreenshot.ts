import { contract, service } from 'plankton'
export interface ViewportScreenshotService {
  /** A PNG data URL of the modeling viewport, or '' when it is not ready. */
  capture(): string
}
export const viewportScreenshotContract = contract({
  viewportScreenshotService: service<ViewportScreenshotService>(
    'viewport-screenshot'
  ),
})
export const { viewportScreenshotService } = viewportScreenshotContract
