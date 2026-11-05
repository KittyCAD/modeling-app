import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import {
  rayTracingService,
  type RayTracingService,
  type RenderingMode,
} from '@src/registry/contracts/rayTracing'

export function RayTracingControls({
  service,
}: {
  service: RayTracingService
}) {
  useSignals()
  const pathTracing = {
    ...service.options.value,
    setMode: (mode: RenderingMode) => service.update({ mode }),
    setDenoise: (denoise: boolean) => service.update({ denoise }),
    setEdges: (edges: boolean) => service.update({ edges }),
    setEdgeOpacity: (edgeOpacity: number) => service.update({ edgeOpacity }),
    setFadeDuration: (fadeDuration: number) => service.update({ fadeDuration }),
    setDenoiseFadeDuration: (denoiseFadeDuration: number) =>
      service.update({ denoiseFadeDuration }),
    setThresholdPercent: (thresholdPercent: number) =>
      service.update({ thresholdPercent }),
  }
  return (
    <div className="flex flex-col gap-2 rounded border px-2 py-2 text-xs backdrop-blur-sm bg-chalkboard-10/80 dark:bg-chalkboard-100/80 border-chalkboard-20 dark:border-chalkboard-80">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <select
          aria-label="Rendering mode"
          className="max-w-full bg-transparent text-xs"
          value={pathTracing.mode}
          onChange={(event) => {
            const mode = event.target.value
            if (
              mode === 'standard' ||
              mode === 'ray-tracing' ||
              mode === 'ray-tracing-without-drag' ||
              mode === 'ray-tracing-stealth' ||
              mode === 'ray-tracing-threshold-transition'
            ) {
              pathTracing.setMode(mode)
            }
          }}
        >
          <option value="standard">Standard</option>
          <option value="ray-tracing">Ray Tracing</option>
          <option value="ray-tracing-without-drag">
            Ray Tracing Without Drag
          </option>
          <option value="ray-tracing-stealth">Ray Tracing Stealth</option>
          <option value="ray-tracing-threshold-transition">
            Ray Tracing Threshold Transition
          </option>
        </select>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={pathTracing.denoise}
            disabled={pathTracing.mode === 'standard'}
            onChange={(event) => pathTracing.setDenoise(event.target.checked)}
          />
          AI Denoise
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={pathTracing.edges}
            disabled={pathTracing.mode === 'standard'}
            onChange={(event) => pathTracing.setEdges(event.target.checked)}
          />
          Edges
        </label>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Edge Opacity</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            className="w-20 accent-primary"
            value={Math.round(pathTracing.edgeOpacity * 100)}
            disabled={pathTracing.mode === 'standard' || !pathTracing.edges}
            onChange={(event) =>
              pathTracing.setEdgeOpacity(Number(event.target.value) / 100)
            }
          />
          <span className="w-8 tabular-nums">
            {Math.round(pathTracing.edgeOpacity * 100)}%
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          Fade Duration (ms)
          <input
            type="number"
            min="0"
            step="100"
            className="w-20 rounded border border-chalkboard-30 bg-transparent px-1 dark:border-chalkboard-70"
            value={pathTracing.fadeDuration}
            disabled={
              pathTracing.mode !== 'ray-tracing-without-drag' &&
              pathTracing.mode !== 'ray-tracing-stealth' &&
              pathTracing.mode !== 'ray-tracing-threshold-transition'
            }
            onChange={(event) => {
              const duration = event.target.valueAsNumber
              if (Number.isFinite(duration) && duration >= 0) {
                pathTracing.setFadeDuration(duration)
              }
            }}
          />
        </label>
        {pathTracing.mode === 'ray-tracing-threshold-transition' && (
          <label
            className="flex items-center gap-1.5"
            title="Minimum sampling progress before the fade starts. 100% is the sampling target, before denoising."
          >
            Sample Threshold (%)
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              className="w-16 rounded border border-chalkboard-30 bg-transparent px-1 dark:border-chalkboard-70"
              value={pathTracing.thresholdPercent}
              onChange={(event) => {
                const percent = event.target.valueAsNumber
                if (
                  Number.isFinite(percent) &&
                  percent >= 0 &&
                  percent <= 100
                ) {
                  pathTracing.setThresholdPercent(percent)
                }
              }}
            />
          </label>
        )}
        {pathTracing.mode === 'ray-tracing-threshold-transition' && (
          <label
            className="flex items-center gap-1.5"
            title="Fade from the noisy image to the completed AI-denoised image."
          >
            Denoise Fade (ms)
            <input
              type="number"
              min="0"
              step="50"
              className="w-16 rounded border border-chalkboard-30 bg-transparent px-1 dark:border-chalkboard-70"
              value={pathTracing.denoiseFadeDuration}
              disabled={!pathTracing.denoise}
              onChange={(event) => {
                const duration = event.target.valueAsNumber
                if (Number.isFinite(duration) && duration >= 0)
                  pathTracing.setDenoiseFadeDuration(duration)
              }}
            />
          </label>
        )}
      </div>
    </div>
  )
}

export function RayTracingDebugPanel() {
  useSignals()
  const { registry } = useApp()
  const service = registry.signal(rayTracingService).value
  return (
    <details
      open
      className="rounded border border-chalkboard-30 bg-chalkboard-10/95 p-2 text-xs shadow dark:border-chalkboard-70 dark:bg-chalkboard-100/95"
    >
      <summary className="cursor-pointer font-semibold">
        Ray Tracing Debug
      </summary>
      <div className="mt-2 max-h-[65vh] overflow-auto">
        {!service ? (
          <p>Enable Ray Tracing in Modeling settings.</p>
        ) : !service.supported.value ? (
          <p>Ray tracing requires a WebGPU local viewport.</p>
        ) : (
          <RayTracingControls service={service} />
        )}
      </div>
    </details>
  )
}
