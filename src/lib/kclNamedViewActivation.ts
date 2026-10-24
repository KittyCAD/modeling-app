import type { CameraViewState } from '@kittycad/lib'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { effect, signal } from '@preact/signals-core'
import toast from 'react-hot-toast'

import type { KclManager } from '@src/lang/KclManager'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import {
  engineIdsForVisibility,
  getViewUniverse,
  listNamedViews,
  visibilityForKclDefault,
  visibilityForView,
} from '@src/lang/std/kclNamedViews'
import type { ExecState } from '@src/lang/wasm'
import { getAllOperations } from '@src/lang/wasm'
import { applyNamedViewCamera } from '@src/lib/kclNamedViewCamera'
import { hiddenArtifactIdsFromOperations } from '@src/lib/operations'
import { err, reportRejection } from '@src/lib/trap'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'
import type { modelingMachine } from '@src/machines/modelingMachine'
import { PerspectiveCamera } from 'three'
import type { StateFrom } from 'xstate'

export type ActivationTarget =
  | { kind: 'kclDefault' } // `kclDefault` is computed, so it carries no artifact.
  | { kind: 'declared'; view: KclNamedView }

export function isSketchSessionOpen(
  state: StateFrom<typeof modelingMachine> | null | undefined
): boolean {
  return (
    state?.matches('Sketch') === true ||
    state?.matches('sketchSolveMode') === true
  )
}

type DeclaredViewIdentity = {
  name: string
  moduleKey: string | undefined
}

export type ActiveView = DeclaredViewIdentity | 'kclDefault'

/**
 * The active view, or null when no view is selected.
 */
export const activeViewSignal = signal<ActiveView | null>('kclDefault')

/**
 * The camera as it was before the active view moved it.
 *
 * Null while `Default View` is active. Held here rather than in
 * `CameraControls.oldCameraState`, which is owned by the idle-reconnect.
 */
let preActivationCamera: CameraViewState | null = null

let stopReapplyEffect: (() => void) | null = null
let stopCameraChangeListener: (() => void) | null = null

export function resetNamedViewSession(): void {
  stopReapplyEffect?.()
  stopReapplyEffect = null
  stopTrackingActiveViewCamera()
  preActivationCamera = null
  activeViewSignal.value = null
}

export function moduleKeyOf(path: ModulePath | undefined): string | undefined {
  if (path === undefined) {
    return undefined
  }

  return path.type === 'Main' ? 'Main' : `${path.type}:${path.value}`
}

export function isSameView(
  left: ActiveView | null,
  right: ActiveView | null
): boolean {
  if (
    left === null ||
    right === null ||
    left === 'kclDefault' ||
    right === 'kclDefault'
  ) {
    return left === right
  }

  return left.name === right.name && left.moduleKey === right.moduleKey
}

export async function activateNamedView({
  target,
  kclManager,
}: {
  target: ActivationTarget
  kclManager: KclManager
}): Promise<void> {
  if (!kclManager.engineCommandManager.isReady) {
    return
  }

  if (target.kind === 'declared') {
    await savePreActivationCamera(kclManager)
  }

  await applyVisibility({
    target,
    execState: kclManager.execState,
    kclManager,
  })

  await applyAndTrackCamera(target, kclManager)
  if (target.kind === 'declared') {
    installReapplyEffect(kclManager)
  }

  activeViewSignal.value =
    target.kind === 'kclDefault'
      ? 'kclDefault'
      : {
          name: target.view.artifact.name,
          moduleKey: moduleKeyOf(target.view.modulePath),
        }
}

async function applyAndTrackCamera(
  target: ActivationTarget,
  kclManager: KclManager
): Promise<void> {
  // Applying or restoring a named view must not count as navigating away.
  stopTrackingActiveViewCamera()
  try {
    if (target.kind === 'declared') {
      await applyNamedViewCamera({
        camera: target.view.artifact.camera,
        sceneInfra: kclManager.sceneInfra,
        engineCommandManager: kclManager.engineCommandManager,
      })
    } else {
      await restorePreActivationCamera(kclManager)
    }
  } finally {
    trackActiveViewCamera(kclManager)
  }
}

export function stopTrackingActiveViewCamera(): void {
  stopCameraChangeListener?.()
  stopCameraChangeListener = null
}

export function trackActiveViewCamera(kclManager: KclManager): void {
  stopTrackingActiveViewCamera()
  const controls = kclManager.sceneInfra.camControls
  const initialCamera = controls.camera.clone()
  const initialTarget = controls.target.clone()
  stopCameraChangeListener = controls.cameraChange.add(() => {
    const camera = controls.camera
    const projectionChanged =
      camera.type !== initialCamera.type ||
      (camera instanceof PerspectiveCamera &&
        initialCamera instanceof PerspectiveCamera &&
        camera.fov !== initialCamera.fov)
    if (
      projectionChanged ||
      !camera.position.equals(initialCamera.position) ||
      !camera.quaternion.equals(initialCamera.quaternion) ||
      camera.zoom !== initialCamera.zoom ||
      !controls.target.equals(initialTarget)
    ) {
      resetNamedViewSession()
    }
  })
}

async function applyVisibility({
  target,
  execState,
  kclManager,
}: {
  target: ActivationTarget
  execState: ExecState
  kclManager: KclManager
}): Promise<void> {
  const artifactGraph = execState.artifactGraph
  const universe = getViewUniverse(artifactGraph)

  const visibility =
    target.kind === 'kclDefault'
      ? visibilityForKclDefault({
          universe,
          hiddenIds: hiddenArtifactIdsFromOperations(
            getAllOperations(execState.operations)
          ),
        })
      : visibilityForView({ universe, view: target.view.artifact })

  await kclManager.engineCommandManager.setObjectsHidden(
    engineIdsForVisibility({ visibility, universe, artifactGraph })
  )
}

async function savePreActivationCamera(kclManager: KclManager): Promise<void> {
  if (preActivationCamera !== null) {
    return
  }

  const view = await kclManager.sceneInfra.camControls.getCameraView()
  if (err(view)) {
    return
  }

  preActivationCamera = view
}

async function restorePreActivationCamera(
  kclManager: KclManager
): Promise<boolean> {
  const view = preActivationCamera
  if (view === null) {
    return false
  }

  preActivationCamera = null
  await kclManager.sceneInfra.camControls.setCameraView(view)
  return true
}

/** Installs the effect that reapplies the active view after each execution. */
function installReapplyEffect(kclManager: KclManager): void {
  if (stopReapplyEffect !== null) {
    return
  }

  let lastAppliedGeneration = kclManager.engineSceneGenerationSignal.peek()

  stopReapplyEffect = effect(() => {
    const generation = kclManager.engineSceneGenerationSignal.value
    // reapplyActiveView does nothing while a sketch is open, so wait for it to close.
    const sketchOpen = isSketchSessionOpen(kclManager.modelingStateSignal.value)
    if (generation === lastAppliedGeneration || sketchOpen) {
      return
    }

    lastAppliedGeneration = generation
    reapplyActiveView(kclManager).catch(reportRejection)
  })
}

async function reapplyActiveView(kclManager: KclManager): Promise<void> {
  const context = reapplyContext(kclManager)
  if (context === null) {
    return
  }

  const { active, execState, view } = context

  if (view === undefined) {
    await fallBackToKclDefault({ active, execState, kclManager })
    return
  }

  await applyVisibility({
    target: { kind: 'declared', view },
    execState,
    kclManager,
  })
}

export async function reapplyActiveViewAfterReconnect(
  kclManager: KclManager,
  { restoreCamera = true }: { restoreCamera?: boolean } = {}
): Promise<boolean> {
  const context = reapplyContext(kclManager)
  if (context === null) {
    return false
  }

  const { active, execState, view } = context

  if (view === undefined) {
    return fallBackToKclDefault({
      active,
      execState,
      kclManager,
      restoreCamera,
    })
  }

  await applyVisibility({
    target: { kind: 'declared', view },
    execState,
    kclManager,
  })
  if (!restoreCamera) {
    return false
  }
  await applyAndTrackCamera({ kind: 'declared', view }, kclManager)

  return true
}

function reapplyContext(kclManager: KclManager): {
  active: DeclaredViewIdentity
  execState: ExecState
  view: KclNamedView | undefined
} | null {
  const active = activeViewSignal.peek()

  if (
    active === null ||
    active === 'kclDefault' ||
    !kclManager.engineCommandManager.isReady ||
    kclManager.errors.length > 0 ||
    isSketchSessionOpen(kclManager.modelingState)
  ) {
    return null
  }

  const execState = kclManager.execState

  return { active, execState, view: findDeclaredView({ active, execState }) }
}

/** Returns the view a declared identity names, or undefined once it is gone. */
function findDeclaredView({
  active,
  execState,
}: {
  active: DeclaredViewIdentity
  execState: ExecState
}): KclNamedView | undefined {
  return listNamedViews({
    artifactGraph: execState.artifactGraph,
    filenames: execState.filenames,
  }).find((view) =>
    isSameView(
      { name: view.artifact.name, moduleKey: moduleKeyOf(view.modulePath) },
      active
    )
  )
}

async function fallBackToKclDefault({
  active,
  execState,
  kclManager,
  restoreCamera = true,
}: {
  active: DeclaredViewIdentity
  execState: ExecState
  kclManager: KclManager
  restoreCamera?: boolean
}): Promise<boolean> {
  await applyVisibility({
    target: { kind: 'kclDefault' },
    execState,
    kclManager,
  })
  const restored = restoreCamera
    ? await restorePreActivationCamera(kclManager)
    : false
  activeViewSignal.value = 'kclDefault'
  trackActiveViewCamera(kclManager)

  toast.error(
    `The view "${active.name}" is no longer in this program. Showing ${getKclDefaultViewName()}.`
  )

  return restored
}
