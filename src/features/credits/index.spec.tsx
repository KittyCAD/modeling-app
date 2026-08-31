import {
  Registry,
  defineRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { AuthService, AuthUser } from '@src/contracts/auth'
import { authService } from '@src/contracts/auth'
import { commandsValueSpec } from '@src/contracts/commands'
import type { CreditConsumer } from '@src/contracts/credits'
import {
  creditConsumersValueSpec,
  creditsService,
} from '@src/contracts/credits'
import { homeSidebarItemsValueSpec } from '@src/contracts/home'
import { runtimeService } from '@src/contracts/runtime'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import creditsFeature from '@src/features/credits'

/**
 * The registry item, built by the real container.
 *
 * This file exists because the unit tests could not have caught the bug that
 * made it necessary: they construct `createCreditsService` directly, so nothing
 * ever flattened a graph containing this feature. The factory body was resolving
 * `authService` eagerly — one of the two things the container forbids — and it
 * threw on app start while 2,159 unit tests passed.
 *
 * Both forbidden mistakes only show when the graph is flattened, which is what
 * reading a value spec below does.
 */
function harness(options: { token?: string | null; user?: AuthUser } = {}) {
  const token = signal<string | null>(options.token ?? null)
  const user = signal<AuthUser | null>(options.user ?? null)

  const auth = {
    token: computed(() => token.value),
    user: computed(() => user.value),
  } as unknown as AuthService

  const consumers = signal<readonly CreditConsumer[]>([])

  const registry = new Registry()
  registry.configure([
    creditsFeature,
    defineRegistryItem({
      id: 'test.stubs',
      providesServices: [
        provideService(authService, auth),
        provideService(runtimeService, {
          info: computed(() => ({
            target: 'web' as const,
            isDesktop: false,
            isWeb: true,
            // Keeps the poll timer out of the test.
            isTest: true,
            isMac: false,
            version: 'test',
          })),
        }),
      ],
      provides: [
        provide(creditConsumersValueSpec, {
          id: 'test.source',
          consumers: computed(() => consumers.value),
        }),
      ],
    }),
  ])

  return { registry, token, user, consumers }
}

describe('credits feature', () => {
  /*
   * The regression test. Flattening is what throws, and reading a value spec is
   * what flattens — `configure` alone is lazy, so asserting on it would pass
   * against the very bug this guards.
   */
  it('configures without resolving a service too early', () => {
    expect(() => {
      const { registry } = harness()
      registry.get(statusBarItemsValueSpec)
    }).not.toThrow()
  })

  it('puts the balance in the status bar, ungated', () => {
    const { registry } = harness()

    const item = registry
      .get(statusBarItemsValueSpec)
      .find((each) => each.id === 'credits.balance')

    expect(item).toBeDefined()
    expect(item?.zone).toBe('end')
    // Never gated: an account balance is a fact on the home screen too.
    expect(item?.visible).toBeUndefined()
  })

  it('puts a summary in Home’s left column', () => {
    const { registry } = harness()

    const item = registry
      .get(homeSidebarItemsValueSpec)
      .find((each) => each.id === 'credits.summary')

    expect(item).toBeDefined()
    expect(item?.group).toBe('end')
  })

  it('offers a refresh command', () => {
    const { registry } = harness()

    const ids = registry.get(commandsValueSpec).map((command) => command.id)

    expect(ids).toContain('credits.refresh')
  })

  it('builds the service lazily and reads contributed consumers', () => {
    const { registry, consumers } = harness()

    const credits = registry.get(creditsService)
    expect(credits.spending.value).toBe(false)

    consumers.value = [
      {
        id: 'c1:t1',
        groupId: 'c1',
        kind: 'zookeeper.conversation',
        label: 'Conversation 1',
        project: 'bracket',
        startedAt: 1_000,
      },
    ]

    expect(credits.spending.value).toBe(true)
    expect(credits.consumers.value[0]?.project).toBe('bracket')
  })

  it('says to sign in when there is no token', () => {
    const { registry } = harness({ token: null })

    const credits = registry.get(creditsService)
    // Reading `state` is what constructs the service, which is the point.
    expect(credits.state.value).not.toBe('ready')
    expect(credits.balance.value).toBeNull()
  })
})
