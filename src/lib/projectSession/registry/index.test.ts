import { Registry } from '@kittycad/registry'
import { projectSession } from '@src/registry/contracts/projectSession'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import projectSessionNextExtension from '@src/lib/projectSession/registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ enabled: true }))
vi.mock('@src/routes/utils', () => ({
  get IS_STAGING_OR_DEBUG() {
    return environment.enabled
  },
}))

// These tests need no filesystem backing or editor runtime.
describe('project session isolation', () => {
  beforeEach(() => {
    environment.enabled = true
  })

  it('does not register the next session through the legacy extension', () => {
    const registry = new Registry()
    try {
      registry.configure([projectSessionRegistryItem])
      expect(registry.optional(projectSession)).toBeDefined()
      expect(registry.optional(projectSessionService)).toBeUndefined()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  it.each([false, true])(
    'registers the next session only in dev/staging: %s',
    (enabled) => {
      environment.enabled = enabled
      const registry = new Registry()
      try {
        registry.configure([
          projectSessionRegistryItem,
          projectSessionNextExtension,
        ])
        expect(registry.optional(projectSession)).toBeDefined()
        expect(registry.optional(projectSessionService) !== undefined).toBe(
          enabled
        )
      } finally {
        registry[Symbol.dispose]()
      }
    }
  )

  it('leaves the legacy session and library selection untouched', () => {
    const registry = new Registry()
    try {
      registry.configure([
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

  it('clears the next session selection when its registry is disposed', () => {
    const registry = new Registry()
    registry.configure([projectSessionNextExtension])
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
