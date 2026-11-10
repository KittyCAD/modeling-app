import { posix } from '@chainner/node-path'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { cloneProjectIntoLocalDirectory } from '@src/lib/projectLibraries/operations'
import { getProjectIdFromProjectTomlContents } from '@src/lib/projectTomlMetadata'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))
vi.mock('@src/lib/desktop', () => ({
  isPathNotFoundError: () => false,
  getProjectInfo: async (_operations: unknown, path: string) => ({
    path,
    default_file: posix.join(path, 'main.kcl'),
  }),
}))

const sourceId = '12902000-0000-4000-8000-000000000091'
const toml = `title = "Original"
default_file = "main.kcl"
[settings.meta]
id = "${sourceId}"
[cloud."dev.zoo.dev"]
project_id = "old-cloud-project"
[zookeeper."dev.zoo.dev"]
conversation_ids = ["old-conversation"]
[custom]
keep = "yes"
`
const encoder = new TextEncoder()

async function setup() {
  const memory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
  await memory.mkdir('/source/original', { recursive: true })
  await memory.mkdir('/destination', { recursive: true })
  await memory.writeFile('/source/original/project.toml', encoder.encode(toml))
  await memory.writeFile(
    '/source/original/main.kcl',
    encoder.encode('captured')
  )
  const scheduler = createFileOperationsScheduler(memory)
  return { memory, scheduler }
}

describe('independent project clones', () => {
  it('preserves generated file bytes, never overwrites a collision, and resets only destination identity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({ maxLength: 128 }), { maxLength: 4 }),
        async (files) => {
          const { memory, scheduler } = await setup()
          try {
            await memory.mkdir('/destination/original', { recursive: true })
            await memory.writeFile(
              '/destination/original/keep.bin',
              new Uint8Array([0, 255])
            )
            for (const [index, bytes] of files.entries())
              await memory.writeFile(
                `/source/original/data-${index}.bin`,
                bytes
              )
            const result = await cloneProjectIntoLocalDirectory({
              fileOperations: scheduler.operations,
              projectDirectoryPath: '/destination',
              sourceProjectPath: '/source/original',
              sourceProjectName: 'original',
              requestedProjectTitle: 'New project',
              wasmInstancePromise: {} as ModuleType,
            })
            expect(result.localProjectPath).not.toBe('/destination/original')
            expect(
              await memory.readFile('/destination/original/keep.bin')
            ).toEqual(new Uint8Array([0, 255]))
            for (const [index, bytes] of files.entries()) {
              expect(
                await memory.readFile(
                  `${result.localProjectPath}/data-${index}.bin`
                )
              ).toEqual(bytes)
              expect(
                await memory.readFile(`/source/original/data-${index}.bin`)
              ).toEqual(bytes)
            }
            const clonedToml = await memory.readFile(
              `${result.localProjectPath}/project.toml`,
              'utf8'
            )
            expect(getProjectIdFromProjectTomlContents(clonedToml)).toBeTruthy()
            expect(getProjectIdFromProjectTomlContents(clonedToml)).not.toBe(
              sourceId
            )
            expect(clonedToml).toContain('title = "New project-1"')
            expect(clonedToml).toContain('keep = "yes"')
            expect(clonedToml).not.toContain('old-cloud-project')
            expect(clonedToml).not.toContain('old-conversation')
            expect(
              await memory.readFile('/source/original/project.toml', 'utf8')
            ).toBe(toml)
          } finally {
            await scheduler.dispose()
          }
        }
      )
    )
  })

  it('rejects destination libraries nested anywhere inside the source project', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('nested', 'parts', 'library'), {
          maxLength: 4,
        }),
        async (segments) => {
          const { memory, scheduler } = await setup()
          try {
            const before = await memory.readdir('/source/original')
            await expect(
              cloneProjectIntoLocalDirectory({
                fileOperations: scheduler.operations,
                projectDirectoryPath: posix.join(
                  '/source/original',
                  ...segments
                ),
                sourceProjectPath: '/source/original',
                sourceProjectName: 'original',
                wasmInstancePromise: {} as ModuleType,
              })
            ).rejects.toThrow('destination must be outside')
            expect(await memory.readdir('/source/original')).toEqual(before)
            expect(
              await memory.readFile('/source/original/project.toml', 'utf8')
            ).toBe(toml)
          } finally {
            await scheduler.dispose()
          }
        }
      )
    )
  })

  it.each(['/outside/main.kcl', '/source', '/source/original'])(
    'rejects an entrypoint outside the source files: %s',
    async (defaultFile) => {
      const { memory, scheduler } = await setup()
      try {
        await expect(
          cloneProjectIntoLocalDirectory({
            fileOperations: scheduler.operations,
            projectDirectoryPath: '/destination',
            sourceProjectPath: '/source/original',
            sourceProjectName: 'original',
            defaultFile,
            wasmInstancePromise: {} as ModuleType,
          })
        ).rejects.toThrow('entrypoint must be inside')
        expect(await memory.readdir('/destination')).toEqual([])
        expect(
          await memory.readFile('/source/original/project.toml', 'utf8')
        ).toBe(toml)
      } finally {
        await scheduler.dispose()
      }
    }
  )

  it.each([false, true])(
    'retains source edits made during a seven-second destination write (failure: %s)',
    async (fail) => {
      const { memory, scheduler } = await setup()
      const started = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const operations = {
        ...scheduler.operations,
        writeFile: async (
          path: string,
          contents: Parameters<typeof scheduler.operations.writeFile>[1]
        ) => {
          if (path.startsWith('/destination/')) {
            started.resolve(undefined)
            await release.promise
            if (fail)
              return Promise.reject(new Error('Destination unavailable'))
          }
          await scheduler.operations.writeFile(path, contents)
        },
      }
      const clone = cloneProjectIntoLocalDirectory({
        fileOperations: operations,
        projectDirectoryPath: '/destination',
        sourceProjectPath: '/source/original',
        sourceProjectName: 'original',
        wasmInstancePromise: {} as ModuleType,
      })
      try {
        await started.promise
        vi.useFakeTimers()
        await vi.advanceTimersByTimeAsync(7_000)
        await operations.writeFile(
          '/source/original/main.kcl',
          'new source edit'
        )
        expect(await memory.readFile('/source/original/main.kcl', 'utf8')).toBe(
          'new source edit'
        )
        release.resolve(undefined)
        if (fail) {
          await expect(clone).rejects.toThrow('Destination unavailable')
          expect(await memory.readdir('/destination')).toEqual([])
        } else {
          const result = await clone
          expect(
            await memory.readFile(`${result.localProjectPath}/main.kcl`, 'utf8')
          ).toBe('captured')
        }
        expect(await memory.readFile('/source/original/main.kcl', 'utf8')).toBe(
          'new source edit'
        )
        expect(
          await memory.readFile('/source/original/project.toml', 'utf8')
        ).toBe(toml)
      } finally {
        release.resolve(undefined)
        await Promise.allSettled([clone])
        vi.useRealTimers()
        await scheduler.dispose()
      }
    }
  )
})
