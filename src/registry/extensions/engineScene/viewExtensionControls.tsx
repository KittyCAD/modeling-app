import { SketchBackgroundOpacityControl } from '@src/components/SketchBackgroundOpacityControl'
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

const ModelingDialogViewExtension = lazy(async () => ({
  default: (await import('./ModelingDialogViewExtension'))
    .ModelingDialogViewExtension,
}))

export function EngineSceneModelingDialogViewExtension(
  props: EngineSceneViewExtensionProps
) {
  return (
    <Suspense fallback={null}>
      <ModelingDialogViewExtension {...props} />
    </Suspense>
  )
}

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
  return (
    <SketchBackgroundOpacityControl
      dimming={sketchSolveStreamDimming}
      onDimmingChange={setSketchSolveStreamDimming}
    />
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
