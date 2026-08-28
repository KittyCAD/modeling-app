import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import {
  appMenuSectionsValueSpec,
  appMenuTriggerValueSpec,
} from '@src/contracts/appMenu'
import { authService, signInFlowsValueSpec } from '@src/contracts/auth'
import { commandsValueSpec } from '@src/contracts/commands'
import { runtimeService } from '@src/contracts/runtime'
import { screensValueSpec } from '@src/contracts/shell'
import { MenuIdentity } from '@src/features/appMenu/AppMenu'
import { SignInScreen } from '@src/features/auth/SignInScreen'
import { createAuthService } from '@src/features/auth/createAuthService'
import { createDeviceFlow } from '@src/features/auth/flows/deviceFlow'
import { pasteTokenFlow } from '@src/features/auth/flows/pasteToken'
import { createWebRedirectFlow } from '@src/features/auth/flows/webRedirect'
import { fetchUser } from '@src/features/auth/userApi'

/** Initials, for when there is no profile image. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2)
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ''}`
}

/**
 * The menu trigger, once there is someone to show.
 *
 * Contributed to a first-wins spec, which is what makes "the app menu becomes a
 * user menu when signed in" a composition fact rather than a conditional inside
 * the menu.
 */
function AvatarTrigger({
  open,
  toggle,
  elementRef,
}: {
  open: boolean
  toggle: () => void
  elementRef: (element: HTMLElement | null) => void
}) {
  const auth = useService(authService)
  const user = useComputed(() => auth.user.value)

  return (
    <button
      type="button"
      class="zds-avatar-trigger"
      aria-expanded={open}
      aria-label={user.value ? `Account: ${user.value.name}` : 'Account'}
      onClick={toggle}
      ref={elementRef as never}
    >
      {user.value?.imageUrl ? (
        <img src={user.value.imageUrl} alt="" />
      ) : (
        <span class="zds-avatar-trigger__initials">
          {initialsOf(user.value?.name ?? '?')}
        </span>
      )}
    </button>
  )
}

function IdentityCard() {
  const auth = useService(authService)
  const user = useComputed(() => auth.user.value)

  if (!user.value) return null
  return (
    <MenuIdentity
      name={user.value.name}
      detail={user.value.email}
      imageUrl={user.value.imageUrl}
    />
  )
}

/**
 * Who is signed in, and how to change that.
 *
 * The screen is contributed like any other and wins by order when something has
 * asked for credentials — no route guard, no wrapper. Identity is contributed
 * into the app menu rather than owning a menu of its own, so the menu is useful
 * signed out and simply gains a person when signed in.
 */
export default defineRegistryItemFactory((ctx) => {
  const auth = createAuthService({ fetchUser })

  const isDesktop = () => ctx.services.get(runtimeService).info.value.isDesktop
  const isWeb = () => !isDesktop()

  const signedIn = computed(() => auth.status.value === 'signedIn')

  return {
    model: auth,
    item: defineRuntimeRegistryItem({
      id: 'auth',
      dispose: () => auth.dispose(),
      providesServices: [provideService(authService, auth)],
      provides: [
        // Ahead of every other screen, so it shadows them while it is active.
        provide(screensValueSpec, {
          id: 'auth.signIn',
          order: -100,
          active: auth.signInRequested,
          render: () => <SignInScreen />,
        }),

        provide(signInFlowsValueSpec, createDeviceFlow(isDesktop)),
        provide(signInFlowsValueSpec, createWebRedirectFlow(isWeb)),
        provide(signInFlowsValueSpec, pasteTokenFlow),

        // Identity: a card and a sign-out, at the top of the menu.
        provide(appMenuSectionsValueSpec, {
          id: 'auth.identity',
          order: -100,
          visible: signedIn,
          content: () => <IdentityCard />,
          items: [
            {
              id: 'auth.signOut',
              label: 'Sign out',
              icon: 'unplugged',
              destructive: true,
              commandId: 'auth.signOut',
            },
          ],
        }),
        // And the other half: an invitation when there is nobody.
        provide(appMenuSectionsValueSpec, {
          id: 'auth.signIn',
          order: -100,
          visible: computed(() => !signedIn.value),
          items: [
            {
              id: 'auth.signIn',
              label: 'Sign in to Zoo',
              icon: 'arrowUpRight',
              commandId: 'auth.signIn',
            },
          ],
        }),
        // A signal, not a literal: it declines while signed out, leaving the
        // generic menu button in place.
        provide(
          appMenuTriggerValueSpec,
          computed(() =>
            signedIn.value
              ? {
                  id: 'auth.avatar',
                  render: ({
                    open,
                    toggle,
                    ref,
                  }: {
                    open: boolean
                    toggle: () => void
                    ref: (element: HTMLElement | null) => void
                  }) => (
                    <AvatarTrigger
                      open={open}
                      toggle={toggle}
                      elementRef={ref}
                    />
                  ),
                }
              : null
          )
        ),

        provide(commandsValueSpec, {
          id: 'auth.signIn',
          title: 'Sign in to Zoo',
          category: 'Account',
          icon: 'arrowUpRight',
          enabled: computed(() => !signedIn.value),
          run: () => auth.requestSignIn(),
        }),
        provide(commandsValueSpec, {
          id: 'auth.signOut',
          title: 'Sign out',
          category: 'Account',
          icon: 'unplugged',
          enabled: signedIn,
          run: () => auth.signOut(),
        }),
        provide(commandsValueSpec, {
          id: 'auth.refresh',
          title: 'Re-check the current session',
          category: 'Account',
          icon: 'refresh',
          run: () => auth.refresh(),
        }),
      ],
    }),
  }
}, 'auth')
