import { MouseControlType } from 'wasm-lib/kcl/bindings/MouseControlType'

const noModifiersPressed = (e: React.MouseEvent) =>
  !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey

export type CameraSystem =
  | 'KittyCAD'
  | 'OnShape'
  | 'Trackpad Friendly'
  | 'Solidworks'
  | 'NX'
  | 'Creo'
  | 'AutoCAD'

export const cameraSystems: CameraSystem[] = [
  'KittyCAD',
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
    case 'kitty_cad':
      return 'KittyCAD'
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
    case 'auto_cad':
      return 'AutoCAD'
    default:
      return undefined
  }
}

interface MouseGuardHandler {
  description: string
  callback: (e: React.MouseEvent) => boolean
  lenientDragStartButton?: number
}

interface MouseGuardZoomHandler {
  description: string
  dragCallback: (e: React.MouseEvent) => boolean
  scrollCallback: (e: React.MouseEvent) => boolean
  lenientDragStartButton?: number
}

export interface MouseGuard {
  pan: MouseGuardHandler
  zoom: MouseGuardZoomHandler
  rotate: MouseGuardHandler
}

export const butName = (e: React.MouseEvent) => ({
  middle: !!(e.buttons & 4) || e.button === 1,
  right: !!(e.buttons & 2) || e.button === 2,
  left: !!(e.buttons & 1) || e.button === 0,
})

export const cameraMouseDragGuards: Record<CameraSystem, MouseGuard> = {
  KittyCAD: {
    pan: {
      description: 'Right click + Shift + drag or middle click + drag',
      callback: (e) =>
        (butName(e).middle && noModifiersPressed(e)) ||
        (butName(e).right && e.shiftKey),
    },
    zoom: {
      description: 'Scroll wheel or Right click + Ctrl + drag',
      dragCallback: (e) => !!(e.buttons & 2) && e.ctrlKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Right click + drag',
      callback: (e) => butName(e).right && noModifiersPressed(e),
    },
  },
  OnShape: {
    pan: {
      description: 'Right click + Ctrl + drag or middle click + drag',
      callback: (e) =>
        (butName(e).right && e.ctrlKey) ||
        (butName(e).middle && noModifiersPressed(e)),
    },
    zoom: {
      description: 'Scroll wheel',
      dragCallback: () => false,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Right click + drag',
      callback: (e) => butName(e).right && noModifiersPressed(e),
    },
  },
  'Trackpad Friendly': {
    pan: {
      description: 'Left click + Alt + Shift + drag or middle click + drag',
      callback: (e) =>
        (butName(e).left && e.altKey && e.shiftKey && !e.metaKey) ||
        (butName(e).middle && noModifiersPressed(e)),
    },
    zoom: {
      description: 'Scroll wheel or Left click + Alt + OS + drag',
      dragCallback: (e) => butName(e).left && e.altKey && e.metaKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Left click + Alt + drag',
      callback: (e) => butName(e).left && e.altKey && !e.shiftKey && !e.metaKey,
      lenientDragStartButton: 0,
    },
  },
  Solidworks: {
    pan: {
      description: 'Right click + Ctrl + drag',
      callback: (e) => butName(e).right && e.ctrlKey,
      lenientDragStartButton: 2,
    },
    zoom: {
      description: 'Scroll wheel or Middle click + Shift + drag',
      dragCallback: (e) => butName(e).middle && e.shiftKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle click + drag',
      callback: (e) => butName(e).middle && noModifiersPressed(e),
    },
  },
  NX: {
    pan: {
      description: 'Middle click + Shift + drag',
      callback: (e) => butName(e).middle && e.shiftKey,
    },
    zoom: {
      description: 'Scroll wheel or Middle click + Ctrl + drag',
      dragCallback: (e) => butName(e).middle && e.ctrlKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle click + drag',
      callback: (e) => butName(e).middle && noModifiersPressed(e),
    },
  },
  Creo: {
    pan: {
      description: 'Left click + Ctrl + drag',
      callback: (e) => butName(e).left && !butName(e).right && e.ctrlKey,
    },
    zoom: {
      description: 'Scroll wheel or Right click + Ctrl + drag',
      dragCallback: (e) => butName(e).right && !butName(e).left && e.ctrlKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle (or Left + Right) click + Ctrl + drag',
      callback: (e) => {
        const b = butName(e)
        return (b.middle || (b.left && b.right)) && e.ctrlKey
      },
    },
  },
  AutoCAD: {
    pan: {
      description: 'Middle click + drag',
      callback: (e) => butName(e).middle && noModifiersPressed(e),
    },
    zoom: {
      description: 'Scroll wheel',
      dragCallback: () => false,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle click + Shift + drag',
      callback: (e) => butName(e).middle && e.shiftKey,
    },
  },
}
