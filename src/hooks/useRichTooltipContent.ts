import { useCallback, useEffect, useRef, useState } from 'react'

export const TOOLTIP_RICH_CONTENT_DELAY_MS = 1000
export const TOOLTIP_RICH_CONTENT_CLEAR_DELAY_MS = 500

export function useRichTooltipContent() {
  const [showRichContent, setShowRichContent] = useState(false)
  const showTimeout = useRef<number | null>(null)
  const clearTimeout = useRef<number | null>(null)

  const handleMouseEnter = useCallback(() => {
    if (clearTimeout.current !== null) {
      window.clearTimeout(clearTimeout.current)
      clearTimeout.current = null
    }
    if (showTimeout.current !== null) {
      window.clearTimeout(showTimeout.current)
    }
    showTimeout.current = window.setTimeout(() => {
      showTimeout.current = null
      setShowRichContent(true)
    }, TOOLTIP_RICH_CONTENT_DELAY_MS)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (showTimeout.current !== null) {
      window.clearTimeout(showTimeout.current)
      showTimeout.current = null
    }
    if (clearTimeout.current !== null) {
      window.clearTimeout(clearTimeout.current)
    }
    clearTimeout.current = window.setTimeout(() => {
      clearTimeout.current = null
      setShowRichContent(false)
    }, TOOLTIP_RICH_CONTENT_CLEAR_DELAY_MS)
  }, [])

  useEffect(
    () => () => {
      if (showTimeout.current !== null) {
        window.clearTimeout(showTimeout.current)
      }
      if (clearTimeout.current !== null) {
        window.clearTimeout(clearTimeout.current)
      }
    },
    []
  )

  return { showRichContent, handleMouseEnter, handleMouseLeave }
}
