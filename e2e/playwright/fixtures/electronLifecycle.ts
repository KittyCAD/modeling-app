export async function runElectronSetup(
  setup: () => Promise<void>,
  dispose: () => Promise<void>,
  timeoutMs: number,
  timeoutMessage: string
) {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      Promise.resolve().then(setup),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Electron fixture setup and cleanup failed'
      )
    }
    throw error
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
