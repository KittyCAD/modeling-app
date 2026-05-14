import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import {
  projectService,
  sketchSolveScenePluginsValueSpec,
} from '@src/registry/contracts/project'
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
  it('scopes project services to the project registry slot', () => {
    const registry = new Registry()
    const project = createProject()
    const { actor: settingsActor, unsubscribe } = createSettingsActor()

    registry.configure([projectExtension])

    expect(registry.optional(projectService)).toBeUndefined()

    registry.reconfigure(projectRegistrySlot, [
      createProjectRegistryItem({ project, settingsActor }),
    ])

    const service = registry.get(projectService)
    expect(service.project).toBe(project)
    expect(service.sketchSolveScenePlugins.value).toEqual(
      registry.get(sketchSolveScenePluginsValueSpec)
    )

    registry.reconfigure(projectRegistrySlot, [])

    expect(registry.optional(projectService)).toBeUndefined()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
