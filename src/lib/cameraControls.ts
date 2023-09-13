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

interface MouseGuard {
  pan: MouseGuardHandler
  zoom: MouseGuardZoomHandler
  rotate: MouseGuardHandler
}

export const cameraMouseDragGuards: Record<CameraSystem, MouseGuard> = {
  KittyCAD: {
    pan: {
      description: 'Right click + Shift + drag or middle click + drag',
      callback: (e) =>
        (e.button === 1 && noModifiersPressed(e)) ||
        (e.button === 2 && e.shiftKey),
    },
    zoom: {
      description: 'Scroll wheel or Right click + Ctrl + drag',
      dragCallback: (e) => e.button === 2 && e.ctrlKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Right click + drag',
      callback: (e) => e.button === 2 && noModifiersPressed(e),
    },
  },
  OnShape: {
    pan: {
      description: 'Right click + Ctrl + drag or middle click + drag',
      callback: (e) =>
        (e.button === 2 && e.ctrlKey) ||
        (e.button === 1 && noModifiersPressed(e)),
    },
    zoom: {
      description: 'Scroll wheel',
      dragCallback: () => false,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Right click + drag',
      callback: (e) => e.button === 2 && noModifiersPressed(e),
    },
  },
  'Trackpad Friendly': {
    pan: {
      description: 'Left click + Alt + Shift + drag or middle click + drag',
      callback: (e) =>
        (e.button === 0 && e.altKey && e.shiftKey && !e.metaKey) ||
        (e.button === 1 && noModifiersPressed(e)),
    },
    zoom: {
      description: 'Scroll wheel or Left click + Alt + OS + drag',
      dragCallback: (e) => e.button === 0 && e.altKey && e.metaKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Left click + Alt + drag',
      callback: (e) => e.button === 0 && e.altKey && !e.shiftKey && !e.metaKey,
      lenientDragStartButton: 0,
    },
  },
  Solidworks: {
    pan: {
      description: 'Right click + Ctrl + drag',
      callback: (e) => e.button === 2 && e.ctrlKey,
      lenientDragStartButton: 2,
    },
    zoom: {
      description: 'Scroll wheel or Middle click + Shift + drag',
      dragCallback: (e) => e.button === 1 && e.shiftKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle click + drag',
      callback: (e) => e.button === 1 && noModifiersPressed(e),
    },
  },
  NX: {
    pan: {
      description: 'Middle click + Shift + drag',
      callback: (e) => e.button === 1 && e.shiftKey,
    },
    zoom: {
      description: 'Scroll wheel or Middle click + Ctrl + drag',
      dragCallback: (e) => e.button === 1 && e.ctrlKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle click + drag',
      callback: (e) => e.button === 1 && noModifiersPressed(e),
    },
  },
  Creo: {
    pan: {
      description: 'Middle click + Shift + drag',
      callback: (e) => e.button === 1 && e.shiftKey,
    },
    zoom: {
      description: 'Scroll wheel or Middle click + Ctrl + drag',
      dragCallback: (e) => e.button === 1 && e.ctrlKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle click + drag',
      callback: (e) => e.button === 1 && noModifiersPressed(e),
    },
  },
  AutoCAD: {
    pan: {
      description: 'Middle click + drag',
      callback: (e) => e.button === 1 && noModifiersPressed(e),
    },
    zoom: {
      description: 'Scroll wheel',
      dragCallback: () => false,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Middle click + Shift + drag',
      callback: (e) => e.button === 1 && e.shiftKey,
    },
  },
}
