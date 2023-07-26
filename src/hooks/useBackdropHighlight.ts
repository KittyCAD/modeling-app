import useResizeObserver from '@react-hook/resize-observer'
import { useEffect, useState } from 'react'

interface Rect {
  top: number
  left: number
  height: number
  width: number
}

/**
 * Takes an element id and uses React refs to create a CSS clip-path rule to apply to a backdrop element
 * which excludes the element with the given id, creating a "highlight" effect.
 * @param highlightId
 */
export function useBackdropHighlight(target: string): string {
  const [clipPath, setClipPath] = useState('')
  const [elem, setElem] = useState(document.getElementById(target))

  // Build the actual clip path string, cutting out the target element
  function buildClipPath({ top, left, height, width }: Rect) {
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight

    return `
        path(evenodd, "M0 0 l${windowWidth} 0 l0 ${windowHeight} l-${windowWidth} 0 Z \
            M${left} ${top} l${width} 0 l0 ${height} l-${width} 0 Z")
        `
  }

  // initial setup of clip path
  useEffect(() => {
    if (!elem) {
      const newElem = document.getElementById(target)
      if (newElem === null) {
        throw new Error(
          `Could not find element with id "${target}" to highlight`
        )
      }
      setElem(document.getElementById(target))
      return
    }

    const { top, left, height, width } = elem.getBoundingClientRect()
    setClipPath(buildClipPath({ top, left, height, width }))
  }, [elem, target])

  // update clip path on resize
  useResizeObserver(elem, (entry) => {
    const { height, width } = entry.contentRect
    // the top and left are relative to the viewport, so we need to get the target's position
    const { top, left } = entry.target.getBoundingClientRect()
    setClipPath(buildClipPath({ top, left, height, width }))
  })

  return clipPath
}
