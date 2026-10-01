import { MODELING_AREA_CONTAINER_ID } from '@src/lib/layout/modelingArea'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const MODELING_DIALOG_TOOLBAR_GAP_PX = 8

function getToolbarBottomOffset(wrapper: HTMLElement | null): number {
  if (typeof window === 'undefined') {
    return 0
  }

  const toolbar = window.document.querySelector<HTMLElement>(
    '[data-testid="toolbar"]'
  )
  if (!toolbar) {
    return 0
  }

  const wrapperTop = wrapper?.getBoundingClientRect().top ?? 0
  return Math.max(
    0,
    toolbar.getBoundingClientRect().bottom -
      wrapperTop +
      MODELING_DIALOG_TOOLBAR_GAP_PX
  )
}

export function useModelingDialogBounds() {
  const dialogPositioningRef = useRef<HTMLDivElement>(null)
  const [dialogTopOffset, setDialogTopOffset] = useState(0)
  const [dialogMaxHeight, setDialogMaxHeight] = useState<number>()
  const modelingAreaContainerRef = useRef<HTMLElement | null>(
    typeof window === 'undefined'
      ? null
      : window.document.getElementById(MODELING_AREA_CONTAINER_ID)
  )
  useEffect(() => {
    modelingAreaContainerRef.current = window.document.getElementById(
      MODELING_AREA_CONTAINER_ID
    )
  }, [])

  useLayoutEffect(() => {
    const wrapper = dialogPositioningRef.current
    const dialog = wrapper?.querySelector<HTMLElement>(
      '[data-testid="modeling-dialog"]'
    )
    const container = modelingAreaContainerRef.current
    const toolbar = window.document.querySelector<HTMLElement>(
      '[data-testid="toolbar"]'
    )
    if (!wrapper || !dialog) {
      return
    }

    const updateDialogBounds = () => {
      setDialogTopOffset(getToolbarBottomOffset(wrapper))
      const bottom = Math.min(
        window.innerHeight,
        container?.getBoundingClientRect().bottom ?? window.innerHeight
      )
      setDialogMaxHeight(
        Math.max(
          0,
          bottom -
            dialog.getBoundingClientRect().top -
            MODELING_DIALOG_TOOLBAR_GAP_PX
        )
      )
    }

    updateDialogBounds()

    const observer = new ResizeObserver(updateDialogBounds)
    observer.observe(dialog)
    if (toolbar) {
      observer.observe(toolbar)
    }
    if (container) {
      observer.observe(container)
    }
    // Dragging changes the inline top without resizing the dialog.
    const positionObserver = new MutationObserver(updateDialogBounds)
    positionObserver.observe(dialog, {
      attributes: true,
      attributeFilter: ['style'],
    })
    window.addEventListener('resize', updateDialogBounds)

    return () => {
      observer.disconnect()
      positionObserver.disconnect()
      window.removeEventListener('resize', updateDialogBounds)
    }
  }, [dialogTopOffset])

  return {
    dialogPositioningRef,
    modelingAreaContainerRef,
    dialogTopOffset,
    dialogMaxHeight,
  }
}
