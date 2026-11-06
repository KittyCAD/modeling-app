import {
  Registry,
  defineRegistryItem,
  provideService,
  type RegistryItem,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  userFeaturesService,
  type UserFeaturesRegistryService,
} from '@src/registry/contracts/userFeatures'
import { PROJECT_SHELL_FEATURE } from '@src/lib/projectSession/next/feature'
import { projectSession } from '@src/registry/contracts/projectSession'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import projectSessionNextExtension from '@src/lib/projectSession/registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const enabled = signal(true)
const featureFlags = defineRegistryItem({
  providesServices: [
    // This isolated graph only consumes the feature lookup, not the actor/UI facade.
    provideService(userFeaturesService, {
      has: (flag: string, fallback: boolean) =>
        flag === PROJECT_SHELL_FEATURE ? enabled.value : fallback,
    } as UserFeaturesRegistryService),
  ],
})
async function configure(registry: Registry, items: RegistryItem[]) {
  registry.configure([featureFlags, ...items])
  registry.get(userFeaturesService)
  await Promise.resolve()
}

// These tests need no filesystem backing or editor runtime.
describe('project session isolation', () => {
  beforeEach(() => {
    enabled.value = true
  })

  it('does not register the next session through the legacy extension', async () => {
    const registry = new Registry()
    try {
      await configure(registry, [projectSessionRegistryItem])
      expect(registry.optional(projectSession)).toBeDefined()
      expect(registry.optional(projectSessionService)).toBeUndefined()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  it.each([false, true])(
    'registers the next session only with the project-shell flag: %s',
    async (granted) => {
      enabled.value = granted
      const registry = new Registry()
      try {
        await configure(registry, [
          projectSessionRegistryItem,
          projectSessionNextExtension,
        ])
        expect(registry.optional(projectSession)).toBeDefined()
        expect(registry.optional(projectSessionService) !== undefined).toBe(
          granted
        )
      } finally {
        registry[Symbol.dispose]()
      }
    }
  )

  it('leaves the legacy session and library selection untouched', async () => {
    const registry = new Registry()
    try {
      await configure(registry, [
        projectSessionRegistryItem,
        projectSessionNextExtension,
      ])
      const legacy = registry.get(projectSession)
      const next = registry.get(projectSessionService)
      legacy.setCurrentProjectLibraryId('legacy-library')
      const observed = vi.fn()
      const stop = legacy.project.subscribe(observed)
      observed.mockClear()
      const owner = next.openProject({
        contents: { name: 'new', path: '/new', children: [] },
        metadata: { title: 'New', readWriteAccess: true },
      })
      expect(legacy.currentProjectLibraryId.value).toBe('legacy-library')
      expect(observed).not.toHaveBeenCalled()
      legacy.clearProject()
      expect(next.currentSession.value).toBe(owner)
      next.closeProject()
      expect(legacy.currentProjectLibraryId.value).toBe('legacy-library')
      stop()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  it('clears the next session selection when its registry is disposed', async () => {
    const registry = new Registry()
    await configure(registry, [projectSessionNextExtension])
    const next = registry.get(projectSessionService)
    const owner = next.openProject({
      contents: { name: 'new', path: '/new', children: [] },
      metadata: { title: 'New', readWriteAccess: true },
    })
    registry[Symbol.dispose]()
    expect(owner.project.value.contents.path).toBe('/new')
    expect(next.currentSession.value).toBeUndefined()
    expect(owner.signal.aborted).toBe(true)
  })
})

it('removes the session and closes its resources when the grant is revoked', async () => {
  const registry = new Registry()
  try {
    await configure(registry, [projectSessionNextExtension])
    const owner = registry.get(projectSessionService).openProject({
      contents: { name: 'test', path: '/test', children: [] },
      metadata: { title: 'Test', readWriteAccess: true },
    })
    enabled.value = false
    expect(registry.optional(projectSessionService)).toBeUndefined()
    expect(owner.signal.aborted).toBe(true)
    enabled.value = true
    expect(registry.optional(projectSessionService)).toBeDefined()
  } finally {
    registry[Symbol.dispose]()
  }
})
it('defaults to no session when feature flags are unavailable', async () => {
  const registry = new Registry()
  try {
    registry.configure([projectSessionNextExtension])
    await Promise.resolve()
    expect(registry.optional(projectSessionService)).toBeUndefined()
  } finally {
    registry[Symbol.dispose]()
  }
})
