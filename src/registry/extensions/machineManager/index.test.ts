import { Registry } from '@kittycad/registry'
import { MachineManager } from '@src/lib/MachineManager'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import machineManagerRegistryItem from '@src/registry/extensions/machineManager'
import { afterEach, describe, expect, it } from 'vitest'

describe('machine manager extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides the machine manager class instance through the registry', () => {
    registry = new Registry()
    registry.configure([machineManagerRegistryItem])

    const machineManager = registry.get(machineManagerService).manager

    expect(machineManager).toBeInstanceOf(MachineManager)
    expect(machineManager.noMachinesReason()).toBe(
      'Machine API server was not discovered'
    )
  })
})
