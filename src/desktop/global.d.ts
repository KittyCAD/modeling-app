import type { DesktopBridge } from '@src/desktop/preload'

declare global {
  interface Window {
    /**
     * Present only in the desktop app.
     *
     * Read it through the `runtime` service rather than testing for it inline,
     * so a feature's platform assumptions stay visible in its dependencies.
     */
    electron?: DesktopBridge
  }
}
