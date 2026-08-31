import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { authService } from '@src/contracts/auth'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  creditConsumersValueSpec,
  creditsService,
} from '@src/contracts/credits'
import { homeSidebarItemsValueSpec } from '@src/contracts/home'
import { runtimeService } from '@src/contracts/runtime'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { CreditsField } from '@src/features/credits/CreditsField'
import { CreditsSummary } from '@src/features/credits/CreditsSummary'
import { createCreditsApi } from '@src/features/credits/creditsApi'
import { createCreditsService } from '@src/features/credits/createCreditsService'

/**
 * The account's credit balance.
 *
 * Its own feature, and not part of Zookeeper, for two reasons that point the
 * same way. Credits are an account-level pool that more than one thing spends
 * from — Zookeeper today, text-to-CAD next — so the feature that owns the number
 * should not be one of the spenders. And Zookeeper is a plugin that can be
 * turned off, while a balance is still a fact about your account when it is: a
 * readout living inside the plugin would disappear along with it.
 *
 * The dependency therefore runs the other way from how it is usually described.
 * Credits knows nothing about agents; it reads whatever has been contributed to
 * `creditConsumersValueSpec`. Zookeeper contributes a source. Turning the plugin
 * off removes the contribution, and the readout simply has nothing spending.
 */
export default defineRegistryItemFactory((ctx) => {
  const auth = ctx.services.get(authService)

  /*
   * Which pool to read. Null until the profile lands, and it must be read
   * lazily: membership is resolved by the sign-in verify pass, well after this
   * factory runs.
   */
  const org = computed(() => auth.user.value?.org?.id ?? null)

  const credits = createCreditsService({
    api: createCreditsApi({
      token: () => auth.token.value,
      org: () => org.value,
    }),
    token: auth.token,
    org,
    sources: computed(() => ctx.valueSpecs.get(creditConsumersValueSpec)),
    // Tests drive `refresh` themselves rather than waiting on a timer.
    pollIntervalMs: ctx.services.get(runtimeService).info.value.isTest
      ? 0
      : undefined,
  })

  return {
    model: credits,
    item: defineRuntimeRegistryItem({
      id: 'credits',
      dispose: () => credits.dispose(),
      providesServices: [provideService(creditsService, credits)],
      provides: [
        /*
         * Global, and deliberately not gated on a project. The balance is an
         * account fact, so it belongs on the home screen as much as anywhere —
         * arguably more, since that is where somebody goes to ask what they have
         * left before starting work.
         */
        provide(statusBarItemsValueSpec, {
          id: 'credits.balance',
          zone: 'end',
          order: -30,
          render: () => <CreditsField />,
        }),
        /*
         * And again on Home, with room to be read. Contributed rather than
         * imported by the home screen, so Home stays ignorant of what a credit
         * is — and so this disappears with the feature rather than leaving a
         * hole in somebody else's layout.
         */
        provide(homeSidebarItemsValueSpec, {
          id: 'credits.summary',
          group: 'end',
          order: 0,
          render: () => <CreditsSummary />,
        }),

        provide(commandsValueSpec, {
          id: 'credits.refresh',
          title: 'Refresh credit balance',
          category: 'Account',
          icon: 'refresh',
          run: () => credits.refresh(),
        }),
      ],
    }),
  }
}, 'credits')
