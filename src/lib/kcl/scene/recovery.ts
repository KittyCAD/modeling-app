/** Transport failures carry recovery policy; native execution errors do not request retries. */
export class SceneDisconnected extends Error {
  constructor(
    message: string,
    readonly retryable = true,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
  }
}
