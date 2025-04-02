// Based on https://learnersbucket.com/examples/interview/usehasfocus-hook-in-react/
import { useEffect, useState } from 'react'

export const useDocumentHasFocus = () => {
  // get the initial state
  const [focus, setFocus] = useState(document.hasFocus())

  useEffect(() => {
    // helper functions to update the status
    const onFocus = () => setFocus(true)
    const onBlur = () => setFocus(false)

    // assign the listener
    // update the status on the event
    if (globalThis.window && typeof globalThis.window !== 'undefined') {
      globalThis.window.addEventListener('focus', onFocus)
      globalThis.window.addEventListener('blur', onBlur)
    }

    // remove the listener
    return () => {
      if (globalThis.window && typeof globalThis.window !== 'undefined') {
        globalThis.window.removeEventListener('focus', onFocus)
        globalThis.window.removeEventListener('blur', onBlur)
      }
    }
  }, [])

  // return the status
  return focus
}
