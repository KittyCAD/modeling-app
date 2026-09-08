import type { CameraViewState } from '@kittycad/lib'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { effect, signal } from '@preact/signals-core'
import toast from 'react-hot-toast'

import type { KclManager } from '@src/lang/KclManager'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import {
  KCL_DEFAULT_VIEW_NAME,
  engineIdsForVisibility,
  getViewUniverse,
  listNamedViews,
  visibilityForKclDefault,
  visibilityForView,
} from '@src/lang/std/kclNamedViews'
import type { ExecState } from '@src/lang/wasm'
import { getAllOperations } from '@src/lang/wasm'
import { NAMED_VIEWS_UI_FEATURE_FLAG } from '@src/lib/constants'
import { applyNamedViewCamera } from '@src/lib/kclNamedViewCamera'
import { hiddenArtifactIdsFromOperations } from '@src/lib/operations'
import { err, reportRejection } from '@src/lib/trap'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { StateFrom } from 'xstate'

export type ActivationTarget =
  | { kind: 'kclDefault' } // `kclDefault` is computed, so it carries no artifact.
  | { kind: 'declared'; view: KclNamedView }

export function hasNamedViewsUi(): boolean {
  return (
    window.app?.userFeatures.has(NAMED_VIEWS_UI_FEATURE_FLAG, false) ?? false
  )
}

export function isSketchSessionOpen(
  state: StateFrom<typeof modelingMachine> | null | undefined
): boolean {
  return (
    state?.matches('Sketch') === true ||
    state?.matches('sketchSolveMode') === true
  )
}

export type ActiveView = {
  name: string
  moduleKey: string | undefined
}

/**
 * The active view, or null for `Default View`.
 */
export const activeViewSignal = signal<ActiveView | null>(null)

/**
 * The camera as it was before the active view moved it.
 *
 * Null while `Default View` is active. Held here rather than in
 * `CameraControls.oldCameraState`, which is owned by the idle-reconnect.
 */
let preActivationCamera: CameraViewState | null = null

let stopReapplyEffect: (() => void) | null = null

export function resetNamedViewSession(): void {
  stopReapplyEffect?.()
  stopReapplyEffect = null
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
  if (left === null || right === null) {
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
  if (!hasNamedViewsUi() || !kclManager.engineCommandManager.isReady) {
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

  if (target.kind === 'declared') {
    await applyNamedViewCamera({
      camera: target.view.artifact.camera,
      sceneInfra: kclManager.sceneInfra,
      engineCommandManager: kclManager.engineCommandManager,
    })
    installReapplyEffect(kclManager)
  } else {
    await restorePreActivationCamera(kclManager)
  }

  activeViewSignal.value =
    target.kind === 'kclDefault'
      ? null
      : {
          name: target.view.artifact.name,
          moduleKey: moduleKeyOf(target.view.modulePath),
        }
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

  let lastSeenGeneration = kclManager.engineSceneGenerationSignal.peek()

  stopReapplyEffect = effect(() => {
    const generation = kclManager.engineSceneGenerationSignal.value
    if (generation === lastSeenGeneration) {
      return
    }

    lastSeenGeneration = generation
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
  kclManager: KclManager
): Promise<boolean> {
  const context = reapplyContext(kclManager)
  if (context === null) {
    return false
  }

  const { active, execState, view } = context

  if (view === undefined) {
    return fallBackToKclDefault({ active, execState, kclManager })
  }

  await applyVisibility({
    target: { kind: 'declared', view },
    execState,
    kclManager,
  })
  await applyNamedViewCamera({
    camera: view.artifact.camera,
    sceneInfra: kclManager.sceneInfra,
    engineCommandManager: kclManager.engineCommandManager,
  })

  return true
}

function reapplyContext(kclManager: KclManager): {
  active: ActiveView
  execState: ExecState
  view: KclNamedView | undefined
} | null {
  const active = activeViewSignal.peek()

  if (
    active === null ||
    !hasNamedViewsUi() ||
    !kclManager.engineCommandManager.isReady ||
    kclManager.errors.length > 0 ||
    isSketchSessionOpen(kclManager.modelingState)
  ) {
    return null
  }

  const execState = kclManager.execState

  return { active, execState, view: findDeclaredView({ active, execState }) }
}

/** Returns the view an ActiveView names, or undefined once it is gone. */
function findDeclaredView({
  active,
  execState,
}: {
  active: ActiveView
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
}: {
  active: ActiveView
  execState: ExecState
  kclManager: KclManager
}): Promise<boolean> {
  await applyVisibility({
    target: { kind: 'kclDefault' },
    execState,
    kclManager,
  })
  const restored = await restorePreActivationCamera(kclManager)
  activeViewSignal.value = null

  toast.error(
    `The view "${active.name}" is no longer in this program. Showing ${KCL_DEFAULT_VIEW_NAME}.`
  )

  return restored
}
