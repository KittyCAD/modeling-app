import { describe, expect, it } from 'vitest'
import { createApp } from '@src/app/createApp'
import {
  statusBarItemsValueSpec,
  topBarItemsValueSpec,
} from '@src/contracts/shell'

/**
 * The whole feature graph, flattened once.
 *
 * This is the cheapest guard there is against the two mistakes the container
 * forbids — resolving a service in a factory body, and starting an effect that
 * reads a value spec inline — because both throw during flattening and neither
 * is visible to a unit test.
 *
 * It exists because that is exactly how a broken build shipped: the credits
 * feature resolved `authService` eagerly, every one of its unit tests passed,
 * and the app threw on start. A per-feature integration spec catches it only for
 * features that have one; this catches it for all of them, including features
 * nobody has written yet.
 *
 * Reading a value spec is the part that matters. `configure` is lazy, so
 * building the app without reading anything from it would prove nothing.
 */

/**
 * Let the features' deferred work run, then tear down.
 *
 * Several features defer their startup into `queueMicrotask` — the house
 * workaround for the flattening rules. Disposing the registry in the same tick
 * leaves those callbacks to run against a torn-down container, which throws
 * `MissingServiceError` from a microtask with no test still on the stack.
 * Draining first means they run while their services exist.
 */
async function settle() {
  for (let turn = 0; turn < 3; turn += 1) await Promise.resolve()
}

describe('the application graph', () => {
  it('flattens without resolving a service too early', async () => {
    const app = createApp()

    try {
      expect(() => app.registry.get(topBarItemsValueSpec)).not.toThrow()
      expect(() => app.registry.get(statusBarItemsValueSpec)).not.toThrow()
    } finally {
      await settle()
      app.dispose()
    }
  })

  it('installs the discovered features rather than an empty graph', async () => {
    const app = createApp()

    try {
      // A guard on the guard: if discovery silently found nothing, the assertion
      // above would pass against a graph with no features in it at all.
      expect(app.registry.get(topBarItemsValueSpec).length).toBeGreaterThan(0)
    } finally {
      await settle()
      app.dispose()
    }
  })
})
