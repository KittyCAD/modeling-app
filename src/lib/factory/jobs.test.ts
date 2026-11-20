import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  createFactoryWorkspace,
  isFactoryPartFile,
  type FactoryJobRequests,
  type FactoryPart,
  type FactoryWriteResult,
} from '@src/lib/factory/jobs'

const part = (entrypoint: string, quantity = 1): FactoryPart => ({
  entrypoint,
  material: 'Aluminum',
  finish: 'Anodized',
  quantity,
  notes: entrypoint,
})
const delivery = {
  shipping_address_revision_id: 'address-revision',
  is_expedited: false,
}
const accepted = (id: string): FactoryWriteResult => ({
  ok: true,
  id,
  status: 'new',
})

it('submits one job per entry point with common bytes and independent specifications', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), {
        minLength: 1,
        maxLength: 12,
      }),
      async (quantities) => {
        const workspace = createFactoryWorkspace()
        const parts = quantities.map((quantity, index) =>
          part(`parts/${index}.kcl`, quantity)
        )
        const snapshot = {
          projectId: 'source-project',
          versionId: 'source-version',
          files: parts.map((part) => ({
            relativePath: part.entrypoint,
            data: new Uint8Array([1, 2, 3]),
          })),
        }
        const create = vi.fn<FactoryJobRequests['create']>(async (part) =>
          accepted(part.entrypoint)
        )
        await workspace.submit(parts, snapshot, delivery, {
          create,
          revise: vi.fn(),
        })
        expect(create.mock.calls).toHaveLength(parts.length)
        for (const [
          index,
          [submittedPart, submittedSnapshot, submittedDelivery],
        ] of create.mock.calls.entries()) {
          expect(submittedPart).toEqual(parts[index])
          expect(submittedSnapshot).toBe(snapshot)
          expect(submittedDelivery).toEqual(delivery)
        }
        expect(workspace.jobs.value.map((job) => job.part.entrypoint)).toEqual(
          parts.map((part) => part.entrypoint)
        )
      }
    )
  )
})

describe('submission failures', () => {
  const parts = [part('main.kcl'), part('other.kcl'), part('third.kcl')]
  const snapshot = {
    projectId: 'source-project',
    versionId: 'source-version',
    files: parts.map((part) => ({
      relativePath: part.entrypoint,
      data: new Uint8Array(),
    })),
  }
  it('keeps confirmed jobs and stops at the first rejected job', async () => {
    const workspace = createFactoryWorkspace()
    const create = vi
      .fn<FactoryJobRequests['create']>()
      .mockResolvedValueOnce(accepted('one'))
      .mockResolvedValueOnce({
        ok: false,
        message: 'Unavailable material',
        uncertain: false,
      })
    expect(
      await workspace.submit(parts, snapshot, delivery, {
        create,
        revise: vi.fn(),
      })
    ).toEqual(['main.kcl'])
    expect(create).toHaveBeenCalledTimes(2)
    expect(workspace.jobs.value.map((job) => job.id)).toEqual(['one'])
    expect(workspace.error.value).toBe('Unavailable material')
    expect(workspace.pending.value).toBe(false)
  })
  it('blocks repeated writes when the server response is uncertain', async () => {
    const workspace = createFactoryWorkspace()
    const create = vi
      .fn<FactoryJobRequests['create']>()
      .mockResolvedValue({ ok: false, message: 'Check jobs', uncertain: true })
    const requests = { create, revise: vi.fn() }
    await workspace.submit(parts, snapshot, delivery, requests)
    await workspace.submit(parts, snapshot, delivery, requests)
    expect(create).toHaveBeenCalledTimes(1)
    expect(workspace.uncertain.value).toBe(true)
  })
  it('ignores late results after the workspace is removed', async () => {
    const workspace = createFactoryWorkspace()
    let resolve!: (result: FactoryWriteResult) => void
    const create = vi.fn<FactoryJobRequests['create']>(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const submission = workspace.submit(parts, snapshot, delivery, {
      create,
      revise: vi.fn(),
    })
    workspace.dispose()
    resolve(accepted('late'))
    await submission
    expect(workspace.jobs.value).toEqual([])
    expect(create).toHaveBeenCalledTimes(1)
  })
  it('prevents overlapping submissions', async () => {
    const workspace = createFactoryWorkspace()
    let resolve!: (result: FactoryWriteResult) => void
    const create = vi.fn<FactoryJobRequests['create']>(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const requests = { create, revise: vi.fn() }
    const first = workspace.submit([parts[0]], snapshot, delivery, requests)
    await workspace.submit([parts[0]], snapshot, delivery, requests)
    resolve(accepted('one'))
    await first
    expect(create).toHaveBeenCalledTimes(1)
  })
  it('rejects a missing entry point before sending any jobs', async () => {
    const workspace = createFactoryWorkspace()
    const create = vi.fn()
    await workspace.submit(
      parts,
      { projectId: 'source-project', versionId: 'source-version', files: [] },
      delivery,
      {
        create,
        revise: vi.fn(),
      }
    )
    expect(create).not.toHaveBeenCalled()
    expect(workspace.error.value).toContain('missing')
  })
})

it('updates only the revised job and retains its entry point', async () => {
  const workspace = createFactoryWorkspace()
  const parts = [part('main.kcl'), part('nested/part.kcl')]
  const requests: FactoryJobRequests = {
    create: async (part) => accepted(part.entrypoint),
    revise: async (job) => ({ ok: true, id: job.id, status: 'quoting' }),
  }
  await workspace.submit(
    parts,
    {
      projectId: 'source-project',
      versionId: 'source-version',
      files: parts.map((part) => ({
        relativePath: part.entrypoint,
        data: new Uint8Array(),
      })),
    },
    delivery,
    requests
  )
  await workspace.revise(
    workspace.jobs.value[1],
    { ...parts[1], quantity: 20 },
    requests
  )
  expect(
    workspace.jobs.value.map((job) => [
      job.part.entrypoint,
      job.part.quantity,
      job.status,
    ])
  ).toEqual([
    ['main.kcl', 1, 'new'],
    ['nested/part.kcl', 20, 'quoting'],
  ])
})

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid quantity %s before submitting a batch',
  async (quantity) => {
    const workspace = createFactoryWorkspace()
    const parts = [part('main.kcl'), part('other.kcl', quantity)]
    const create = vi.fn()
    await workspace.submit(
      parts,
      {
        projectId: 'source-project',
        versionId: 'source-version',
        files: parts.map((part) => ({
          relativePath: part.entrypoint,
          data: new Uint8Array(),
        })),
      },
      delivery,
      { create, revise: vi.fn() }
    )
    expect(create).not.toHaveBeenCalled()
    expect(workspace.error.value).toBe(
      'Quantity must be a positive whole number.'
    )
  }
)

it.each([
  ['main.kcl', true],
  ['parts/bracket.KCL', true],
  ['parts/solid.step', true],
  ['parts/solid.STEP', true],
  ['parts/solid.stp', true],
  ['parts/solid.STP', true],
  ['reference/drawing.pdf', false],
  ['part.step.backup', false],
])('offers %s as a manufacturable part: %s', (path, expected) => {
  expect(isFactoryPartFile(path)).toBe(expected)
})
