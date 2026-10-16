import { type Signal, signal } from '@preact/signals-core'
import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import type { TextFileIO } from '@src/lib/projectSession/textFileIO'
import { uuidv4 } from '@src/lib/utils'

export class File extends EventTarget {
  /** Path to file this editor is operating on */
  private pathSignal: Signal<string>
  private fileWatcherKey = uuidv4()
  public watching: boolean = false
  /** Array of listeners. TODO: Make this a CodeMirror-style extension point */
  public onWatchEvent: ((eventType: string, path: string) => void)[] = [
    () => ({}),
  ]
  get path() {
    return this.pathSignal.value
  }
  set path(newPath: string) {
    const wasWatching = this.watching
    if (wasWatching) {
      this.unwatch()
    }

    // Set pathSignal before calling this.watch() as it uses the path!
    this.pathSignal.value = newPath

    // Don't watch empty file paths, that's the whole file system!
    if (wasWatching && newPath.length > 0) {
      this.watch()
    }
  }

  read() {
    return this.textFileIO.read(this.pathSignal.value)
  }

  /** Read bytes and their disk timestamp from the same stable file revision. */
  async readWithTimestamp(): Promise<{ code: string; modifiedAt: number }> {
    const path = this.path
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const modifiedAt = await this.textFileIO.modifiedAt(path)
      const code = await this.textFileIO.read(path)
      if (modifiedAt === (await this.textFileIO.modifiedAt(path))) {
        return { code, modifiedAt }
      }
    }
    return Promise.reject(new Error('File kept changing while reading'))
  }

  write(newContent: string) {
    return this.textFileIO.write(this.pathSignal.value, newContent)
  }

  watch() {
    if (this.watching || this.path.length < 1) {
      return
    }
    this.textFileIO.watch(this.path, this.fileWatcherKey, (e, p) => {
      this.onWatchEvent.map((f) => f(e, p))
    })
    this.watching = true
  }

  unwatch() {
    if (!this.watching) {
      return
    }
    this.textFileIO.unwatch(this.path, this.fileWatcherKey)
    this.watching = false
  }

  constructor(
    path: string,
    public readonly textFileIO: TextFileIO,
    public id = 0
  ) {
    super()
    this.pathSignal = signal(path)
  }

  /** Present file data in format that RUST-WASM side needs it */
  async asRustApiFile(): Promise<ApiFile> {
    return this.read().then((text) => ({
      id: this.id,
      path: this.pathSignal.value,
      text,
    }))
  }
}
