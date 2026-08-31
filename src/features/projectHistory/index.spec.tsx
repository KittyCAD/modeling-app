import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  changeHistoryService,
  projectHistoryService,
} from '@src/contracts/projectHistory'
import type {
  ProjectSession,
  ProjectSessionService,
} from '@src/contracts/projectSession'
import { projectSessionService } from '@src/contracts/projectSession'
import projectHistoryFeature from '@src/features/projectHistory'

/**
 * The registry item, built by the real container.
 *
 * Worth an integration test rather than only unit ones, because the two mistakes
 * the container forbids are both invisible to a unit test: resolving a service
 * inside the factory body, and starting an effect that reads a value spec inline.
 * Both throw when the graph is flattened, which is what `configure` does here —
 * and this feature does start an effect, to follow open buffers.
 */
function harness(options: { session?: ProjectSession | null } = {}) {
  const current = signal<ProjectSession | null>(options.session ?? null)

  const sessions = {
    current: computed(() => current.value),
  } as unknown as ProjectSessionService

  const registry = new Registry()
  registry.configure([
    projectHistoryFeature,
    defineRegistryItem({
      id: 'test.stubs',
      providesServices: [provideService(projectSessionService, sessions)],
      provides: [],
    }),
  ])

  return { registry, current }
}

describe('projectHistory feature', () => {
  it('configures without resolving a service too early', () => {
    expect(() => harness()).not.toThrow()
  })

  /** Both, because the log is shared and the stack is an index over it. */
  it('provides the change log and the action stack', () => {
    const { registry } = harness()

    expect(registry.get(changeHistoryService)).toBeDefined()
    expect(registry.get(projectHistoryService)).toBeDefined()
  })

  it('contributes a project-wide undo command', () => {
    const { registry } = harness()

    const command = registry
      .get(commandsValueSpec)
      .find((each) => each.id === 'project.undoAction')

    expect(command).toBeDefined()
    // Named for what it undoes, so it cannot be mistaken for the editing chord.
    expect(command?.title).toBe('Undo last project action')
  })

  it('disables the command while there is nothing to undo', () => {
    const { registry } = harness()

    const command = registry
      .get(commandsValueSpec)
      .find((each) => each.id === 'project.undoAction')

    expect(command?.enabled?.value).toBe(false)
  })

  it('runs the command harmlessly when there is nothing to undo', () => {
    const { registry } = harness()

    const command = registry
      .get(commandsValueSpec)
      .find((each) => each.id === 'project.undoAction')

    expect(() => command?.run?.()).not.toThrow()
  })
})
