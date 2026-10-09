import { type Signal, signal } from '@preact/signals-core'
import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
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
    return File.ioImplementations.read(this.pathSignal.value)
  }

  write(newContent: string) {
    return File.ioImplementations.write(this.pathSignal.value, newContent)
  }

  watch() {
    if (this.watching || this.path.length < 1) {
      return
    }
    File.ioImplementations.watch(this.path, this.fileWatcherKey, (e, p) => {
      this.onWatchEvent.map((f) => f(e, p))
    })
    this.watching = true
  }

  unwatch() {
    if (!this.watching) {
      return
    }
    File.ioImplementations.unwatch(this.path, this.fileWatcherKey)
    this.watching = false
  }

  constructor(
    path: string,
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

  /** Allows environments to swap their implementation of these IO-interfacing functions */
  static ioImplementations = {
    read: (_path: string): Promise<string> =>
      Promise.reject(new Error('File IO has not been configured')),
    write: (_path: string, _content: string): Promise<void> =>
      Promise.reject(new Error('File IO has not been configured')),
    watch: window.electron?.watchFileOn || (() => {}),
    unwatch: window.electron?.watchFileOff || (() => {}),
  }
}
