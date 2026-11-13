import type { ZDSProject } from '@src/lib/projectSession'
import { File } from '@src/lib/projectSession/file'
import {
  type FileOperationsRegistryService,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import {
  extension as defineExtension,
  provide,
  Registry,
  type Extension,
} from 'plankton'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createSession = async (text: string) => {
  const readFile = vi.fn(async () => new TextEncoder().encode(text))
  const writeFile = vi.fn(async (_path: string, _content: string) => {})
  const operations = {
    readFile,
    writeFile,
  } as unknown as FileOperationsRegistryService
  const registry = new Registry()
  await registry.configure([
    projectSessionRegistryItem,
    defineExtension({
      create: () => ({
        items: [provide(fileOperationsService, operations)],
      }),
    }) satisfies Extension,
  ])
  const session = registry.required(projectSession)
  const file = new File('/project/main.kcl', session.textFileIO, 7)
  return { registry, file, readFile, writeFile }
}

describe('project session extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
  })
  it('provides the opened project session through registry signals', async () => {
    registry = new Registry()
    await registry.configure([projectSessionRegistryItem])
    const session = registry.required(projectSession)
    const project = { name: 'bracket' } as ZDSProject

    expect(session.getProject()).toBeUndefined()
    expect(session.project.value).toBeUndefined()

    session.setProject(project)

    expect(session.getProject()).toBe(project)
    expect(session.project.value).toBe(project)

    session.clearProject()

    expect(session.getProject()).toBeUndefined()
    expect(session.project.value).toBeUndefined()
  })
  it('tracks the current project library id', async () => {
    registry = new Registry()
    await registry.configure([projectSessionRegistryItem])
    const session = registry.required(projectSession)
    expect(session.getCurrentProjectLibraryId()).toBeUndefined()
    expect(session.currentProjectLibraryId.value).toBeUndefined()

    session.setCurrentProjectLibraryId('directory:projects')

    expect(session.getCurrentProjectLibraryId()).toBe('directory:projects')
    expect(session.currentProjectLibraryId.value).toBe('directory:projects')

    session.setCurrentProjectLibraryId(undefined)

    expect(session.getCurrentProjectLibraryId()).toBeUndefined()
    expect(session.currentProjectLibraryId.value).toBeUndefined()
  })

  it('keeps file reads and writes isolated between registries without an editor', async () => {
    const first = await createSession('first: \u03c0')
    const second = await createSession('second')
    try {
      await expect(first.file.asRustApiFile()).resolves.toEqual({
        id: 7,
        path: '/project/main.kcl',
        text: 'first: \u03c0',
      })
      await expect(second.file.read()).resolves.toBe('second')
      await first.file.write('first edit')
      await second.file.write('second edit')
      expect(first.writeFile).toHaveBeenCalledExactlyOnceWith(
        '/project/main.kcl',
        'first edit'
      )
      expect(second.writeFile).toHaveBeenCalledExactlyOnceWith(
        '/project/main.kcl',
        'second edit'
      )
      await second.registry.dispose()
      // Web sessions have no platform watcher, but keep the same file lifecycle.
      first.file.watch()
      expect(first.file.watching).toBe(true)
      first.file.unwatch()
      expect(first.file.watching).toBe(false)
      await expect(first.file.read()).resolves.toBe('first: \u03c0')
      const failure = new Error('read denied')
      first.readFile.mockRejectedValueOnce(failure)
      await expect(first.file.read()).rejects.toBe(failure)
      first.writeFile.mockRejectedValueOnce(failure)
      await expect(first.file.write('failed edit')).rejects.toBe(failure)
    } finally {
      await second.registry.dispose()
      await first.registry.dispose()
    }
  })
  it('binds desktop watch hooks to each registry instead of global File state', async () => {
    const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron')
    const firstWatcher = { watchFileOn: vi.fn(), watchFileOff: vi.fn() }
    const secondWatcher = { watchFileOn: vi.fn(), watchFileOff: vi.fn() }
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: firstWatcher,
    })
    const first = await createSession('first')
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: secondWatcher,
    })
    const second = await createSession('second')
    try {
      first.file.watch()
      second.file.watch()
      expect(firstWatcher.watchFileOn).toHaveBeenCalledExactlyOnceWith(
        '/project/main.kcl',
        expect.any(String),
        expect.any(Function)
      )
      expect(secondWatcher.watchFileOn).toHaveBeenCalledExactlyOnceWith(
        '/project/main.kcl',
        expect.any(String),
        expect.any(Function)
      )
      first.file.unwatch()
      expect(firstWatcher.watchFileOff).toHaveBeenCalledExactlyOnceWith(
        '/project/main.kcl',
        firstWatcher.watchFileOn.mock.calls[0][1]
      )
      expect(secondWatcher.watchFileOff).not.toHaveBeenCalled()
      second.file.unwatch()
      expect(secondWatcher.watchFileOff).toHaveBeenCalledOnce()
    } finally {
      first.file.unwatch()
      second.file.unwatch()
      await first.registry.dispose()
      await second.registry.dispose()
      if (originalElectron)
        Object.defineProperty(window, 'electron', originalElectron)
      else Reflect.deleteProperty(window, 'electron')
    }
  })
})
