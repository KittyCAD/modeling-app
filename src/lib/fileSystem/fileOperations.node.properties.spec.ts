import { tmpdir } from 'node:os'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  createFileOperationsScheduler,
  type FileOperationsScheduler,
} from '@src/lib/fileSystem/scheduler'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const original = await importOriginal<typeof ClientErrorsModule>()
  return { ...original, reportClientError: vi.fn() }
})

interface VersionedContents {
  readonly revision: number
  readonly payload: readonly number[]
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

const operationStreamRuns = positiveIntegerEnvironment(
  'FILE_OPERATION_PROPERTY_RUNS',
  50
)
const operationStreamMaxLength = positiveIntegerEnvironment(
  'FILE_OPERATION_MAX_STREAM_LENGTH',
  10
)
const operationStreamTimeoutMs = positiveIntegerEnvironment(
  'FILE_OPERATION_TIMEOUT_MS',
  Math.max(5_000, operationStreamRuns * operationStreamMaxLength * 5)
)

const encodeVersion = (
  revision: number,
  payload: Uint8Array<ArrayBufferLike>
): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(
    JSON.stringify({
      revision,
      payload: [...payload],
    } satisfies VersionedContents)
  )

const decodeVersion = (contents: Uint8Array): VersionedContents =>
  JSON.parse(new TextDecoder().decode(contents)) as VersionedContents

/**
 * Model the guarantees owned by one coordinator scheduler. A backing adapter
 * must separately guarantee that an individual successful write is atomic;
 * cross-scheduler ordering requires a shared platform or server authority.
 */
describe('coordinated filesystem operation properties on NodeFS', () => {
  const schedulers: FileOperationsScheduler[] = []
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(
      schedulers.splice(0).map((scheduler) => scheduler.dispose())
    )
    await Promise.all(
      roots
        .splice(0)
        .map((root) =>
          nodeFileSystem.impl.rm(root, { recursive: true, force: true })
        )
    )
  })

  it('writes generated Unicode strings as their UTF-8 byte representation', async () => {
    const root = nodeFileSystem.impl.join(
      tmpdir(),
      `zds-file-operation-text-${crypto.randomUUID()}`
    )
    roots.push(root)
    await nodeFileSystem.impl.mkdir(root, { recursive: true })
    const scheduler = createFileOperationsScheduler(nodeFileSystem.impl)
    schedulers.push(scheduler)
    let index = 0

    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: 'binary', maxLength: 32 }),
        async (contents) => {
          const path = nodeFileSystem.impl.join(root, `${index++}.kcl`)

          await scheduler.operations.writeFile(path, contents)

          expect([...(await scheduler.operations.readFile(path))]).toEqual([
            ...new TextEncoder().encode(contents),
          ])
        }
      ),
      { numRuns: 50 }
    )
  })

  it(
    'preserves write order and never reads an older acknowledged revision',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              delayMs: fc.integer({ min: 0, max: 4 }),
              fail: fc.boolean(),
              payload: fc.uint8Array({ maxLength: 48 }),
            }),
            { minLength: 1, maxLength: operationStreamMaxLength }
          ),
          async (operations) => {
            const root = nodeFileSystem.impl.join(
              tmpdir(),
              `zds-file-operation-stream-${crypto.randomUUID()}`
            )
            const path = nodeFileSystem.impl.join(root, 'main.kcl')
            roots.push(root)
            await nodeFileSystem.impl.mkdir(root, { recursive: true })
            await nodeFileSystem.impl.writeFile(
              path,
              encodeVersion(-1, new Uint8Array())
            )

            const delays = new Map(
              operations.map(({ delayMs }, revision) => [revision, delayMs])
            )
            const failures = new Set(
              operations.flatMap(({ fail }, revision) =>
                fail ? [revision] : []
              )
            )
            const committed: number[] = []
            const backing: IZooDesignStudioFS = {
              ...nodeFileSystem.impl,
              writeFile: async (target, contents) => {
                const { revision } = decodeVersion(contents)
                const delayMs = delays.get(revision) ?? 0
                await new Promise((resolve) => setTimeout(resolve, delayMs))
                if (failures.has(revision)) {
                  return Promise.reject(
                    Object.assign(new Error(`Failed revision ${revision}`), {
                      code: 'EIO',
                    })
                  )
                }
                await nodeFileSystem.impl.writeFile(target, contents)
                committed.push(revision)
              },
            }
            const scheduler = createFileOperationsScheduler(backing)
            schedulers.push(scheduler)

            const writes = operations.map(({ payload }, revision) =>
              scheduler.operations.writeFile(
                path,
                encodeVersion(revision, payload)
              )
            )
            const observations = writes.map(async (write, revision) => {
              try {
                await write
              } catch {
                return
              }

              const observed = decodeVersion(
                await scheduler.operations.readFile(path)
              )
              expect(observed.revision).toBeGreaterThanOrEqual(revision)
              expect(observed).toEqual(
                decodeVersion(
                  encodeVersion(
                    observed.revision,
                    operations[observed.revision].payload
                  )
                )
              )
            })

            const results = await Promise.allSettled(writes)
            await Promise.all(observations)

            expect(results.map(({ status }) => status)).toEqual(
              operations.map(({ fail }) => (fail ? 'rejected' : 'fulfilled'))
            )
            const successfulRevisions = operations.flatMap(
              ({ fail }, revision) => (fail ? [] : [revision])
            )
            expect(committed).toEqual(successfulRevisions)

            const expectedRevision = successfulRevisions.at(-1) ?? -1
            const final = decodeVersion(
              await scheduler.operations.readFile(path)
            )
            expect(final).toEqual(
              expectedRevision === -1
                ? { revision: -1, payload: [] }
                : decodeVersion(
                    encodeVersion(
                      expectedRevision,
                      operations[expectedRevision].payload
                    )
                  )
            )
          }
        ),
        { numRuns: operationStreamRuns }
      )
    },
    operationStreamTimeoutMs
  )
})
