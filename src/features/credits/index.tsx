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
  /*
   * Lazy, and never resolved in this body: the graph is still being flattened
   * here, and resolving a service now is the first of the container's two rules.
   */
  const auth = () => ctx.services.get(authService)
  const runtime = () => ctx.services.get(runtimeService)

  /*
   * Which pool to read. Null until the profile lands, and read lazily for two
   * reasons: membership is resolved by the sign-in verify pass long after this
   * factory runs, and reaching `authService` any earlier is what the container
   * forbids.
   */
  const org = computed(() => auth().user.value?.org?.id ?? null)

  let built: ReturnType<typeof createCreditsService> | null = null

  /**
   * The real service, built on first use.
   *
   * It needs two other services, so it cannot be constructed here — and it also
   * starts an effect that reads the token, which must not run during flattening.
   * Everything exposed below defers to this through a `computed` or a method
   * call, both of which run long afterwards.
   */
  const credits = () => {
    built ??= createCreditsService({
      api: createCreditsApi({
        token: () => auth().token.value,
        org: () => org.value,
      }),
      token: computed(() => auth().token.value),
      org,
      sources: computed(() => ctx.valueSpecs.get(creditConsumersValueSpec)),
      // Tests drive `refresh` themselves rather than waiting on a timer.
      pollIntervalMs: runtime().info.value.isTest ? 0 : undefined,
    })
    return built
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'credits',
      dispose: () => built?.dispose(),
      providesServices: [
        provideService(creditsService, {
          balance: computed(() => credits().balance.value),
          state: computed(() => credits().state.value),
          error: computed(() => credits().error.value),
          consumers: computed(() => credits().consumers.value),
          spending: computed(() => credits().spending.value),
          usage: computed(() => credits().usage.value),
          refresh: () => credits().refresh(),
        }),
      ],
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
          run: () => credits().refresh(),
        }),
      ],
    }),
  }
}, 'credits')
