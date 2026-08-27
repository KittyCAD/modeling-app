import type {
  FsMutationOperations,
  FsOperationBatch,
} from '@src/registry/contracts/fsOperationQueue'
import { createFsOperationQueueService } from '@src/registry/extensions/fsOperationQueue'
import fc, { type Scheduler } from 'fast-check'
import { describe, expect, it } from 'vitest'

type Mutation =
  | {
      readonly kind: 'copy'
      readonly sourcePath: string
      readonly targetPath: string
    }
  | {
      readonly kind: 'remove'
      readonly targetPath: string
    }
  | {
      readonly kind: 'rename'
      readonly sourcePath: string
      readonly targetPath: string
    }
  | {
      readonly kind: 'write'
      readonly targetPath: string
      readonly value: string
    }

interface FileSystemModel {
  readonly files: Map<string, string>
  readonly attempted: Mutation[]
}

const projectPath = fc.constantFrom(
  '/project/a.kcl',
  '/project/b.kcl',
  '/project/c.kcl',
  '/project/d.kcl'
)

const mutationArbitrary: fc.Arbitrary<Mutation> = fc.oneof(
  fc.tuple(projectPath, projectPath).map(([sourcePath, targetPath]) => ({
    kind: 'copy' as const,
    sourcePath,
    targetPath,
  })),
  projectPath.map((targetPath) => ({
    kind: 'remove' as const,
    targetPath,
  })),
  fc.tuple(projectPath, projectPath).map(([sourcePath, targetPath]) => ({
    kind: 'rename' as const,
    sourcePath,
    targetPath,
  })),
  fc
    .tuple(projectPath, fc.string({ maxLength: 8 }))
    .map(([targetPath, value]) => ({
      kind: 'write' as const,
      targetPath,
      value,
    }))
)

const batchPlansArbitrary = fc.array(
  fc.array(mutationArbitrary, { minLength: 1, maxLength: 5 }),
  { minLength: 1, maxLength: 4 }
)

function applyMutation(files: Map<string, string>, mutation: Mutation) {
  switch (mutation.kind) {
    case 'copy':
      files.set(mutation.targetPath, files.get(mutation.sourcePath) ?? '')
      break
    case 'remove':
      files.delete(mutation.targetPath)
      break
    case 'rename': {
      const contents = files.get(mutation.sourcePath) ?? ''
      files.delete(mutation.sourcePath)
      files.set(mutation.targetPath, contents)
      break
    }
    case 'write':
      files.set(mutation.targetPath, mutation.value)
      break
  }
}

function createScheduledFileSystem(
  scheduler: Scheduler,
  failureAt?: number
): FileSystemModel & { readonly operations: FsMutationOperations } {
  const files = new Map<string, string>()
  const attempted: Mutation[] = []
  let invocation = 0

  const mutate = scheduler.scheduleFunction(async (mutation: Mutation) => {
    const currentInvocation = invocation++
    attempted.push(mutation)
    if (currentInvocation === failureAt) {
      throw new Error(`injected filesystem failure at ${currentInvocation}`)
    }
    applyMutation(files, mutation)
  })

  return {
    files,
    attempted,
    operations: {
      cp: (sourcePath, targetPath) =>
        mutate({ kind: 'copy', sourcePath, targetPath }),
      mkdir: async () => undefined,
      rename: (sourcePath, targetPath) =>
        mutate({ kind: 'rename', sourcePath, targetPath }),
      rm: (targetPath) => mutate({ kind: 'remove', targetPath }),
      writeFile: (targetPath, data) =>
        mutate({
          kind: 'write',
          targetPath,
          value: new TextDecoder().decode(data),
        }),
    },
  }
}

function executeMutation(batch: FsOperationBatch, mutation: Mutation) {
  switch (mutation.kind) {
    case 'copy':
      return Promise.resolve(batch.cp(mutation.sourcePath, mutation.targetPath))
    case 'remove':
      return batch.rm(mutation.targetPath)
    case 'rename':
      return batch.rename(mutation.sourcePath, mutation.targetPath)
    case 'write':
      return batch.writeFile(
        mutation.targetPath,
        new TextEncoder().encode(mutation.value)
      )
  }
}

function modelSequentialBatches(
  plans: readonly (readonly Mutation[])[],
  failureAt?: number
) {
  const files = new Map<string, string>()
  const attempted: Mutation[] = []
  const failedBatches = new Set<number>()
  let invocation = 0

  plans.forEach((plan, batchIndex) => {
    for (const mutation of plan) {
      attempted.push(mutation)
      if (invocation++ === failureAt) {
        failedBatches.add(batchIndex)
        break
      }
      applyMutation(files, mutation)
    }
  })

  return { files, attempted, failedBatches }
}

function sortedEntries(files: ReadonlyMap<string, string>) {
  return [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )
}

describe('fs operation queue properties', () => {
  it('matches a serial model across generated batches and failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        batchPlansArbitrary,
        fc.option(fc.nat({ max: 20 }), { nil: undefined }),
        fc.scheduler(),
        async (plans, failureAt, scheduler) => {
          const fileSystem = createScheduledFileSystem(scheduler, failureAt)
          const queue = createFsOperationQueueService(fileSystem.operations)
          const batchEvents: string[] = []
          const expected = modelSequentialBatches(plans, failureAt)

          const batches = plans.map((plan, batchIndex) =>
            queue.batch({ kind: `batch-${batchIndex}` }, async (batch) => {
              batchEvents.push(`${batchIndex}:start`)
              try {
                for (const mutation of plan) {
                  await executeMutation(batch, mutation)
                }
              } finally {
                batchEvents.push(`${batchIndex}:end`)
              }
            })
          )

          const results = await scheduler.waitFor(Promise.allSettled(batches))
          await queue.waitForIdle()

          expect(batchEvents).toEqual(
            plans.flatMap((_, batchIndex) => [
              `${batchIndex}:start`,
              `${batchIndex}:end`,
            ])
          )
          expect(fileSystem.attempted).toEqual(expected.attempted)
          expect(sortedEntries(fileSystem.files)).toEqual(
            sortedEntries(expected.files)
          )
          expect(results.map((result) => result.status)).toEqual(
            plans.map((_, batchIndex) =>
              expected.failedBatches.has(batchIndex) ? 'rejected' : 'fulfilled'
            )
          )

          const journal = queue.getJournal()
          expect(journal).toHaveLength(plans.length + expected.attempted.length)
          expect(new Set(journal.map((record) => record.id)).size).toBe(
            journal.length
          )
          expect(
            journal.every(
              (record) =>
                record.status === 'completed' || record.status === 'failed'
            )
          ).toBe(true)
          expect(
            journal
              .filter((record) => record.parentId)
              .every((record) =>
                journal.some((parent) => parent.id === record.parentId)
              )
          ).toBe(true)
          expect(
            journal
              .filter((record) => !record.parentId)
              .map((record) => record.status)
          ).toEqual(
            plans.map((_, batchIndex) =>
              expected.failedBatches.has(batchIndex) ? 'failed' : 'completed'
            )
          )
          expect(
            journal.filter(
              (record) => record.parentId && record.status === 'failed'
            )
          ).toHaveLength(expected.failedBatches.size)
          expect(queue.state.value).toMatchObject({
            pending: false,
            queued: [],
          })
          expect(queue.state.value.current).toBeUndefined()
        }
      ),
      { numRuns: 100 }
    )
  })

  it('serializes concurrently requested children in generated batches', async () => {
    await fc.assert(
      fc.asyncProperty(
        batchPlansArbitrary,
        fc.scheduler(),
        async (plans, scheduler) => {
          const fileSystem = createScheduledFileSystem(scheduler)
          const queue = createFsOperationQueueService(fileSystem.operations)
          const expected = modelSequentialBatches(plans)

          const batches = plans.map((plan, batchIndex) =>
            queue.batch({ kind: `batch-${batchIndex}` }, async (batch) => {
              await Promise.all(
                plan.map((mutation) => executeMutation(batch, mutation))
              )
            })
          )

          await scheduler.waitFor(Promise.all(batches))
          await queue.waitForIdle()

          expect(fileSystem.attempted).toEqual(expected.attempted)
          expect(sortedEntries(fileSystem.files)).toEqual(
            sortedEntries(expected.files)
          )
          expect(queue.state.value.pending).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})
