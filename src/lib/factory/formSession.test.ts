import { expect, it, vi } from 'vitest'
import { createFactoryFormSession } from '@src/lib/factory/formSession'
import { createFactoryWorkspace } from '@src/lib/factory/jobs'
import type { FactoryFormContext } from '@src/lib/factory/types'
import type { FactoryShippingForm } from '@src/lib/factory/api'

const parts = [
  {
    entrypoint: 'main.kcl',
    material: 'Steel',
    finish: 'As machined',
    quantity: 1,
    notes: '',
  },
]
const shipping: FactoryShippingForm = {
  name: 'Recipient',
  company: '',
  phone: '202-555-0100',
  street1: '123 Example Street',
  street2: '',
  city: 'Seattle',
  state: 'WA',
  postal_code: '98101',
  country: 'US',
  is_expedited: false,
}
function preparation() {
  const workspace = createFactoryWorkspace()
  const context: FactoryFormContext = {
    signedIn: true,
    ready: true,
    local: false,
    isCurrent: () => true,
    load: vi.fn(),
    capture: vi.fn(async () => ({
      projectId: 'source-project',
      versionId: 'source-version',
      files: [{ relativePath: 'main.kcl', data: new Uint8Array([1]) }],
    })),
    saveDelivery: vi.fn(async () => ({
      shipping_address_revision_id: 'delivery',
      is_expedited: false,
    })),
    requests: {
      create: vi.fn<FactoryFormContext['requests']['create']>(async () => ({
        ok: true,
        id: 'job',
        status: 'new',
      })),
      revise: vi.fn(),
    },
  }
  return { workspace, context, session: createFactoryFormSession(workspace) }
}

it.each(['capture', 'saveDelivery'])(
  'stops before manufacturing when the project or account changes during %s',
  async (boundary) => {
    const { context, workspace, session } = preparation()
    let current = true
    context.isCurrent = () => current
    if (boundary === 'capture')
      context.capture = vi.fn(async () => {
        current = false
        return {
          projectId: 'source-project',
          versionId: 'source-version',
          files: [{ relativePath: 'main.kcl', data: new Uint8Array([1]) }],
        }
      })
    else
      context.saveDelivery = vi.fn(async () => {
        current = false
        return { shipping_address_revision_id: 'delivery', is_expedited: false }
      })
    expect(
      await session.submit(context, parts, shipping, () => true)
    ).toBeUndefined()
    expect(context.requests.create).not.toHaveBeenCalled()
    expect(workspace.jobs.value).toEqual([])
    expect(session.pending.value).toBe(false)
    if (boundary === 'capture')
      expect(context.saveDelivery).not.toHaveBeenCalled()
  }
)

it('ignores preparation completing after its form is removed', async () => {
  const { context, workspace, session } = preparation()
  let active = true
  context.capture = vi.fn(async () => {
    active = false
    return {
      projectId: 'source-project',
      versionId: 'source-version',
      files: [{ relativePath: 'main.kcl', data: new Uint8Array([1]) }],
    }
  })
  await session.submit(context, parts, shipping, () => active)
  expect(context.saveDelivery).not.toHaveBeenCalled()
  expect(context.requests.create).not.toHaveBeenCalled()
  expect(workspace.jobs.value).toEqual([])
})

it('keeps captured files after rejection but replaces delivery when the address changes', async () => {
  const { context, session } = preparation()
  context.requests.create = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      uncertain: false,
      message: 'Choose another finish',
    })
    .mockResolvedValueOnce({ ok: true, id: 'job', status: 'new' })
  await session.submit(context, parts, shipping, () => true)
  await session.submit(
    context,
    parts,
    { ...shipping, street1: '456 New Street' },
    () => true
  )
  expect(context.capture).toHaveBeenCalledTimes(1)
  expect(context.saveDelivery).toHaveBeenCalledTimes(2)
  expect(context.saveDelivery).toHaveBeenLastCalledWith(
    expect.objectContaining({ street1: '456 New Street' })
  )
  expect(session.snapshotCaptured.value).toBe(false)
})

it('allows choosing another file after a snapshot is missing the selected file', async () => {
  const { context, workspace, session } = preparation()
  const missing = [{ ...parts[0], entrypoint: 'deleted.kcl' }]
  await session.submit(context, missing, shipping, () => true)
  expect(session.snapshotCaptured.value).toBe(false)
  expect(context.saveDelivery).not.toHaveBeenCalled()
  expect(context.requests.create).not.toHaveBeenCalled()
  await session.submit(context, parts, shipping, () => true)
  expect(workspace.jobs.value.map((job) => job.part.entrypoint)).toEqual([
    'main.kcl',
  ])
})
