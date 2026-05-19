import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import {
  projectService,
  sketchSolveScenePluginsValueSpec,
} from '@src/registry/contracts/project'
import modeSketch from '@src/registry/plugins/modeSketch'
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

  return { actor }
}

function createProject(): ZDSProject {
  return {
    path: '/tmp/project',
    executingEditor: signal(null),
  } as unknown as ZDSProject
}

describe('project extension integration', () => {
  it('can resolve project-owned sketch solve plugins without a service cycle', () => {
    const registry = new Registry()
    const project = createProject()
    const { actor: settingsActor } = createSettingsActor()

    registry.configure([projectExtension, modeSketch])

    registry.reconfigure(projectRegistrySlot, [
      createProjectRegistryItem({ project, settingsActor }),
    ])

    const service = registry.get(projectService)
    expect(registry.get(sketchSolveScenePluginsValueSpec)).toEqual([])
    expect(service.sketchSolveScenePlugins.value).toEqual([])
  })
})
