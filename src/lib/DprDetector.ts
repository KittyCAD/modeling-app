export class DprDetector {
  private listener: () => void
  private media: MediaQueryList

  constructor(listener: () => void) {
    this.listener = listener
    this.media = this.initMedia()
  }

  private initMedia() {
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
