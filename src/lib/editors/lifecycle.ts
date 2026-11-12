import { isErr, trap, reportRejection } from '@src/lib/trap'

/** Editor and mode resources close once, in reverse acquisition order, including partial setup. */
export function createEditorCleanup() {
  const callbacks: (() => unknown)[] = []
  let closed = false
  const run = (callback: () => unknown) => {
    try {
      const result = callback()
      if (isErr(result)) trap(result)
    } catch (cause) {
      reportRejection(cause)
    }
  }
  return {
    get closed() {
      return closed
    },
    onDispose: (callback: () => unknown) => {
      if (closed) run(callback)
      else callbacks.push(callback)
    },
    dispose: () => {
      if (closed) return
      closed = true
      // splice(0) removes and returns every callback, clearing the owner before cleanup runs.
      // A reversed copy alone would retain closures and their captured resources after disposal.
      for (const callback of callbacks.splice(0).reverse()) run(callback)
    },
  }
}
