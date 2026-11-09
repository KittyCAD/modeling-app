import { MachineManager } from '@src/lib/MachineManager'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import machineManagerRegistryItem from '@src/registry/extensions/machineManager'
import { Registry } from 'plankton'
import { afterEach, describe, expect, it } from 'vitest'

describe('machine manager extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
  })
  it('provides the machine manager class instance through the registry', async () => {
    registry = new Registry()
    await registry.configure([machineManagerRegistryItem])
    const machineManager = registry.required(machineManagerService).manager
    expect(machineManager).toBeInstanceOf(MachineManager)
    expect(machineManager.noMachinesReason()).toBe(
      'Machine API server was not discovered'
    )
  })
})
