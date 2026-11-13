import { useCallback, useState } from 'react'

export function useRichTooltipContent() {
  const [showRichContent, setShowRichContent] = useState(false)
  const handleMouseEnter = useCallback(() => setShowRichContent(true), [])
  const handleMouseLeave = useCallback(() => setShowRichContent(false), [])

  return { showRichContent, handleMouseEnter, handleMouseLeave }
}
