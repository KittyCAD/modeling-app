import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { AuthService } from '@src/contracts/auth'
import { authService } from '@src/contracts/auth'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { layoutAreasValueSpec, layoutService } from '@src/contracts/layout'
import type {
  ProjectSession,
  ProjectSessionService,
} from '@src/contracts/projectSession'
import { projectSessionService } from '@src/contracts/projectSession'
import type { LayoutService } from '@src/contracts/layout'
import { ZOOKEEPER_AREA_ID, zookeeperService } from '@src/contracts/zookeeper'
import projectHistoryFeature from '@src/features/projectHistory'
import zookeeperFeature from '@src/features/zookeeper'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

/**
 * The registry item, built by the real container.
 *
 * Worth an integration test rather than only unit ones, because the two mistakes
 * the container forbids are both invisible to a unit test: resolving a service
 * inside the factory body, and starting an effect that reads a value spec
 * inline. Both throw when the graph is flattened, which is what `configure` does
 * here.
 */
function harness(
  options: { token?: string | null; session?: ProjectSession | null } = {}
) {
  const token = signal<string | null>(options.token ?? 'tok-1')
  const current = signal<ProjectSession | null>(options.session ?? null)
  const toggled: string[] = []

  const auth = {
    token: computed(() => token.value),
    // The rest of the surface is not reached by this feature.
  } as unknown as AuthService

  const sessions = {
    current: computed(() => current.value),
    // Never announced in these tests; present so the real consumers can
    // subscribe without the stub throwing.
    onProjectGone: () => () => {},
  } as unknown as ProjectSessionService

  // Real ones: transcripts are written on turn boundaries, and a stub would make
  // those writes silently do nothing.
  const fileSystem = createFakeFileSystem()
  const queue = createFsOperationQueue()

  const layout = {
    isAreaOpen: () => computed(() => false),
    toggleArea: (areaId: string) => toggled.push(areaId),
  } as unknown as LayoutService

  const registry = new Registry()
  registry.configure([
    zookeeperFeature,
    /*
     * The real one, not a stub. The applied-change log and the project's undo
     * stack are services this feature requires, and composing them here is what
     * proves the two features fit together — a hand-rolled pair would pass while
     * the app failed to start.
     */
    projectHistoryFeature,
    defineRegistryItem({
      id: 'test.stubs',
      providesServices: [
        provideService(authService, auth),
        provideService(projectSessionService, sessions),
        provideService(fileSystemService, fileSystem),
        provideService(fsOperationQueueService, queue),
        provideService(layoutService, layout),
      ],
      provides: [],
    }),
  ])

  return { registry, token, current, toggled }
}

describe('zookeeper feature', () => {
  it('configures without resolving a service too early', () => {
    // The whole assertion: flattening the graph does not throw. Resolving a
    // service in a factory body would fail right here.
    expect(() => harness()).not.toThrow()
  })

  it('contributes a panel on its own area id', () => {
    const { registry } = harness()

    const areas = registry.get(layoutAreasValueSpec)
    const area = areas.find((each) => each.id === ZOOKEEPER_AREA_ID)

    expect(area).toBeDefined()
    expect(area?.title).toBe('Zookeeper')
    expect(area?.icon).toBe('elephant')
  })

  it('exposes the service', () => {
    const { registry } = harness()

    expect(registry.get(zookeeperService)).toBeDefined()
  })

  it('contributes a toggle and a new-conversation command', () => {
    const { registry } = harness()

    const ids = registry.get(commandsValueSpec).map((command) => command.id)

    expect(ids).toContain('zookeeper.toggle')
    expect(ids).toContain('zookeeper.newConversation')
  })

  it('toggles its own area from the command', () => {
    const { registry, toggled } = harness()

    const toggle = registry
      .get(commandsValueSpec)
      .find((command) => command.id === 'zookeeper.toggle')
    void toggle?.run()

    expect(toggled).toEqual([ZOOKEEPER_AREA_ID])
  })

  /**
   * Reading the service is what builds it, so this is also the assertion that
   * building it late — after flattening — works at all.
   *
   * The reason it gives is about the missing *project*, not a missing service
   * URL: the URL is derived from the API host, so a build that configured
   * nothing still has one. Asserted here rather than only in
   * `serviceUrl.test.ts` because the wiring is the part that regressed — the
   * feature read the override variable directly, and every developer without it
   * met a panel claiming the build had no Zookeeper in it.
   *
   * Which reason wins over which is the service's own business, tested in
   * `createZookeeperService.test.ts` where the URL can be injected.
   */
  it('builds the service lazily and reports why it is unavailable', () => {
    const { registry } = harness()

    const zookeeper = registry.get(zookeeperService)

    expect(zookeeper.available.value).toBe(false)
    expect(zookeeper.unavailableReason.value).toMatch(/open a project/i)
    expect(zookeeper.unavailableReason.value).not.toMatch(/no zookeeper/i)
  })

  it('refuses to open a conversation while unavailable', () => {
    const { registry } = harness({ token: null })

    expect(registry.get(zookeeperService).open()).toBeNull()
    expect(registry.get(zookeeperService).conversations.value.size).toBe(0)
  })
})
