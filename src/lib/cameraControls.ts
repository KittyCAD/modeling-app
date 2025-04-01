import { MouseControlType } from '@rust/kcl-lib/bindings/MouseControlType'
import { platform } from './utils'

const PLATFORM = platform()
const META =
  PLATFORM === 'macos' ? 'Cmd' : PLATFORM === 'windows' ? 'Win' : 'Super'
const ALT = PLATFORM === 'macos' ? 'Option' : 'Alt'

const noModifiersPressed = (e: MouseEvent) =>
  !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey

export type CameraSystem =
  | 'Zoo'
  | 'OnShape'
  | 'Trackpad Friendly'
  | 'Solidworks'
  | 'NX'
  | 'Creo'
  | 'AutoCAD'

export const cameraSystems: CameraSystem[] = [
  'Zoo',
  'OnShape',
  'Trackpad Friendly',
  'Solidworks',
  'NX',
  'Creo',
  'AutoCAD',
]

export function mouseControlsToCameraSystem(
  mouseControl: MouseControlType | undefined
): CameraSystem | undefined {
  switch (mouseControl) {
    // TODO: understand why the values come back without underscores and fix the root cause
    // @ts-ignore: TS2678
    case 'zoo':
      return 'Zoo'
    // TODO: understand why the values come back without underscores and fix the root cause
    // @ts-ignore: TS2678
    case 'onshape':
    case 'on_shape':
      return 'OnShape'
    case 'trackpad_friendly':
      return 'Trackpad Friendly'
    case 'solidworks':
      return 'Solidworks'
    case 'nx':
      return 'NX'
    case 'creo':
      return 'Creo'
    // TODO: understand why the values come back without underscores and fix the root cause
    // @ts-ignore: TS2678
    case 'autocad':
    case 'auto_cad':
      return 'AutoCAD'
    default:
      return undefined
  }
}

interface MouseGuardHandler {
  description: string
  callback: (e: MouseEvent) => boolean
  lenientDragStartButton?: number
}

interface MouseGuardZoomHandler {
  description: string
  dragCallback: (e: MouseEvent) => boolean
  scrollCallback: (e: WheelEvent) => boolean
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
  Zoo: {
    pan: {
      description: 'Shift + Right click drag or middle click drag',
      callback: (e) =>
        (btnName(e).middle && noModifiersPressed(e)) ||
        (btnName(e).right && e.shiftKey),
    },
    zoom: {
      description: 'Scroll or Ctrl + Right click drag',
      dragCallback: (e) => !!(e.buttons & 2) && e.ctrlKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Right click drag',
      callback: (e) => btnName(e).right && noModifiersPressed(e),
    },
  },
  OnShape: {
    pan: {
      description: 'Ctrl + Right click drag or middle click drag',
      callback: (e) =>
        (btnName(e).right && e.ctrlKey) ||
        (btnName(e).middle && noModifiersPressed(e)),
    },
    zoom: {
      description: 'Scroll',
      dragCallback: () => false,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Right click drag',
      callback: (e) => btnName(e).right && noModifiersPressed(e),
    },
  },
  'Trackpad Friendly': {
    pan: {
      description: `${ALT} + Shift + Left click drag or middle click drag`,
      callback: (e) =>
        (btnName(e).left && e.altKey && e.shiftKey && !e.metaKey) ||
        (btnName(e).middle && noModifiersPressed(e)),
    },
    zoom: {
      description: `Scroll or ${ALT} + ${META} + Left click drag`,
      dragCallback: (e) => btnName(e).left && e.altKey && e.metaKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: `${ALT} + Left click drag`,
      callback: (e) => btnName(e).left && e.altKey && !e.shiftKey && !e.metaKey,
      lenientDragStartButton: 0,
    },
  },
  Solidworks: {
    pan: {
      description: 'Ctrl + Right click drag',
      callback: (e) => btnName(e).right && e.ctrlKey,
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
    },
  },
  NX: {
    pan: {
      description: 'Shift + Middle click drag',
      callback: (e) => btnName(e).middle && e.shiftKey,
    },
    zoom: {
      description: 'Scroll or Ctrl + Middle click drag',
      dragCallback: (e) => btnName(e).middle && e.ctrlKey,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Middle click drag',
      callback: (e) => btnName(e).middle && noModifiersPressed(e),
    },
  },
  Creo: {
    pan: {
      description: 'Ctrl + Left click drag',
      callback: (e) => btnName(e).left && !btnName(e).right && e.ctrlKey,
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
    },
  },
  AutoCAD: {
    pan: {
      description: 'Middle click drag',
      callback: (e) => btnName(e).middle && noModifiersPressed(e),
    },
    zoom: {
      description: 'Scroll',
      dragCallback: () => false,
      scrollCallback: (e) => e.buttons === 0,
    },
    rotate: {
      description: 'Shift + Middle click drag',
      callback: (e) => btnName(e).middle && e.shiftKey,
    },
  },
}
