import { signal } from '@preact/signals-core'
import {
  BILLING_CONTEXT_DEFAULTS,
  billingMachine,
} from '@src/lib/billing/machine'
import { CloudLibraryTrainingDisclosure } from '@src/lib/cloudProjects/CloudLibraryTrainingDisclosure'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { billingService } from '@src/registry/contracts/billing'
import { act, render, screen } from '@testing-library/react'
import { provide, Registry } from 'plankton'
import { afterEach, expect, it } from 'vitest'
import { createActor } from 'xstate'

let registry: Registry | undefined
afterEach(async () => {
  await registry?.dispose()
})

async function renderDisclosure(
  hasSubscription?: boolean,
  organizationId?: string
) {
  const library: ProjectLibrary = {
    id: 'cloud-library-designs',
    title: 'Designs',
    path: 'zoo://project-libraries/designs',
    type: 'cloud',
    organizationId,
  }
  const context = signal({ ...BILLING_CONTEXT_DEFAULTS, hasSubscription })
  const actor = createActor(billingMachine, { input: context.value })
  registry = new Registry()
  await registry.configure([
    provide(billingService, {
      actor,
      send: (event) => actor.send(event),
      state: signal(actor.getSnapshot()),
      context,
      useContext: () => context.value,
    }),
  ])
  render(
    <CloudLibraryTrainingDisclosure library={library} registry={registry} />
  )
  return context
}

it('shows the policy link only when the personal library is on the Free plan', async () => {
  const context = await renderDisclosure()
  expect(screen.queryByRole('link', { name: 'See our policy' })).toBeNull()

  act(() => {
    context.value = { ...context.value, hasSubscription: false }
  })
  expect(
    screen.getByText(/Zoo trains on Free user cloud projects/)
  ).toBeVisible()
  expect(screen.getByRole('link', { name: 'See our policy' })).toHaveAttribute(
    'href',
    'https://zoo.dev/terms-and-conditions#7-customer-materials-and-data'
  )

  act(() => {
    context.value = { ...context.value, hasSubscription: true }
  })
  expect(screen.queryByRole('link', { name: 'See our policy' })).toBeNull()
})

it('omits the personal training disclosure for organization libraries', async () => {
  await renderDisclosure(false, 'organization')
  expect(screen.queryByRole('link', { name: 'See our policy' })).toBeNull()
})
