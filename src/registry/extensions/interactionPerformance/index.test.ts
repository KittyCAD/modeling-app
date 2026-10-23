// @vitest-environment node

import { Registry } from '@kittycad/registry'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionPerformanceService } from '@src/registry/contracts/interactionPerformance'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('interaction performance extension', () => {
  let registry: Registry
  let service: InteractionPerformanceService

  beforeEach(async () => {
    vi.stubEnv('VITE_INTERACTION_PERFORMANCE', '1')
    vi.resetModules()
    const { default: interactionPerformanceExtension } = await import(
      '@src/registry/extensions/interactionPerformance'
    )
    const { interactionPerformanceService } = await import(
      '@src/registry/contracts/interactionPerformance'
    )
    if (!interactionPerformanceExtension) {
      throw new Error(
        'The measurement build must register its recorder service.'
      )
    }
    registry = new Registry()
    registry.configure([interactionPerformanceExtension])
    service = registry.get(interactionPerformanceService)
  })

  afterEach(() => {
    registry[Symbol.dispose]()
    vi.unstubAllEnvs()
  })

  it('omits the recorder service from normal builds', async () => {
    vi.stubEnv('VITE_INTERACTION_PERFORMANCE', undefined)
    vi.resetModules()
    const { default: interactionPerformanceExtension } = await import(
      '@src/registry/extensions/interactionPerformance'
    )
    const { interactionPerformanceService } = await import(
      '@src/registry/contracts/interactionPerformance'
    )
    registry.configure(
      interactionPerformanceExtension ? [interactionPerformanceExtension] : []
    )

    expect(registry.optional(interactionPerformanceService)).toBeUndefined()
  })

  it('provides empty registered measurements without browser resources', () => {
    const initial = service.snapshot()

    expect(typeof document).toBe('undefined')
    expect(initial.samples).toEqual([])
    expect(
      reportInteractions(initial, { [interactions.commandPaletteOpen.id]: 1 })
        .errors
    ).toEqual([
      `Expected 1 samples for ${interactions.commandPaletteOpen.id}; received 0.`,
    ])
    expect(service.stop()).toEqual(initial)
  })

  it('cancels pending starts without attaching browser resources later', async () => {
    const first = service.start()
    const second = service.start()
    const stopped = service.stop()

    await Promise.all([first, second])
    expect(service.snapshot()).toEqual(stopped)

    // Restart must also honor stop after the module has already loaded.
    const restarted = service.start()
    service.stop()
    await restarted
    expect(service.snapshot()).toEqual(stopped)
  })

  it('cancels loading on disposal and rejects subsequent activation', async () => {
    const pending = service.start()
    registry[Symbol.dispose]()

    await pending
    expect(service.snapshot().samples).toEqual([])
    await expect(service.start()).rejects.toThrow(
      'The interaction recording service is disposed.'
    )
  })
})
