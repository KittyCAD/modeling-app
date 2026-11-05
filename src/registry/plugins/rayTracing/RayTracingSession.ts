import { effect, type ReadonlySignal } from '@preact/signals-core'
import type {
  SceneRenderContext,
  SceneRenderExtension,
  SceneRenderFrame,
} from '@src/clientSideScene/localRenderer/renderExtension'
import type { RayTracingOptions } from '@src/registry/contracts/rayTracing'
import { PathTraceRenderer } from './PathTraceRenderer'
import { RenderTransition } from './RenderTransition'

type RayTracingBackend = Pick<
  PathTraceRenderer,
  | 'setModel'
  | 'setDenoise'
  | 'setDenoiseFadeDuration'
  | 'invalidateCamera'
  | 'settled'
  | 'render'
  | 'renderEdges'
  | 'present'
  | 'dispose'
>

/** Owns all tracing policy and resources for one viewport, independently of its UI. */
export class RayTracingSession implements SceneRenderExtension {
  private readonly transition = new RenderTransition()
  private lastCameraChange = -Infinity
  private disposed = false
  private stopOptions: () => void
  private options: RayTracingOptions

  constructor(
    private readonly tracer: RayTracingBackend,
    options: ReadonlySignal<RayTracingOptions>,
    private readonly invalidate: () => void,
    private readonly onDispose: () => void = () => {}
  ) {
    this.options = options.peek()
    let previous: RayTracingOptions | undefined
    this.stopOptions = effect(() => {
      const next = options.value
      this.options = next
      if (
        !previous ||
        next.denoise !== previous.denoise ||
        (next.mode === 'standard') !== (previous.mode === 'standard')
      ) {
        // Standard mode must stop an in-flight denoise job as well as drawing raster.
        tracer.setDenoise(next.mode !== 'standard' && next.denoise)
        this.transition.update(false, performance.now(), false)
      }
      if (!previous || next.fadeDuration !== previous.fadeDuration)
        this.transition.setDuration(next.fadeDuration, performance.now())
      if (
        !previous ||
        next.denoiseFadeDuration !== previous.denoiseFadeDuration
      )
        tracer.setDenoiseFadeDuration(next.denoiseFadeDuration)
      previous = next
      invalidate()
    })
  }

  setModel(model: Parameters<SceneRenderExtension['setModel']>[0]) {
    if (this.disposed) return
    this.tracer.setModel(model)
    this.transition.update(false, performance.now(), false)
  }

  cameraChanged() {
    if (this.disposed) return
    this.lastCameraChange = performance.now()
    this.tracer.invalidateCamera()
  }

  resized() {
    this.transition.update(false, performance.now(), false)
  }

  private cameraMoving(isDragging: boolean) {
    return (
      this.options.mode !== 'ray-tracing' &&
      this.options.mode !== 'standard' &&
      (isDragging ||
        (this.options.mode === 'ray-tracing-stealth' &&
          performance.now() - this.lastCameraChange < 150))
    )
  }

  needsFrame(isDragging: boolean) {
    return (
      !this.disposed &&
      this.options.mode !== 'standard' &&
      (!this.tracer.settled ||
        this.transition.active ||
        this.cameraMoving(isDragging))
    )
  }

  renderFrame({
    camera,
    renderer,
    edges,
    isDragging,
    renderRaster,
  }: SceneRenderFrame) {
    const { mode } = this.options
    if (this.disposed || mode === 'standard') {
      this.transition.update(false, performance.now(), false)
      renderRaster()
      return
    }
    const moving = this.cameraMoving(isDragging)
    const ready =
      !moving &&
      this.tracer.render(
        camera,
        renderer,
        mode === 'ray-tracing-stealth',
        false,
        mode === 'ray-tracing-threshold-transition'
          ? this.options.thresholdPercent
          : undefined
      )
    const opacity = this.transition.update(
      ready,
      performance.now(),
      mode !== 'ray-tracing'
    )
    if (opacity > 0) {
      if (this.options.edges && edges)
        this.tracer.renderEdges(
          renderer,
          camera,
          edges,
          mode === 'ray-tracing' && isDragging ? 1 : this.options.edgeOpacity
        )
      this.tracer.present(renderer, opacity, renderRaster)
    } else renderRaster()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stopOptions()
    this.tracer.dispose()
    // Drop the cached traced frame even before the React bridge detaches us.
    this.invalidate()
    this.onDispose()
  }
}

export async function createRayTracingSession(
  context: SceneRenderContext,
  options: ReadonlySignal<RayTracingOptions>,
  onDispose: () => void
) {
  const tracer = await PathTraceRenderer.create(
    context.renderer,
    context.device,
    context.environment,
    context.environmentIntensity,
    context.invalidate
  )
  return new RayTracingSession(tracer, options, context.invalidate, onDispose)
}
