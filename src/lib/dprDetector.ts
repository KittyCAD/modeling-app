/**
 * Notices when the device pixel ratio changes.
 *
 * Ported unchanged from the existing app. There is no event for this, so the
 * trick is to watch a media query that is true only at the *current* ratio and
 * re-arm it whenever it stops being true — which happens when a window is
 * dragged between a retina display and an ordinary one, and which a canvas has
 * to react to or it renders at the wrong resolution for the rest of the session.
 */
export class DprDetector {
  private listener: () => void
  private media: MediaQueryList

  constructor(listener: () => void) {
    this.listener = listener
    this.media = this.initMedia()
  }

  private initMedia() {
    this.media?.removeEventListener('change', this.onDprChange)
    this.media = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`
    )
    this.media.addEventListener('change', this.onDprChange)
    return this.media
  }

  private onDprChange = () => {
    this.listener()
    this.initMedia()
  }

  public dispose() {
    this.media.removeEventListener('change', this.onDprChange)
  }
}
