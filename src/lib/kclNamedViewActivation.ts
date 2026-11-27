import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { effect, signal } from '@preact/signals-core'
import toast from 'react-hot-toast'

import type { KclManager } from '@src/lang/KclManager'
import type { ResolvedNamedView } from '@rust/kcl-lib/bindings/ResolvedNamedView'
import type { ExecState } from '@src/lang/wasm'
import {
  applyNamedViewCamera,
  onCameraMoved,
} from '@src/lib/kclNamedViewCamera'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { reportRejection } from '@src/lib/trap'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { StateFrom } from 'xstate'

export type ActivationTarget =
  | { kind: 'kclDefault' } // `kclDefault` is computed, so it carries no artifact.
  | { kind: 'declared'; view: ResolvedNamedView }

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

let stopReapplyEffect: (() => void) | null = null
let stopCameraChangeListener: (() => void) | null = null

export function resetNamedViewSession(): void {
  stopReapplyEffect?.()
  stopReapplyEffect = null
  stopTrackingActiveViewCamera()
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

  const batch = kclManager.execState.namedViews?.batch
  if (target.kind === 'declared' && !batch?.namedViews.includes(target.view)) {
    return
  }

  await applyVisibility(
    target.kind === 'declared' ? target.view.visibility : batch?.defaultView,
    kclManager
  )

  await applyAndTrackCamera(target, kclManager)
  if (target.kind === 'declared') {
    installReapplyEffect(kclManager)
  }

  activeViewSignal.value =
    target.kind === 'kclDefault'
      ? 'kclDefault'
      : {
          name: target.view.info.name,
          moduleKey: moduleKeyOf(target.view.info.modulePath),
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
        camera: target.view.cameraIntent,
        sceneInfra: kclManager.sceneInfra,
      })
    } else {
      await resetCameraPosition({
        sceneInfra: kclManager.sceneInfra,
        settingsActor: kclManager.systemDeps.settings,
      })
    }
  } finally {
    startTrackingActiveViewCamera(kclManager)
  }
}

export function stopTrackingActiveViewCamera(): void {
  stopCameraChangeListener?.()
  stopCameraChangeListener = null
}

export function startTrackingActiveViewCamera(kclManager: KclManager): void {
  stopTrackingActiveViewCamera()
  stopCameraChangeListener = onCameraMoved(
    kclManager.sceneInfra.camControls,
    () => {
      const hadActiveView = activeViewSignal.peek() !== null
      resetNamedViewSession()
      if (!hadActiveView || !kclManager.engineCommandManager.isReady) return

      applyVisibility(
        kclManager.execState.namedViews?.batch.defaultView,
        kclManager
      ).catch(reportRejection)
    }
  )
}

async function applyVisibility(
  visibility: ResolvedNamedView['visibility'] | undefined,
  kclManager: KclManager
): Promise<void> {
  if (visibility === undefined) return

  await kclManager.engineCommandManager.setObjectsHidden(
    new Map(Object.entries(visibility))
  )
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

  const { active, batch, view } = context

  if (view === undefined) {
    await fallBackToKclDefault({
      active,
      visibility: batch.defaultView,
      kclManager,
    })
    return
  }

  await applyVisibility(view.visibility, kclManager)
}

export async function reapplyActiveViewAfterReconnect(
  kclManager: KclManager,
  { restoreCamera = true }: { restoreCamera?: boolean } = {}
): Promise<boolean> {
  const context = reapplyContext(kclManager)
  if (context === null) {
    return false
  }

  const { active, batch, view } = context

  if (view === undefined) {
    return fallBackToKclDefault({
      active,
      visibility: batch.defaultView,
      kclManager,
      restoreCamera,
    })
  }

  await applyVisibility(view.visibility, kclManager)
  if (!restoreCamera) {
    return false
  }
  await applyAndTrackCamera({ kind: 'declared', view }, kclManager)

  return true
}

function reapplyContext(kclManager: KclManager): {
  active: DeclaredViewIdentity
  batch: NonNullable<ExecState['namedViews']>['batch']
  view: ResolvedNamedView | undefined
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

  const execution = kclManager.execState.namedViews
  if (execution === null) return null

  const { batch, filenames } = execution
  const view = batch.namedViews.find(
    ({ info }) =>
      info.name === active.name &&
      moduleKeyOf(info.modulePath) === active.moduleKey
  )
  // A resolution failure can leave the active view present without a usable result.
  if (
    view === undefined &&
    batch.failures.some((failure) => {
      const path = filenames[failure.moduleId]
      return (
        failure.name === active.name &&
        (path === undefined || moduleKeyOf(path) === active.moduleKey)
      )
    })
  ) {
    return null
  }

  return { active, batch, view }
}

async function fallBackToKclDefault({
  active,
  visibility,
  kclManager,
  restoreCamera = true,
}: {
  active: DeclaredViewIdentity
  visibility: ResolvedNamedView['visibility']
  kclManager: KclManager
  restoreCamera?: boolean
}): Promise<boolean> {
  await applyVisibility(visibility, kclManager)
  if (restoreCamera) {
    await applyAndTrackCamera({ kind: 'kclDefault' }, kclManager)
    activeViewSignal.value = 'kclDefault'
  } else {
    resetNamedViewSession()
  }

  const fallback = restoreCamera
    ? `Showing ${getKclDefaultViewName()}.`
    : 'Keeping the current camera.'
  toast.error(
    `The view "${active.name}" is no longer in this program. ${fallback}`
  )

  return restoreCamera
}
