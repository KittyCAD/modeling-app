import { reportRejection } from '@src/lib/trap'

/** Editor and mode resources close once, in reverse acquisition order, including partial setup. */
export function createEditorCleanup() {
  const callbacks: (() => void)[] = []
  let closed = false
  const run = (callback: () => void) => {
    try {
      callback()
    } catch (cause) {
      reportRejection(cause)
    }
  }
  return {
    get closed() {
      return closed
    },
    onDispose: (callback: () => void) => {
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
