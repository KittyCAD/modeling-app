import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { type AuthStatus, authService } from '@src/contracts/auth'

/**
 * Environment variables a development token may arrive in.
 *
 * Checked in order. These are the names the existing app's `.env` files already
 * use, so a checkout that can run the old app can run this one.
 */
const TOKEN_VARIABLES = [
  'VITE_KC_DEV_TOKEN',
  'VITE_KITTYCAD_TOKEN',
  'VITE_ZOO_API_TOKEN',
] as const

/**
 * Where the bearer token comes from.
 *
 * This is a development stand-in, and the one piece of this rebuild that is
 * knowingly not the real thing: there is no sign-in, no device flow, and no
 * refresh. It reads a token from the environment so the engine connection can be
 * built and tested, and it is deliberately the *only* place that does — so
 * replacing it with a real flow is one file, not a search across the app.
 *
 * The token is never logged. `source` reports which variable supplied it, which
 * is what someone debugging a 401 actually needs to know.
 */
export default defineRegistryItemFactory(() => {
  const found = TOKEN_VARIABLES.map((name) => ({
    name,
    value: import.meta.env?.[name] as string | undefined,
  })).find((candidate) => Boolean(candidate.value?.trim()))

  const token = signal<string | null>(found?.value?.trim() ?? null)
  const source = signal<string | null>(found?.name ?? null)

  const status = computed<AuthStatus>(() =>
    token.value ? 'authenticated' : 'unauthenticated'
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'auth',
      providesServices: [
        provideService(authService, {
          status,
          token: computed(() => token.value),
          source: computed(() => source.value),
        }),
      ],
    }),
  }
}, 'auth')
