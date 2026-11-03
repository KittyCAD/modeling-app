import { Registry } from '@kittycad/registry'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { createFileOperationsExtension } from '@src/registry/extensions/fileOperations'
import projectSessionExtension from '@src/registry/extensions/projectSession'
import { createTestWasmRegistryItem } from '@src/unitTestUtils'
import { expect, it } from 'vitest'
import systemIO from '.'

it('owns one filesystem actor without an App and stops it on disposal', async () => {
  const registry = new Registry()
  registry.configure([
    createTestWasmRegistryItem(),
    createFileOperationsExtension(nodeFileSystem.impl),
    projectSessionExtension,
    systemIO,
  ])
  const actor = registry.get(systemIOService).actor
  try {
    expect(registry.get(systemIOService).actor).toBe(actor)
    expect(actor.getSnapshot().status).toBe('active')
    const host = actor.getSnapshot().context.host
    expect(host.fileOperations).toBe(registry.get(fileOperationsService))
    expect(host.systemIOActor).toBe(actor)
    expect(host.project).toBe(registry.get(projectSession).getProject())
  } finally {
    await registry.disposeAsync()
  }
  expect(actor.getSnapshot().status).toBe('stopped')
})
