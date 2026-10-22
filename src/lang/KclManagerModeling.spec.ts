import { signal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'
import { KclManager } from '@src/lang/KclManager'
import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import { File } from '@src/lib/projectSession'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { describe, expect, it, vi } from 'vitest'
import { waitFor } from 'xstate'

describe('editor-owned modeling actor', () => {
  it('starts once on demand and mirrors state and selections without React', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    try {
      await waitFor(app.settings.actor, (state) => state.matches('idle'))
      expect(kclManager.modelingActor).toBeUndefined()
      expect(kclManager.sendModelingEvent({ type: 'Cancel' })).toBe(false)
      const selections = vi.spyOn(kclManager, 'selectionRanges', 'set')
      const promise = kclManager.modelingActorPromise
      expect(kclManager.modelingActorPromise).toBe(promise)
      const actor = await promise
      expect(kclManager.modelingActor).toBe(actor)
      expect(actor.getSnapshot().status).toBe('active')
      expect(actor.getSnapshot().context.machineManager).toBe(
        app.machineManager
      )
      expect(actor.getSnapshot().context.store.defaultUnit).toBe(
        app.settings.get().modeling.defaultUnit
      )
      expect(kclManager.modelingStateSignal.value).toBe(actor.getSnapshot())
      expect(selections).toHaveBeenCalledWith(
        actor.getSnapshot().context.selectionRanges
      )
      expect(
        kclManager.sendModelingEvent({
          type: 'Set mouse state',
          data: { type: 'isDragging', on: null },
        })
      ).toBe(true)
      expect(kclManager.modelingState?.context.mouseState.type).toBe(
        'isDragging'
      )
      const selection = { graphSelections: [], otherSelections: [] }
      actor.send({
        type: 'Set selection',
        data: { selectionType: 'mirrorCodeMirrorSelections', selection },
      })
      expect(selections).toHaveBeenLastCalledWith(selection)
      expect(kclManager.modelingStateSignal.value).toBe(actor.getSnapshot())
      kclManager.close()
      expect(actor.getSnapshot().status).toBe('stopped')
      expect(kclManager.modelingStateSignal.value).toBeNull()
      expect(kclManager.sendModelingEvent({ type: 'Cancel' })).toBe(false)
      kclManager.close()
    } finally {
      app.dispose()
    }
  })

  it('keeps separate editors independent and stops only the closed editor', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    const other = new KclManager('other.kcl', '', kclManager.systemDeps)
    try {
      const [first, second] = await Promise.all([
        kclManager.modelingActorPromise,
        other.modelingActorPromise,
      ])
      expect(first).not.toBe(second)
      first.send({
        type: 'Set mouse state',
        data: { type: 'isDragging', on: null },
      })
      expect(kclManager.modelingState?.context.mouseState.type).toBe(
        'isDragging'
      )
      expect(other.modelingState?.context.mouseState.type).toBe('idle')
      kclManager.close()
      expect(first.getSnapshot().status).toBe('stopped')
      expect(second.getSnapshot().status).toBe('active')
      other.close()
      expect(second.getSnapshot().status).toBe('stopped')
    } finally {
      other.close()
      app.dispose()
    }
  })

  it('does not start an actor if the editor closes during initialization', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    try {
      const instance = await app.wasmPromise
      let resolveWasm!: (instance: ModuleType) => void
      kclManager.wasmInstancePromise = new Promise((resolve) => {
        resolveWasm = resolve
      })
      const pending = kclManager.modelingActorPromise
      kclManager.close()
      resolveWasm(instance)
      await expect(pending).rejects.toThrow('closed editor')
      expect(kclManager.modelingActor).toBeUndefined()
      expect(kclManager.modelingStateSignal.value).toBeNull()
    } finally {
      app.dispose()
    }
  })

  it('invalidates initialization from an earlier lifetime even if the editor reopens', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    try {
      const instance = await app.wasmPromise
      let resolveWasm!: (instance: ModuleType) => void
      kclManager.wasmInstancePromise = new Promise((resolve) => {
        resolveWasm = resolve
      })
      const pending = kclManager.modelingActorPromise
      const rejected = expect(pending).rejects.toThrow('closed editor')
      kclManager.close()
      const reopened = KclManager.fromFile(
        new File('next.kcl', kclManager.systemDeps.textFileIO),
        kclManager.systemDeps,
        kclManager,
        ''
      )
      resolveWasm(instance)
      await reopened
      await rejected
      expect(kclManager.modelingActor).toBeUndefined()
      const actor = await kclManager.modelingActorPromise
      expect(actor.getSnapshot().status).toBe('active')
      expect(actor.getSnapshot().context.fileName).toBe('next.kcl')
    } finally {
      app.dispose()
    }
  })

  it('replaces file-specific modeling state when the legacy editor changes files', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    try {
      const first = await kclManager.modelingActorPromise
      first.send({
        type: 'Set mouse state',
        data: { type: 'isDragging', on: null },
      })
      const next = new File('next.kcl', kclManager.systemDeps.textFileIO)
      await KclManager.fromFile(next, kclManager.systemDeps, kclManager, '', {
        shouldSyncRustOnOpen: false,
      })
      expect(first.getSnapshot().status).toBe('stopped')
      // Keep the outgoing actor readable until the replacement is ready.
      expect(kclManager.modelingActor).toBe(first)
      expect(kclManager.modelingStateSignal.value).toBeNull()
      const second = await kclManager.modelingActorPromise
      expect(second).not.toBe(first)
      expect(second.getSnapshot().context.fileName).toBe('next.kcl')
      expect(second.getSnapshot().context.mouseState.type).toBe('idle')
      expect(kclManager.modelingStateSignal.value).toBe(second.getSnapshot())

      await KclManager.fromFile(next, kclManager.systemDeps, kclManager, '', {
        shouldSyncRustOnOpen: false,
      })
      expect(await kclManager.modelingActorPromise).toBe(second)
      expect(second.getSnapshot().status).toBe('active')
    } finally {
      app.dispose()
    }
  })

  it('invalidates pending initialization when the legacy editor changes files without closing', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    try {
      const instance = await app.wasmPromise
      let resolveWasm!: (instance: ModuleType) => void
      kclManager.wasmInstancePromise = new Promise((resolve) => {
        resolveWasm = resolve
      })
      const pending = kclManager.modelingActorPromise
      const rejected = expect(pending).rejects.toThrow('closed editor')
      await KclManager.fromFile(
        new File('next.kcl', kclManager.systemDeps.textFileIO),
        kclManager.systemDeps,
        kclManager,
        '',
        { shouldSyncRustOnOpen: false }
      )
      resolveWasm(instance)
      await rejected
      expect(kclManager.modelingActor).toBeUndefined()
      const actor = await kclManager.modelingActorPromise
      expect(actor.getSnapshot().status).toBe('active')
      expect(actor.getSnapshot().context.fileName).toBe('next.kcl')
    } finally {
      app.dispose()
    }
  })

  it('resolves updated project metadata without a React ref or effect', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    const project = {
      path: '/test',
      name: 'test',
      children: [],
      metadata: null,
      default_file: 'main.kcl',
      directory_count: 0,
      kcl_file_count: 1,
      readWriteAccess: true,
    }
    const projectSignal = signal<Project | undefined>(project)
    kclManager.systemDeps.project = projectSignal
    try {
      const actor = await kclManager.modelingActorPromise
      expect(actor.getSnapshot().context.projectRef?.current).toBe(project)
      const updatedProject = { ...project, name: 'renamed' }
      projectSignal.value = updatedProject
      expect(actor.getSnapshot().context.projectRef?.current).toBe(
        updatedProject
      )
    } finally {
      app.dispose()
    }
  })

  it('creates a fresh actor when the legacy editor is reopened after close', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    try {
      const first = await kclManager.modelingActorPromise
      kclManager.close()
      await KclManager.fromFile(
        new File('next.kcl', kclManager.systemDeps.textFileIO),
        kclManager.systemDeps,
        kclManager,
        ''
      )
      const second = await kclManager.modelingActorPromise
      expect(first.getSnapshot().status).toBe('stopped')
      expect(second).not.toBe(first)
      expect(second.getSnapshot().status).toBe('active')
      expect(second.getSnapshot().context.fileName).toBe('next.kcl')
      expect(kclManager.modelingStateSignal.value).toBe(second.getSnapshot())
    } finally {
      app.dispose()
    }
  })
})
