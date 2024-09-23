import { MouseControlType } from 'wasm-lib/kcl/bindings/MouseControlType'
import { platform } from './utils'

const PLATFORM = platform()
const META =
  PLATFORM === 'macos' ? 'Cmd' : PLATFORM === 'windows' ? 'Win' : 'Super'
const ALT = PLATFORM === 'macos' ? 'Option' : 'Alt'

const noModifiersPressed = (e: MouseEvent) =>
  !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey

export type CameraSystem =
  | 'KittyCAD'
  | 'OnShape'
  | 'Trackpad Friendly'
  | 'Apple Trackpad'
  | 'Solidworks'
  | 'NX'
  | 'Creo'
  | 'AutoCAD'

export const cameraSystems: CameraSystem[] = [
  'KittyCAD',
  'OnShape',
  'Trackpad Friendly',
  'Apple Trackpad',
  'Solidworks',
  'NX',
  'Creo',
  'AutoCAD',
]

export function mouseControlsToCameraSystem(
  mouseControl: MouseControlType | undefined
): CameraSystem | undefined {
  switch (mouseControl) {
    case 'kitty_cad':
      return 'KittyCAD'
    case 'on_shape':
      return 'OnShape'
    case 'trackpad_friendly':
      return 'Trackpad Friendly'
    case 'apple_trackpad':
      return 'Apple Trackpad'
    case 'solidworks':
      return 'Solidworks'
    case 'nx':
      return 'NX'
    case 'creo':
      return 'Creo'
    case 'auto_cad':
      return 'AutoCAD'
    default:
      return undefined
  }
}

interface MouseGuardHandler {
  description: string
  callback: (e: MouseEvent) => boolean
  scrollCallback: (e: WheelEvent) => boolean
  lenientDragStartButton?: number
}

interface MouseGuardZoomHandler {
  description: string
  dragCallback: (e: MouseEvent) => boolean
  scrollCallback: (e: WheelEvent) => boolean
  scrollAllowInvertY?: boolean
  pinchToZoom?: boolean
  lenientDragStartButton?: number
}

export interface MouseGuard {
  pan: MouseGuardHandler
  zoom: MouseGuardZoomHandler
  rotate: MouseGuardHandler
}

export const btnName = (e: MouseEvent) => ({
  middle: !!(e.buttons & 4) || e.button === 1,
  right: !!(e.buttons & 2) || e.button === 2,
  left: !!(e.buttons & 1) || e.button === 0,
})

export const cameraMouseDragGuards: Record<CameraSystem, MouseGuard> = {
  KittyCAD: {
    pan: {
      description: 'Shift + Right click drag or middle click drag',
      callback: (e) =>
        (btnName(e).middle && noModifiersPressed(e)) ||
        (btnName(e).right && e.shiftKey),
      scrollCallback: () => false,
    },
    zoom: {
      description: 'Scroll or Ctrl + Right click drag',
      dragCallback: (e) => !!(e.buttons & 2) && e.ctrlKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Right click drag',
      callback: (e) => btnName(e).right && noModifiersPressed(e),
      scrollCallback: () => false,
    },
  },
  OnShape: {
    pan: {
      description: 'Ctrl + Right click drag or middle click drag',
      callback: (e) =>
        (btnName(e).right && e.ctrlKey) ||
        (btnName(e).middle && noModifiersPressed(e)),
      scrollCallback: () => false,
    },
    zoom: {
      description: 'Scroll',
      dragCallback: () => false,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Right click drag',
      callback: (e) => btnName(e).right && noModifiersPressed(e),
      scrollCallback: () => false,
    },
  },
  'Trackpad Friendly': {
    pan: {
      description: `${ALT} + Shift + Left click drag or middle click drag`,
      callback: (e) =>
        (btnName(e).left && e.altKey && e.shiftKey && !e.metaKey) ||
        (btnName(e).middle && noModifiersPressed(e)),
      scrollCallback: () => false,
    },
    zoom: {
      description: `Scroll or ${ALT} + ${META} + Left click drag`,
      dragCallback: (e) => btnName(e).left && e.altKey && e.metaKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: `${ALT} + Left click drag`,
      callback: (e) => btnName(e).left && e.altKey && !e.shiftKey && !e.metaKey,
      scrollCallback: () => false,
      lenientDragStartButton: 0,
    },
  },
  'Apple Trackpad': {
    pan: {
      description: `Scroll or one finger drag`,
      callback: (e) => btnName(e).left && noModifiersPressed(e),
      scrollCallback: (e) => e.deltaMode === 0 && noModifiersPressed(e),
      lenientDragStartButton: 0,
    },
    zoom: {
      description: `Shift + Scroll`,
      dragCallback: (e) => false,
      scrollCallback: (e) =>
        e.deltaMode === 0 &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey,
      scrollAllowInvertY: true,
      pinchToZoom: true,
    },
    rotate: {
      description: `${ALT} + Scroll`,
      callback: (e) => false,
      scrollCallback: (e) =>
        e.deltaMode === 0 &&
        e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey,
    },
  },
  Solidworks: {
    pan: {
      description: 'Ctrl + Right click drag',
      callback: (e) => btnName(e).right && e.ctrlKey,
      scrollCallback: () => false,
      lenientDragStartButton: 2,
    },
    zoom: {
      description: 'Scroll or Shift + Middle click drag',
      dragCallback: (e) => btnName(e).middle && e.shiftKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Middle click drag',
      callback: (e) => btnName(e).middle && noModifiersPressed(e),
      scrollCallback: () => false,
    },
  },
  NX: {
    pan: {
      description: 'Shift + Middle click drag',
      callback: (e) => btnName(e).middle && e.shiftKey,
      scrollCallback: () => false,
    },
    zoom: {
      description: 'Scroll or Ctrl + Middle click drag',
      dragCallback: (e) => btnName(e).middle && e.ctrlKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Middle click drag',
      callback: (e) => btnName(e).middle && noModifiersPressed(e),
      scrollCallback: () => false,
    },
  },
  Creo: {
    pan: {
      description: 'Ctrl + Left click drag',
      callback: (e) => btnName(e).left && !btnName(e).right && e.ctrlKey,
      scrollCallback: () => false,
    },
    zoom: {
      description: 'Scroll or Ctrl + Right click drag',
      dragCallback: (e) => btnName(e).right && !btnName(e).left && e.ctrlKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Ctrl + Middle (or Left + Right) click drag',
      callback: (e) => {
        const b = btnName(e)
        return (b.middle || (b.left && b.right)) && e.ctrlKey
      },
      scrollCallback: () => false,
    },
  },
  AutoCAD: {
    pan: {
      description: 'Middle click drag',
      callback: (e) => btnName(e).middle && noModifiersPressed(e),
      scrollCallback: () => false,
    },
    zoom: {
      description: 'Scroll',
      dragCallback: () => false,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Shift + Middle click drag',
      callback: (e) => btnName(e).middle && e.shiftKey,
      scrollCallback: () => false,
    },
  },
}
