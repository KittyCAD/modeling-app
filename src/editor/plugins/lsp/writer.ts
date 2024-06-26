import { Disposable, Emitter, Event, Message, RAL } from 'vscode-languageclient'

/**
 * A writable stream.
 *
 * This interface is not intended to be implemented. Instances of this
 * interface are available via `Wasm.createWritable`.
 */
interface Writable {
  /**
   * Write some data to the stream.
   * @param chunk The data to write.
   */
  write(chunk: Uint8Array): Promise<void>

  /**
   * Write a string to the stream.
   * @param chunk The string to write.
   * @param encoding The encoding to use to convert to a binary format.
   */
  write(chunk: string, encoding?: 'utf-8'): Promise<void>
}

export class WritableStreamImpl implements RAL.WritableStream {
  private readonly errorEmitter: Emitter<
    [Error, Message | undefined, number | undefined]
  >
  private readonly closeEmitter: Emitter<void>
  private readonly endEmitter: Emitter<void>

  private readonly writable: Writable

  constructor(writable: Writable) {
    this.errorEmitter = new Emitter<[Error, Message, number]>()
    this.closeEmitter = new Emitter<void>()
    this.endEmitter = new Emitter<void>()
    this.writable = writable
  }

  public get onError(): Event<
    [Error, Message | undefined, number | undefined]
  > {
    return this.errorEmitter.event
  }

  public fireError(error: any, message?: Message, count?: number): void {
    this.errorEmitter.fire([error, message, count])
  }

  public get onClose(): Event<void> {
    return this.closeEmitter.event
  }

  public fireClose(): void {
    this.closeEmitter.fire(undefined)
  }

  public onEnd(listener: () => void): Disposable {
    return this.endEmitter.event(listener)
  }

  public fireEnd(): void {
    this.endEmitter.fire(undefined)
  }

  public write(
    data: string | Uint8Array,
    _encoding?: RAL.MessageBufferEncoding
  ): Promise<void> {
    if (typeof data === 'string') {
      return this.writable.write(data, 'utf-8')
    } else {
      return this.writable.write(data)
    }
  }

  public end(): void {}
}
