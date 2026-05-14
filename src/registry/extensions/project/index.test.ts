import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { projectService } from '@src/registry/contracts/project'
import { describe, expect, it, vi } from 'vitest'
import projectExtension, {
  createProjectRegistryItem,
  projectRegistrySlot,
} from '.'

function createSettingsActor() {
  const settings = {} as SettingsType
  const unsubscribe = vi.fn()
  const actor = {
    getSnapshot: () => ({ context: settings }),
    subscribe: vi.fn(() => ({ unsubscribe })),
  } as unknown as SettingsActorType

  return { actor, unsubscribe }
}

function createProject(): ZDSProject {
  return {
    path: '/tmp/project',
    executingEditor: signal(null),
  } as unknown as ZDSProject
}

describe('project extension', () => {
  it('scopes project services to the project registry slot', async () => {
    const registry = new Registry()
    const project = createProject()
    const { actor: settingsActor, unsubscribe } = createSettingsActor()

    registry.configure([projectExtension])

    expect(registry.optional(projectService)).toBeUndefined()

    registry.reconfigure(projectRegistrySlot, [
      createProjectRegistryItem({ project, settingsActor }),
    ])

    expect(registry.get(projectService).project).toBe(project)

    registry.reconfigure(projectRegistrySlot, [])
    await Promise.resolve()

    expect(registry.optional(projectService)).toBeUndefined()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
