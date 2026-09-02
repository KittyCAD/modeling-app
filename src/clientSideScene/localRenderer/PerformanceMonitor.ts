import type {
  IntegerIdPickerDiagnostics,
  IntegerIdPickerGeometryStats,
} from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import type { WebGPURenderer } from 'three/webgpu'

const PERFORMANCE_LOG_PREFIX = '[WEBGPU_POC][LocalRendererPerformance]'
const PERFORMANCE_LOG_INTERVAL_MS = 3_000
const PERFORMANCE_LOG_FRAME_LIMIT = 120
const BYTES_PER_MEBIBYTE = 1024 * 1024

export type LocalRendererFrameMetrics = {
  requestAnimationFrameDelayMs: number
  frameSetupCpuMs: number
  sceneCpuSubmissionMs: number
  baseCacheCpuSubmissionMs: number
  compositionCpuSubmissionMs: number
  highlightCpuSubmissionMs: number
  presentationCpuSubmissionMs: number
  totalCpuSubmissionMs: number
  rendererRenderCalls: number
  drawCalls: number
  triangles: number
  lines: number
  maskPasses: number
  highlightLinePasses: number
  viewportWidth: number
  viewportHeight: number
  pixelRatio: number
  ssaoEnabled: boolean
  baseRendered: boolean
  hoverActive: boolean
  selectionCount: number
}

type PickMetric = {
  kind: 'hover' | 'selection'
  totalCpuMs: number
  diagnostics: IntegerIdPickerDiagnostics | null
}

type NumericSummary = {
  average: number
  median: number
  p95: number
  maximum: number
}

type ChromiumPerformanceMemory = {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

type PerformanceWithMemory = Performance & {
  memory?: ChromiumPerformanceMemory
}

declare global {
  interface Window {
    __LOCAL_WEBGPU_PERFORMANCE__?: unknown
  }
}

export class LocalRendererPerformanceMonitor {
  private readonly renderer: WebGPURenderer
  private intervalStartedAt = performance.now()
  private frames: LocalRendererFrameMetrics[] = []
  private frameIntervalsMs: number[] = []
  private picks: PickMetric[] = []
  private previousFrameAt: number | null = null
  private latestFrame: LocalRendererFrameMetrics | null = null
  private geometry: IntegerIdPickerGeometryStats | null = null
  private initialFrameLogged = false

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer
  }

  setGeometry(geometry: IntegerIdPickerGeometryStats | null) {
    this.geometry = geometry
    this.initialFrameLogged = false
    this.resetSamples(performance.now())
  }

  recordFrame(metrics: LocalRendererFrameMetrics) {
    if (!this.geometry) {
      return
    }

    const now = performance.now()
    if (this.previousFrameAt !== null) {
      this.frameIntervalsMs.push(now - this.previousFrameAt)
    }
    this.previousFrameAt = now
    this.latestFrame = metrics
    this.frames.push(metrics)

    if (!this.initialFrameLogged) {
      this.initialFrameLogged = true
      this.logSnapshot('initial-frame', now)
      return
    }

    this.maybeLogSnapshot(now)
  }

  recordPick(
    kind: PickMetric['kind'],
    totalCpuMs: number,
    diagnostics?: IntegerIdPickerDiagnostics
  ) {
    this.picks.push({
      kind,
      totalCpuMs,
      diagnostics: diagnostics ?? null,
    })
    this.maybeLogSnapshot(performance.now())
  }

  private maybeLogSnapshot(now: number) {
    if (
      now - this.intervalStartedAt >= PERFORMANCE_LOG_INTERVAL_MS ||
      this.frames.length >= PERFORMANCE_LOG_FRAME_LIMIT
    ) {
      this.logSnapshot('interval', now)
    }
  }

  private logSnapshot(sample: 'initial-frame' | 'interval', now: number) {
    const snapshot = this.buildSnapshot(sample, now)
    window.__LOCAL_WEBGPU_PERFORMANCE__ = snapshot
    console.info(
      `${PERFORMANCE_LOG_PREFIX}\n${JSON.stringify(snapshot, null, 2)}`
    )

    this.resetSamples(now)
  }

  private resetSamples(now: number) {
    this.intervalStartedAt = now
    this.frames = []
    this.frameIntervalsMs = []
    this.picks = []
    this.previousFrameAt = null
  }

  private buildSnapshot(sample: 'initial-frame' | 'interval', now: number) {
    const durationMs = Math.max(0, now - this.intervalStartedAt)
    const frameCount = this.frames.length
    const pickDiagnostics = this.picks.flatMap((pick) =>
      pick.diagnostics ? [pick.diagnostics] : []
    )
    const memory = this.renderer.info.memory
    const jsMemory = (performance as PerformanceWithMemory).memory
    const averageFrameCpuMs = average(
      this.frames.map((frame) => frame.totalCpuSubmissionMs)
    )

    return {
      schemaVersion: 1,
      sample,
      sampleDurationMs: round(durationMs),
      timingScope:
        'CPU-side render orchestration/command submission; GPU execution timing requires timestamp-query',
      viewport: this.latestFrame
        ? {
            width: this.latestFrame.viewportWidth,
            height: this.latestFrame.viewportHeight,
            pixelCount:
              this.latestFrame.viewportWidth * this.latestFrame.viewportHeight,
            pixelRatio: this.latestFrame.pixelRatio,
          }
        : null,
      state: this.latestFrame
        ? {
            ssaoEnabled: this.latestFrame.ssaoEnabled,
            hoverActive: this.latestFrame.hoverActive,
            selectionCount: this.latestFrame.selectionCount,
          }
        : null,
      rendering: {
        configuration: {
          msaaSamples: this.renderer.samples,
          outputBufferType: this.renderer.getOutputBufferType(),
          outputColorSpace: this.renderer.outputColorSpace,
          toneMapping: this.renderer.toneMapping,
          toneMappingExposure: this.renderer.toneMappingExposure,
        },
        frameCount,
        hoverActiveFrameCount: this.frames.filter((frame) => frame.hoverActive)
          .length,
        selectionActiveFrameCount: this.frames.filter(
          (frame) => frame.selectionCount > 0
        ).length,
        baseRenderedFrameCount: this.frames.filter(
          (frame) => frame.baseRendered
        ).length,
        renderedFramesPerSecond:
          sample === 'interval' && durationMs > 0
            ? round((frameCount * 1000) / durationMs)
            : null,
        cpuEquivalentFramesPerSecond:
          averageFrameCpuMs > 0 ? round(1000 / averageFrameCpuMs) : null,
        frameIntervalMs: summarizeNumbers(this.frameIntervalsMs),
        requestAnimationFrameDelayMs: summarizeFrameMetric(
          this.frames,
          'requestAnimationFrameDelayMs'
        ),
        cpuSubmissionMs: {
          total: summarizeFrameMetric(this.frames, 'totalCpuSubmissionMs'),
          frameSetup: summarizeFrameMetric(this.frames, 'frameSetupCpuMs'),
          scene: summarizeFrameMetric(this.frames, 'sceneCpuSubmissionMs'),
          baseCache: summarizeFrameMetric(
            this.frames,
            'baseCacheCpuSubmissionMs'
          ),
          composition: summarizeFrameMetric(
            this.frames,
            'compositionCpuSubmissionMs'
          ),
          highlights: summarizeFrameMetric(
            this.frames,
            'highlightCpuSubmissionMs'
          ),
          presentation: summarizeFrameMetric(
            this.frames,
            'presentationCpuSubmissionMs'
          ),
        },
        workPerFrame: {
          rendererRenderCalls: summarizeFrameMetric(
            this.frames,
            'rendererRenderCalls'
          ),
          drawCalls: summarizeFrameMetric(this.frames, 'drawCalls'),
          triangles: summarizeFrameMetric(this.frames, 'triangles'),
          lines: summarizeFrameMetric(this.frames, 'lines'),
          maskPasses: summarizeFrameMetric(this.frames, 'maskPasses'),
          highlightLinePasses: summarizeFrameMetric(
            this.frames,
            'highlightLinePasses'
          ),
        },
      },
      picking: {
        requestCount: this.picks.length,
        hoverRequestCount: this.picks.filter((pick) => pick.kind === 'hover')
          .length,
        selectionRequestCount: this.picks.filter(
          (pick) => pick.kind === 'selection'
        ).length,
        idBufferRenderCount: pickDiagnostics.filter(
          (diagnostics) => diagnostics.idBufferWasRendered
        ).length,
        idBufferCacheHitCount: pickDiagnostics.filter(
          (diagnostics) => !diagnostics.idBufferWasRendered
        ).length,
        staleResultCount: pickDiagnostics.filter(
          (diagnostics) => diagnostics.stale
        ).length,
        totalCpuMs: summarizeNumbers(this.picks.map((pick) => pick.totalCpuMs)),
        idBufferRenderSubmissionMs: summarizeNumbers(
          pickDiagnostics.map(
            (diagnostics) => diagnostics.idBufferRenderSubmissionDurationMs
          )
        ),
        idBufferReadbackMs: summarizeNumbers(
          pickDiagnostics.map(
            (diagnostics) => diagnostics.idBufferReadbackDurationMs
          )
        ),
      },
      memory: {
        threeTrackedGpu: {
          totalMiB: bytesToMebibytes(memory.total),
          textureMiB: bytesToMebibytes(memory.texturesSize),
          attributeMiB: bytesToMebibytes(
            memory.attributesSize +
              memory.indexAttributesSize +
              memory.storageAttributesSize +
              memory.indirectStorageAttributesSize
          ),
          programMiB: bytesToMebibytes(memory.programsSize),
          textureCount: memory.textures,
          renderTargetCount: memory.renderTargets,
          geometryCount: memory.geometries,
          programCount: memory.programs,
          note: 'Three.js estimate; excludes hidden MSAA/depth allocations and driver overhead',
        },
        chromiumJsHeap: jsMemory
          ? {
              usedMiB: bytesToMebibytes(jsMemory.usedJSHeapSize),
              totalMiB: bytesToMebibytes(jsMemory.totalJSHeapSize),
              limitMiB: bytesToMebibytes(jsMemory.jsHeapSizeLimit),
            }
          : null,
      },
      geometry: this.geometry,
    }
  }
}

function summarizeFrameMetric(
  frames: LocalRendererFrameMetrics[],
  key: keyof LocalRendererFrameMetrics
) {
  return summarizeNumbers(
    frames.flatMap((frame) => {
      const value = frame[key]
      return typeof value === 'number' ? [value] : []
    })
  )
}

function summarizeNumbers(values: number[]): NumericSummary | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  return {
    average: round(average(values)),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    maximum: round(sorted[sorted.length - 1]),
  }
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(sortedValues: number[], percentileValue: number) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1)
  )
  return sortedValues[index]
}

function bytesToMebibytes(bytes: number) {
  return round(bytes / BYTES_PER_MEBIBYTE)
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
