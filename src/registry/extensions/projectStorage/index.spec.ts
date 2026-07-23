import { Registry } from '@kittycad/registry'
import type { Project } from '@src/lib/project'
import {
  NO_PROJECT_DIRECTORY,
  type SystemIOActor,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import { projectStorageService } from '@src/registry/contracts/projectStorage'
import projectStorageRegistryItem from '@src/registry/extensions/projectStorage'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('project storage extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('projects system IO state and normalized file mutations', () => {
    registry = new Registry()
    registry.configure([projectStorageRegistryItem])
    const service = registry.get(projectStorageService)
    const actor = createFakeSystemIOActor()

    expect(service.projectDirectoryPath.value).toBe(NO_PROJECT_DIRECTORY)

    service.connectActor(actor)

    expect(service.projectDirectoryPath.value).toBe('/projects')
    expect(service.folders.value?.[0]?.name).toBe('demo')
    expect(service.lastOperation.value).toBe('idle')

    actor.setContext({
      projectDirectoryPath: '/other-projects',
      folders: [],
      lastOperation: 'read folders from project directory',
    })

    expect(service.projectDirectoryPath.value).toBe('/other-projects')
    expect(service.folders.value).toEqual([])
    expect(service.lastOperation.value).toBe(
      'read folders from project directory'
    )

    service.refreshProjectDirectory()
    expect(actor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })

    const mutation = service.recordMutation({
      kind: 'renamed',
      previousPath: 'C:\\projects\\demo\\old.kcl',
      path: 'C:\\projects\\demo\\main.kcl',
      projectPath: 'C:\\projects\\demo',
      source: 'test',
    })

    expect(mutation).toMatchObject({
      kind: 'renamed',
      previousPath: 'C:/projects/demo/old.kcl',
      path: 'C:/projects/demo/main.kcl',
      projectPath: 'C:/projects/demo',
      relativePath: 'main.kcl',
      source: 'test',
    })
    expect(service.lastMutation.value).toBe(mutation)
  })
})

function createFakeSystemIOActor() {
  let context = {
    projectDirectoryPath: '/projects',
    folders: [{ name: 'demo' } as Project],
    lastOperation: 'idle',
  }
  const listeners = new Set<() => void>()
  const actor = {
    getSnapshot: () => ({ context }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return {
        unsubscribe: () => listeners.delete(listener),
      }
    },
    send: vi.fn(),
    setContext: (nextContext: typeof context) => {
      context = nextContext
      for (const listener of listeners) {
        listener()
      }
    },
  }

  return actor as unknown as SystemIOActor & {
    setContext: (nextContext: typeof context) => void
    send: ReturnType<typeof vi.fn>
  }
}
