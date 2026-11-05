import { CustomIcon } from '@src/components/CustomIcon'
import type { EngineSceneViewExtensionProps } from '@src/registry/contracts/engineScene'
import { Suspense, lazy } from 'react'

const Toolbar = lazy(async () => {
  const { Toolbar } = await import('@src/Toolbar')
  return { default: Toolbar }
})

const Gizmo = lazy(async () => {
  const { default: Gizmo } = await import('@src/components/gizmo/Gizmo')
  return { default: Gizmo }
})

export function EngineSceneToolbarViewExtension() {
  return (
    <div className="toolbar-container">
      <Suspense fallback={null}>
        <Toolbar />
      </Suspense>
    </div>
  )
}

export function EngineSceneGizmoViewExtension() {
  return (
    <Suspense fallback={null}>
      <Gizmo />
    </Suspense>
  )
}

export function SketchBackgroundOpacityViewExtension({
  sketchSolveStreamDimming,
  setSketchSolveStreamDimming,
}: EngineSceneViewExtensionProps) {
  const streamVisibilityPercent = Math.round(
    (1 - sketchSolveStreamDimming) * 100
  )

  return (
    <div className="px-2 py-1 border border-chalkboard-20 dark:border-chalkboard-80 rounded bg-chalkboard-10/80 dark:bg-chalkboard-100/80 backdrop-blur-sm">
      <div className="text-[10px] text-chalkboard-70 dark:text-chalkboard-40">
        Background Opacity
      </div>
      <input
        aria-label="Sketch background opacity"
        type="range"
        min="0"
        max="100"
        step="1"
        value={streamVisibilityPercent}
        onChange={(event) => {
          const nextVisibilityPercent = Number(event.target.value)
          setSketchSolveStreamDimming((100 - nextVisibilityPercent) / 100)
        }}
        className="w-32 cursor-pointer"
      />
    </div>
  )
}

export function SketchConstraintsToggleViewExtension({
  modelingState,
  modelingSend,
}: EngineSceneViewExtensionProps) {
  const showNonVisualConstraints =
    modelingState.context.showNonVisualConstraints

  return (
    <button
      type="button"
      aria-pressed={showNonVisualConstraints}
      aria-label="Toggle non-visual constraints"
      title="Show constraints"
      onClick={() => modelingSend({ type: 'toggle non-visual constraints' })}
      className={`h-8 px-2 rounded border text-xs flex items-center gap-1.5 backdrop-blur-sm ${
        showNonVisualConstraints
          ? 'bg-primary text-chalkboard-10 border-primary'
          : 'bg-chalkboard-10/80 dark:bg-chalkboard-100/80 border-chalkboard-20 dark:border-chalkboard-80'
      }`}
    >
      <CustomIcon
        name={showNonVisualConstraints ? 'eyeOpen' : 'eyeCrossedOut'}
        className="w-4 h-4"
      />
      Constraints
    </button>
  )
}

export function PathTraceToggleViewExtension({
  pathTracing,
}: EngineSceneViewExtensionProps) {
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
