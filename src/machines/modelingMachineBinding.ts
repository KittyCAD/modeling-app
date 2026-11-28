import { batch } from '@preact/signals-core'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import type {
  modelingMachine,
  ModelingMachineEvent,
} from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'

/** Fields legacy modeling helpers use to read machine state and send events. */
export interface ModelingMachineStateHost {
  modelingSend: (event: ModelingMachineEvent) => void
  modelingState: SnapshotFrom<typeof modelingMachine> | null
  selectionRanges: Selections
}

// Each host has one active binding. Store its cleanup function so a new binding
// can detach the previous one before publishing to the same host.
const bindings = new WeakMap<ModelingMachineStateHost, () => void>()

/**
 * Keep the host's state and selection in sync with the actor, and forward events
 * sent through host.modelingSend to that actor.
 *
 * Legacy helpers access these fields on KclManager instead of receiving an actor
 * directly. ModelingMachineProvider binds the file route's actor to its manager.
 * An editor view can bind its own actor to its own manager through the same
 * function, so reusing those helpers does not connect sibling views' state.
 *
 * Helpers that later receive their state and event sender directly can stop
 * depending on these KclManager fields and this binding.
 *
 * The returned cleanup function detaches the host. The caller remains responsible
 * for starting and stopping the actor and waiting for its pending native work.
 */
export function bindModelingMachine(
  actor: ActorRefFrom<typeof modelingMachine>,
  host: ModelingMachineStateHost
) {
  // Call the previous binding's cleanup function, if this host already has one.
  bindings.get(host)?.()
  let disposed = false
  let unsubscribe = () => {}
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    // Cleanup from an older binding must not clear a replacement's state.
    if (bindings.get(host) !== dispose) return
    bindings.delete(host)
    batch(() => {
      host.modelingSend = () => {}
      host.modelingState = null
      host.selectionRanges = { graphSelections: [], otherSelections: [] }
    })
  }
  bindings.set(host, dispose)
  host.modelingSend = (event) => {
    if (!disposed) actor.send(event)
  }
  const publish = (snapshot: SnapshotFrom<typeof modelingMachine>) => {
    if (disposed) return
    batch(() => {
      host.modelingState = snapshot
      host.selectionRanges = snapshot.context.selectionRanges
    })
  }
  const subscription = actor.subscribe({ next: publish, complete: dispose })
  unsubscribe = () => subscription.unsubscribe()
  // An actor that has already finished can call complete during subscribe(), before
  // unsubscribe is assigned. Release that subscription once it is available.
  if (disposed) unsubscribe()
  else publish(actor.getSnapshot())
  return dispose
}
