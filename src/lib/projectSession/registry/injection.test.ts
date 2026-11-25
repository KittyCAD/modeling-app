import '@src/lib/projectSession/next/testFeature'
import { posix } from '@chainner/node-path'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import type * as FsZdsModule from '@src/lib/fs-zds'
import {
  projectSessionService,
  type OpenProjectSession,
} from '@src/lib/projectSession/next/contract'
import { createProjectSessionExtension } from '@src/lib/projectSession/registry'
import {
  fileOperationsMountsFacet,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'
import { createFileOperationsExtension } from '@src/registry/extensions/fileOperations'
import { contribute, factory, provide, Registry, slot } from 'plankton'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async (importOriginal) => ({
  ...(await importOriginal<typeof FsZdsModule>()),
  default: (await import('@chainner/node-path')).posix,
}))

const project = {
  contents: { name: 'project', path: '/project', children: [] },
  metadata: { title: 'Project', readWriteAccess: true },
}

it('keeps the injected files alive and ignores changes to the globally selected provider', async () => {
  const registry = new Registry()
  const readFile = vi.fn(async () => new TextEncoder().encode('injected'))
  const writeFile = vi.fn(async () => {})
  const operations = { ...testFileOperations, readFile, writeFile }
  let opening: OpenProjectSession | undefined
  let closedAtDisposal: boolean | undefined
  const files = factory({
    create: () => ({
      exports: { operations },
      dispose: () => {
        closedAtDisposal = opening?.signal.aborted
      },
    }),
  })
  const consumer = createProjectSessionExtension(files)
  const providers = slot([provide(fileOperationsService, testFileOperations)])
  try {
    await registry.configure([files, consumer, providers])
    const service = registry.required(projectSessionService)
    opening = service.openProject(project)
    await expect(opening.files.read('main.kcl')).resolves.toBe('injected')
    await opening.files.write('main.kcl', 'edit')
    expect(readFile).toHaveBeenCalledWith('/project/main.kcl')
    expect(writeFile).toHaveBeenCalledWith('/project/main.kcl', 'edit')
    // Removing the explicit root retains files through the session dependency.
    await registry.configure([consumer, providers])
    await registry.replace(providers, [])
    expect(registry.optional(fileOperationsService)).toBeUndefined()
    expect(registry.required(projectSessionService)).toBe(service)
    await expect(opening.files.read('main.kcl')).resolves.toBe('injected')
    expect(opening.signal.aborted).toBe(false)
    expect(closedAtDisposal).toBeUndefined()
    await registry.configure([providers])
    expect(opening.signal.aborted).toBe(true)
    expect(closedAtDisposal).toBe(true)
  } finally {
    await registry.dispose()
  }
})

it('keeps injected file operations responsive to live mount replacement', async () => {
  const registry = new Registry()
  const paths = { ...noopfs.impl, ...posix }
  const disk = createMemoryFileSystem(paths)
  const memory = createMemoryFileSystem(paths)
  for (const [backing, content] of [
    [disk, 'disk'],
    [memory, 'memory'],
  ] as const) {
    await backing.mkdir('/project', { recursive: true })
    await backing.writeFile(
      '/project/main.kcl',
      new TextEncoder().encode(content)
    )
  }
  const mounted = createFileOperationsScheduler(memory)
  const mounts = slot()
  const consumer = createProjectSessionExtension(
    createFileOperationsExtension(disk)
  )
  try {
    await registry.configure([consumer, mounts])
    const service = registry.required(projectSessionService)
    const opening = service.openProject(project)
    await expect(opening.files.read('main.kcl')).resolves.toBe('disk')
    await registry.replace(mounts, [
      contribute(fileOperationsMountsFacet, () => ({
        root: '/project',
        operations: mounted.operations,
      })),
    ])
    expect(registry.required(projectSessionService)).toBe(service)
    await expect(opening.files.read('main.kcl')).resolves.toBe('memory')
    await registry.replace(mounts, [])
    await expect(opening.files.read('main.kcl')).resolves.toBe('disk')
  } finally {
    await registry.dispose()
    await mounted.dispose()
  }
})
