import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import type {
  ProjectSessionService,
  ExecutingEditor,
} from '@src/registry/contracts/projectSession'
import { projectSession } from '@src/registry/contracts/projectSession'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import executionIndicator from '.'
import { EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID } from './constants'

function createProjectSession(
  isExecuting = signal(false),
  executionElapsedMs = signal<number | null>(null)
): ProjectSessionService {
  const project = signal<ZDSProject | undefined>(undefined)
  const libraryId = signal<string | undefined>(undefined)
  return {
    editorChanged: vi.fn(),
    writeThumbnail: vi.fn(async () => {}),
    refreshProject: vi.fn(async () => undefined),
    openFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    textFileIO: {
      read: vi.fn(async () => ''),
      write: vi.fn(async () => {}),
      watch: vi.fn(),
      unwatch: vi.fn(),
    },
    project,
    currentProjectLibraryId: libraryId,
    getProject: () => project.value,
    setProject: (next) => {
      project.value = next
    },
    clearProject: () => {
      project.value = undefined
    },
    getCurrentProjectLibraryId: () => libraryId.value,
    setCurrentProjectLibraryId: (next) => {
      libraryId.value = next
    },
    executingEditor: signal({
      code: signal(''),
      hasEditsSinceLastExecution: signal(false),
      isExecuting,
      executionElapsedMs,
      selectionStatusLabel: signal('No selection'),
      showExperimentalFeaturesStatusBarItem: signal(true),
      getPendingCommandCount: vi.fn(() => 0),
      executeCode: vi.fn(),
      updateCode: vi.fn(),
    }),
  }
}

describe('executionIndicator', () => {
  it('contributes the execution status item while the engine is executing', () => {
    const isExecuting = signal(false)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-project-session',
        providesServices: [
          provideService(projectSession, createProjectSession(isExecuting)),
        ],
      }),
      executionIndicator,
    ])

    expect(registry.get(statusBarLocalItemsValueSpec)).toEqual([])

    isExecuting.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID])
  })

  it('releases the old editor status when switching or closing editors', () => {
    const oldExecuting = signal(true)
    const oldEditor = createProjectSession(oldExecuting).executingEditor.value
    const nextEditor = createProjectSession(signal(false), signal(12))
      .executingEditor.value
    const current = signal<ExecutingEditor | undefined>(oldEditor)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        providesServices: [
          provideService(projectSession, {
            ...createProjectSession(),
            executingEditor: current,
          }),
        ],
      }),
      executionIndicator,
    ])
    try {
      expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
        { icon: 'loading' },
      ])
      current.value = nextEditor
      expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
        { icon: 'checkmark' },
      ])
      oldExecuting.value = false
      oldExecuting.value = true
      expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
        { icon: 'checkmark' },
      ])
      current.value = undefined
      expect(registry.get(statusBarLocalItemsValueSpec)).toEqual([])
    } finally {
      registry[Symbol.dispose]()
    }
  })

  it('keeps a checkmark after execution finishes and restores the spinner on the next run', () => {
    const isExecuting = signal(true)
    const executionElapsedMs = signal<number | null>(0)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-project-session',
        providesServices: [
          provideService(
            projectSession,
            createProjectSession(isExecuting, executionElapsedMs)
          ),
        ],
      }),
      executionIndicator,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID])

    executionElapsedMs.value = 1234
    isExecuting.value = false

    expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
      {
        id: EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID,
        icon: 'checkmark',
        label: 'Engine execution finished',
      },
    ])

    isExecuting.value = true
    executionElapsedMs.value = 0

    expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
      { icon: 'loading', label: 'Engine executing' },
    ])
  })

  it('shows a completed execution even when it took zero milliseconds', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-project-session',
        providesServices: [
          provideService(
            projectSession,
            createProjectSession(signal(false), signal(0))
          ),
        ],
      }),
      executionIndicator,
    ])

    expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
      { icon: 'checkmark' },
    ])
  })
})
