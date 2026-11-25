import {
  cameraViewDefinitions,
  type CameraViewAction,
} from '@src/lib/cameraViewCommands'
import { signal } from '@preact/signals-core'
import { ZOOM_TO_FIT_PADDING } from '@src/lib/constants'
import type { KclSceneResource } from '@src/lib/kcl/scene/open'

/** A mounted viewport supplies its current scene, including after reconnects. */
export type AttachCameraViewport = (
  element: HTMLElement,
  readScene: () => KclSceneResource | undefined
) => () => void

interface CameraViewport {
  element: HTMLElement
  readScene: () => KclSceneResource | undefined
}

/** Owns only command targeting; camera and selection remain owned by each scene. */
export function createCameraCommands(preserveFocus: () => boolean) {
  const focused = signal<CameraViewport | undefined>(undefined)
  const attach: AttachCameraViewport = (element, readScene) => {
    const registration = { element, readScene }
    const update = () => {
      const target = element.ownerDocument.activeElement
      const editing = target?.closest(
        'input, textarea, select, [contenteditable]'
      )
      if (target && element.contains(target) && !editing) {
        focused.value = registration
      } else if (focused.peek() === registration) {
        focused.value = undefined
      }
    }
    element.addEventListener('focusin', update)
    // During focusout activeElement can still be the old node. relatedTarget
    // identifies whether focus stays inside this viewport.
    const blur = (event: FocusEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !element.contains(event.relatedTarget)
      ) {
        if (focused.peek() === registration && !preserveFocus())
          focused.value = undefined
      }
    }
    element.addEventListener('focusout', blur)
    update()
    return () => {
      element.removeEventListener('focusin', update)
      element.removeEventListener('focusout', blur)
      if (focused.peek() === registration) focused.value = undefined
    }
  }
  const readReadyScene = () => {
    const scene = focused.value?.readScene()
    return scene?.viewControls && !scene.runtime.executing.value
      ? scene
      : undefined
  }
  return {
    attach,
    focused,
    releaseIfOutside: () => {
      const target = focused.peek()
      if (
        target &&
        !target.element.contains(target.element.ownerDocument.activeElement)
      )
        focused.value = undefined
    },
    available: (selectionRequired = false) => {
      const scene = readReadyScene()
      return (
        !!scene &&
        (!selectionRequired || scene.selection.displayed.value.length > 0)
      )
    },
    run: (action: CameraViewAction) => {
      const scene = readReadyScene()
      const host = scene?.viewControls
      if (!scene || !host) return false
      const definition = cameraViewDefinitions.find(
        (candidate) => candidate.id === action
      )
      if (!definition) return false
      if ('axis' in definition)
        return host.sceneInfra.camControls.updateCameraToAxis(definition.axis)
      switch (definition.id) {
        case 'fit':
          return host.sceneInfra.camControls.zoomToFit({
            padding: ZOOM_TO_FIT_PADDING,
          })
        case 'reset':
          return host.reset()
        case 'center':
          return scene.selection.displayed.value.length > 0
            ? host.sceneInfra.camControls.centerOnSelection()
            : false
      }
    },
  }
}
