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

const ModelingDialogViewExtension = lazy(async () => {
  const { ModelingDialogViewExtension } = await import(
    './ModelingDialogViewExtension'
  )
  return { default: ModelingDialogViewExtension }
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

export function EngineSceneModelingDialogViewExtension() {
  return (
    <Suspense fallback={null}>
      <ModelingDialogViewExtension />
    </Suspense>
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
