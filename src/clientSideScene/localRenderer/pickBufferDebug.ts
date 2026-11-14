import { EdgeTargetType } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { selectionTargetId } from '@src/clientSideScene/localRenderer/selectionId'
import type { Mesh } from 'three'

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
  packedIds: boolean,
  targetById: readonly (Mesh | null)[]
): Uint8ClampedArray {
  const ids = new Uint32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex =
        ((packedIds ? height - 1 - y : y) * width + x) * (packedIds ? 4 : 1)
      ids[y * width + x] = packedIds
        ? (pixels[sourceIndex] ?? 0) |
          ((pixels[sourceIndex + 1] ?? 0) << 8) |
          ((pixels[sourceIndex + 2] ?? 0) << 16)
        : (pixels[sourceIndex] ?? 0)
    }
  }
  const colors = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = selectionTargetId(ids[y * width + x])
      const target = targetById[id]
      const color = !target
        ? ([28, 28, 28] as const)
        : target.userData.type === EdgeTargetType.BodyEdge ||
            target.userData.type === EdgeTargetType.SketchLine
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
