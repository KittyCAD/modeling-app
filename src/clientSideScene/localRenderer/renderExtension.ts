import type {
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Texture,
} from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import type { WebGPURenderer } from 'three/webgpu'

export interface SceneRenderFrame {
  camera: PerspectiveCamera | OrthographicCamera
  renderer: WebGPURenderer
  edges: LineSegments2 | null
  isDragging: boolean
  renderRaster: () => void
}

/** Optional rendering capability. The viewport retains ownership of its GPU. */
export interface SceneRenderExtension {
  setModel(model: Object3D | null): void
  cameraChanged(): void
  resized(): void
  needsFrame(isDragging: boolean): boolean
  renderFrame(frame: SceneRenderFrame): void
  dispose(): void
}

export interface SceneRenderContext {
  renderer: WebGPURenderer
  device: GPUDevice
  environment: Texture
  environmentIntensity: number
  invalidate: () => void
}

export type SceneRenderExtensionFactory = (
  context: SceneRenderContext
) => Promise<SceneRenderExtension | null>
