import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  BILLING_CONTEXT_DEFAULTS,
  billingMachine,
} from '@src/lib/billing/machine'
import {
  type BillingRegistryService,
  billingService,
} from '@src/lib/billing/registry/contract'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'

export const billingExtension = defineRegistryItemFactory(() => {
  const actor = createActor(billingMachine, {
    input: {
      ...BILLING_CONTEXT_DEFAULTS,
      urlUserService: () => withAPIBaseURL(''),
    },
  }).start()
  const state = signal(actor.getSnapshot())
  const context = signal(actor.getSnapshot().context)
  const subscription = actor.subscribe((snapshot) => {
    state.value = snapshot
    context.value = snapshot.context
  })

  const serviceImpl: BillingRegistryService = {
    actor,
    send: (...args: Parameters<typeof actor.send>) => actor.send(...args),
    state,
    context,
    useContext: () => useSelector(actor, ({ context }) => context),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'billing-extension',
      providesServices: [provideService(billingService, serviceImpl)],
      dispose: () => {
        subscription.unsubscribe()
        actor.stop()
      },
    }),
  }
}, 'billing-extension')

export default defineRegistryItem({
  id: 'billing',
  uses: [billingExtension],
})
