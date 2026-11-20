import {
  isLineSelectionId,
  selectionTargetId,
} from '@src/clientSideScene/localRenderer/selectionId'
import type { LocalRenderer } from '@src/clientSideScene/localRenderer/LocalRenderer'
import { reportRejection } from '@src/lib/trap'

export type PickBufferSnapshot = {
  width: number
  height: number
  pixels: Uint8ClampedArray
  seedPixels?: Uint8ClampedArray
}

type DebugViewState = {
  active: boolean
  showingSeeds: boolean
  opacity: number
}

let debugView: PickBufferDebugView | null = null
let generation = 0
let pending: Promise<void> | null = null
let paused = false
let refresh: (() => void) | undefined
let disconnect: (() => void) | undefined

export function closePickBufferDebug() {
  generation++
  disconnect?.()
  disconnect = undefined
  refresh = undefined
  debugView?.dispose()
}

export function showPickBufferDebug(source: LocalRenderer) {
  const view = source.getPickView()
  if (!view) return new Error('No current local picking buffer is available.')
  closePickBufferDebug()
  const overlay = PickBufferDebugView.create(view.container)
  if (overlay instanceof Error) return overlay
  refresh = () => {
    generation++
    if (paused || pending) return
    const read = async () => {
      let version
      do {
        version = generation
        const current = source.getPickView()
        const snapshot = current && (await current.capture())
        if (version === generation && debugView === overlay && !paused) {
          if (snapshot && current?.isCurrent()) overlay.update(snapshot)
          else overlay.clear()
        }
      } while (version !== generation && debugView === overlay && !paused)
    }
    pending = read()
      .catch(reportRejection)
      .finally(() => {
        pending = null
        if (debugView !== overlay) refresh?.()
      })
  }
  const unsubscribe = source.subscribeFrames(refresh)
  view.signal.addEventListener('abort', closePickBufferDebug)
  disconnect = () => {
    unsubscribe()
    view.signal.removeEventListener('abort', closePickBufferDebug)
  }
  refresh()
}

export async function withPickBufferDebugPaused<T>(run: () => Promise<T>) {
  if (paused) return new Error('Benchmark already running.')
  paused = true
  generation++
  try {
    await pending
    return await run()
  } finally {
    paused = false
    refresh?.()
  }
}
let debugViewState: DebugViewState = {
  active: false,
  showingSeeds: false,
  opacity: 100,
}
const listeners = new Set<() => void>()

export const subscribePickBufferDebug = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getPickBufferDebugState = () => debugViewState

function updateState(state: DebugViewState) {
  debugViewState = state
  listeners.forEach((listener) => listener())
}

export function setPickBufferDebugSeeds(showingSeeds: boolean) {
  updateState({ ...debugViewState, showingSeeds })
  debugView?.redraw()
}

export function setPickBufferDebugOpacity(opacity: number) {
  updateState({ ...debugViewState, opacity })
  debugView?.setOpacity(opacity)
}

const FACE_COLORS = [
  [162, 200, 238],
  [245, 205, 143],
  [166, 219, 183],
  [221, 182, 230],
] as const

const EDGE_COLORS = [
  [255, 40, 210],
  [235, 55, 245],
  [255, 72, 169],
  [213, 44, 222],
  [255, 96, 202],
  [232, 64, 178],
  [255, 58, 236],
  [222, 80, 192],
] as const

export function colorizePickBuffer(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  packedIds: boolean
): Uint8ClampedArray {
  const colors = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex =
        ((packedIds ? height - 1 - y : y) * width + x) * (packedIds ? 4 : 1)
      const encodedId = packedIds
        ? (pixels[sourceIndex] ?? 0) |
          ((pixels[sourceIndex + 1] ?? 0) << 8) |
          ((pixels[sourceIndex + 2] ?? 0) << 16)
        : (pixels[sourceIndex] ?? 0)
      const id = selectionTargetId(encodedId)
      const color =
        id === 0
          ? ([28, 28, 28] as const)
          : isLineSelectionId(encodedId)
            ? EDGE_COLORS[(id - 1) % EDGE_COLORS.length]
            : FACE_COLORS[(id - 1) % FACE_COLORS.length]
      const outputIndex = (y * width + x) * 4
      colors[outputIndex] = color[0]
      colors[outputIndex + 1] = color[1]
      colors[outputIndex + 2] = color[2]
      colors[outputIndex + 3] = 255
    }
  }
  return colors
}

export class PickBufferDebugView {
  private readonly root = document.createElement('div')
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private snapshot: PickBufferSnapshot | null = null

  private constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D
  ) {
    this.canvas = canvas
    this.context = context
    this.root.className = 'pointer-events-none absolute inset-0 z-10'
    canvas.className = 'absolute inset-0 h-full w-full'
    canvas.style.imageRendering = 'pixelated'
    this.root.append(canvas)
    container.append(this.root)
  }

  static create(container: HTMLElement) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return new Error('Cannot display the picking buffer')
    const view = new PickBufferDebugView(container, canvas, context)
    debugView = view
    updateState({ ...debugViewState, active: true })
    view.setOpacity(debugViewState.opacity)
    return view
  }

  update(snapshot: PickBufferSnapshot) {
    this.snapshot = snapshot
    if (!snapshot.seedPixels && debugViewState.showingSeeds) {
      setPickBufferDebugSeeds(false)
    }
    this.canvas.width = snapshot.width
    this.canvas.height = snapshot.height
    this.draw()
  }

  clear() {
    this.snapshot = null
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  dispose() {
    this.root.remove()
    if (debugView === this) {
      debugView = null
      updateState({ ...debugViewState, active: false })
    }
  }

  setOpacity(opacity: number) {
    this.canvas.style.opacity = String(opacity / 100)
  }

  redraw() {
    this.draw()
  }

  private draw() {
    const snapshot = this.snapshot
    if (!snapshot) return
    const pixels = debugViewState.showingSeeds
      ? snapshot.seedPixels
      : snapshot.pixels
    if (!pixels) return
    const image = this.context.createImageData(snapshot.width, snapshot.height)
    image.data.set(pixels)
    this.context.putImageData(image, 0, 0)
  }
}
