import type { SketchCorrespondenceEndpoint } from '@src/lib/kcl/correspondence/sketchContract'
import {
  createInteractionViews,
  type ModelingInteractionViewDefinition,
} from '@src/lib/kcl/interactionViews'
import type { SelectionSource } from '@src/lib/kcl/selection'
import { signal, type ReadonlySignal } from '@preact/signals-core'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { ToolbarViewItem } from '@src/components/Toolbar/ToolbarView'
import type { PlaneVisibilityMap } from '@src/machines/modelingSharedTypes'
import { isErr, reportRejection } from '@src/lib/trap'

/** A sustained interaction owns tools and scene input inside one Modeling presentation. */
export interface ModelingInteractionSession {
  id: string
  correspondence?: ReadonlySignal<SketchCorrespondenceEndpoint | undefined>
  /** False while acquiring a target or closing, before an interaction surface is usable. */
  viewActive?: ReadonlySignal<boolean>
  selection?: ReadonlySignal<SelectionSource | undefined>
  toolbar: ReadonlySignal<readonly ToolbarViewItem[]>
  prompt: ReadonlySignal<string>
  defaultPlanes: ReadonlySignal<PlaneVisibilityMap>
  error: ReadonlySignal<Error | undefined>
  escape: () => Promise<void>
  dispose: () => Promise<void>
}
export interface ModelingInteractionEntry {
  groupId?: string
  id: string
  name: string
  icon: ToolbarViewItem['icon']
  presentation?: (
    context: ModelingViewContext
  ) => Partial<
    Pick<
      ToolbarViewItem,
      | 'title'
      | 'tooltipTitle'
      | 'iconColor'
      | 'showTitle'
      | 'description'
      | 'links'
    >
  >
  createSession: (
    context: ModelingViewContext,
    signal: AbortSignal
  ) => Promise<ModelingInteractionSession | Error>
}
export interface ModelingInteractionDefinition {
  id: string
  entries: readonly ModelingInteractionEntry[]
}

/** Session resources outlive React mounts and close before another interaction takes scene ownership. */
export function createModelingInteractions(
  getContext: () => ModelingViewContext,
  definitions: ReadonlySignal<readonly ModelingInteractionDefinition[]>,
  viewDefinitions: ReadonlySignal<
    readonly ModelingInteractionViewDefinition[]
  > = signal([]),
  enterOwned?: (id: string) => Promise<void>
) {
  const active = signal<ModelingInteractionSession | undefined>(undefined)
  const busy = signal(false)
  const error = signal<Error | undefined>(undefined)
  const presentation = createInteractionViews(
    getContext,
    active,
    viewDefinitions,
    (failure) => {
      error.value = failure
    }
  )
  let controller: AbortController | undefined
  let generation = 0
  let disposed = false
  let closing = Promise.resolve()
  const close = () => {
    const ticket = ++generation
    controller?.abort()
    controller = undefined
    const session = active.peek()
    active.value = undefined
    busy.value = !!session
    const work = closing
      .then(() => session?.dispose())
      .then(() => undefined)
      .catch((cause) => {
        if (ticket === generation)
          error.value = isErr(cause)
            ? cause
            : new Error('Unable to leave interaction', { cause })
        return Promise.reject(cause)
      })
      .finally(() => {
        if (ticket === generation) busy.value = false
      })
    closing = work.catch(() => undefined)
    return work
  }
  return {
    active,
    observe: (
      session: ModelingInteractionSession | undefined,
      pending = false
    ) => {
      active.value = session
      busy.value = pending
    },
    views: presentation.views,
    busy,
    error,
    definitions,
    reportError: (failure: Error) => {
      error.value = failure
    },
    close,
    enter: async (id: string) => {
      if (disposed) return
      if (enterOwned) return enterOwned(id)
      await close()
      if (disposed) return
      const entry = definitions
        .peek()
        .flatMap((item) => item.entries)
        .find((item) => item.id === id)
      if (!entry) {
        error.value = new Error('Unknown modeling interaction')
        return
      }
      getContext().tools.close()
      const ticket = ++generation
      const lifetime = new AbortController()
      controller = lifetime
      busy.value = true
      error.value = undefined
      try {
        const result = await entry.createSession(getContext(), lifetime.signal)
        if (disposed || generation !== ticket) {
          if (!isErr(result)) await result.dispose()
          return
        }
        if (isErr(result)) error.value = result
        else active.value = result
      } catch (cause) {
        if (generation === ticket)
          error.value = isErr(cause)
            ? cause
            : new Error('Unable to enter interaction', { cause })
      } finally {
        if (generation === ticket) busy.value = false
      }
    },
    dispose: () => {
      disposed = true
      presentation.dispose()
      void close().catch(reportRejection)
    },
  }
}
