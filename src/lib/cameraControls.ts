import { platform } from '@src/lib/utils'

const PLATFORM = platform()
const META =
  PLATFORM === 'macos' ? 'Cmd' : PLATFORM === 'windows' ? 'Win' : 'Super'
const ALT = PLATFORM === 'macos' ? 'Option' : 'Alt'

const noModifiersPressed = (e: MouseEvent) =>
  !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey

export type CameraSystem =
  | 'Zoo'
  | 'Onshape'
  | 'Trackpad Friendly'
  | 'SolidWorks'
  | 'NX'
  | 'Creo'
  | 'AutoCAD'
  | 'CATIA'

// Serialized version of these system names
type MouseControlType =
  | 'zoo'
  | 'onshape'
  | 'trackpad_friendly'
  | 'solidworks'
  | 'nx'
  | 'creo'
  | 'autocad'
  | 'catia'

export const cameraSystems: CameraSystem[] = [
  'Zoo',
  'Onshape',
  'Trackpad Friendly',
  'SolidWorks',
  'NX',
  'Creo',
  'AutoCAD',
  'CATIA',
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
      return 'Onshape'
    case 'trackpad_friendly':
      return 'Trackpad Friendly'
    case 'solidworks':
      return 'SolidWorks'
    case 'nx':
      return 'NX'
    case 'creo':
      return 'Creo'
    // TODO: understand why the values come back without underscores and fix the root cause
    // @ts-ignore: TS2678
    case 'autocad':
      return 'AutoCAD'
    case 'catia':
      return 'CATIA'
    case undefined:
    default:
      return undefined
  }
}

export function cameraSystemToMouseControl(
  cameraSystem: CameraSystem
): MouseControlType | undefined {
  switch (cameraSystem) {
    case 'Zoo':
      return 'zoo'
    case 'Onshape':
      return 'onshape'
    case 'Trackpad Friendly':
      return 'trackpad_friendly'
    case 'SolidWorks':
      return 'solidworks'
    case 'NX':
      return 'nx'
    case 'Creo':
      return 'creo'
    case 'AutoCAD':
      return 'autocad'
    case 'CATIA':
      return 'catia'
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

/** A mouse drag's action before camera orbit and sketch restrictions are applied. */
export type MouseDragInteraction = 'pan' | 'rotate' | 'zoom' | 'none'

export type MouseDragInput = Pick<
  MouseEvent,
  'buttons' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'
>

/** Prior held inputs distinguish Ctrl-first zoom from Middle-first rotation. */
export interface MouseDragState {
  interaction: MouseDragInteraction
  buttons: number
  ctrlKey: boolean
}

export interface MouseGuard {
  pan: MouseGuardHandler
  zoom: MouseGuardZoomHandler
  rotate: MouseGuardHandler
  /** Resolves button transitions using the preceding event in this pointer drag. */
  resolveDrag?: (
    event: MouseDragInput,
    previous: MouseDragState
  ) => MouseDragInteraction
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
  Onshape: {
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
  SolidWorks: {
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
  CATIA: {
    pan: {
      description: 'Middle click drag',
      callback: (e) => e.buttons === 4 && noModifiersPressed(e),
    },
    rotate: {
      description: 'Hold Middle, then Ctrl or Left or Right, and drag',
      callback: (e) =>
        !!(e.buttons & 4) && !!(e.buttons & 3) && noModifiersPressed(e),
    },
    zoom: {
      description:
        'Hold Ctrl, then Middle, and drag; or hold Middle, click and release Left or Right, then drag; or scroll',
      dragCallback: () => false,
      scrollCallback: (e) => e.buttons === 0,
    },
    resolveDrag: (e, previous) => {
      if (!(e.buttons & 4) || e.shiftKey || e.altKey || e.metaKey) return 'none'
      if (e.buttons & 3) return 'rotate'
      if (e.ctrlKey) {
        if (!(previous.buttons & 4)) return 'zoom'
        if (!previous.ctrlKey) return 'rotate'
        return previous.interaction === 'zoom' ? 'zoom' : 'rotate'
      }
      return previous.interaction === 'rotate' ||
        previous.interaction === 'zoom'
        ? 'zoom'
        : 'pan'
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
