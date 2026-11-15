import {
  effect,
  signal,
  untracked,
  type ReadonlySignal,
} from '@preact/signals-core'
import type { ComponentType } from 'react'
import type { ModelingInteractionSession } from '@src/lib/kcl/interactions'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { isErr, reportRejection } from '@src/lib/trap'

/** A view contribution owns presentation state for one interaction, independently of React attachment. */
export interface ModelingInteractionView {
  Component: ComponentType
  dispose?: () => void
}
export interface ModelingInteractionViewDefinition {
  id: string
  matches: (
    context: ModelingViewContext,
    session: Pick<ModelingInteractionSession, 'id'>
  ) => boolean
  create: (
    context: ModelingViewContext,
    session: Pick<ModelingInteractionSession, 'id'>
  ) => ModelingInteractionView | Error
}

/** Register only matching active-interaction views; withdrawal, exit, or view closure releases their state. */
export function createInteractionViews(
  getContext: () => ModelingViewContext,
  active: ReadonlySignal<ModelingInteractionSession | undefined>,
  definitions: ReadonlySignal<readonly ModelingInteractionViewDefinition[]>,
  onError: (error: Error) => void
) {
  const views = signal<readonly { id: string; Component: ComponentType }[]>([])
  const registered = new Map<
    ModelingInteractionViewDefinition,
    ModelingInteractionView
  >()
  let owner: ModelingInteractionSession | undefined
  const release = (definition: ModelingInteractionViewDefinition) => {
    const view = registered.get(definition)
    registered.delete(definition)
    try {
      view?.dispose?.()
    } catch (cause) {
      reportRejection(cause)
    }
  }
  const stop = effect(() => {
    const session = active.value
    const enabled = !!session && session.viewActive?.value !== false
    const matching = enabled
      ? definitions.value.filter((definition) =>
          definition.matches(getContext(), session)
        )
      : []
    untracked(() => {
      if (session !== owner) {
        for (const definition of registered.keys()) release(definition)
        owner = session
      }
      for (const definition of registered.keys())
        if (!matching.includes(definition)) release(definition)
      for (const definition of matching) {
        if (registered.has(definition) || !session) continue
        try {
          const view = definition.create(getContext(), session)
          if (isErr(view)) onError(view)
          else registered.set(definition, view)
        } catch (cause) {
          onError(
            isErr(cause)
              ? cause
              : new Error('Unable to register interaction view', { cause })
          )
        }
      }
      views.value = matching.flatMap((definition) => {
        const view = registered.get(definition)
        return view ? [{ Component: view.Component, id: definition.id }] : []
      })
    })
  })
  return {
    views,
    dispose: () => {
      stop()
      views.value = []
      for (const definition of registered.keys()) release(definition)
      owner = undefined
    },
  }
}
