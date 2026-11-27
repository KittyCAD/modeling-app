import { ApiError, orgs, type UserOrgInfo } from '@kittycad/lib'
import {
  batch,
  effect,
  signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import { createKCClient } from '@src/lib/kcClient'
import { isErr } from '@src/lib/trap'
import type {
  AuthOrganizationState,
  AuthRegistryService,
} from '@src/registry/contracts/auth'
import type { RuntimeRegistryService } from '@src/registry/contracts/runtime'

type OrganizationScope = {
  accountId: string
  token: string
  baseUrl: string
  environmentName: string | undefined
}

function sameScope(
  left: OrganizationScope | undefined,
  right: OrganizationScope | undefined
) {
  return (
    left?.accountId === right?.accountId &&
    left?.token === right?.token &&
    left?.baseUrl === right?.baseUrl &&
    left?.environmentName === right?.environmentName
  )
}

export function createAuthOrganizationState(
  auth: Pick<AuthRegistryService, 'user' | 'token' | 'isLoggedIn'>,
  runtime: ReadonlySignal<RuntimeRegistryService | undefined>
) {
  const current = signal<UserOrgInfo | undefined>(undefined)
  const loading = signal(false)
  const error = signal<Error | undefined>(undefined)
  let scope: OrganizationScope | undefined
  let pending:
    | { controller: AbortController; promise: Promise<void> }
    | undefined
  let disposed = false

  const clear = () => {
    batch(() => {
      current.value = undefined
      loading.value = false
      error.value = undefined
    })
  }
  const load = (requested: OrganizationScope) => {
    const controller = new AbortController()
    const isCurrent = () =>
      !disposed &&
      !controller.signal.aborted &&
      pending?.controller === controller
    batch(() => {
      loading.value = true
      error.value = undefined
    })
    const promise = Promise.resolve()
      .then(() => {
        if (!isCurrent()) return undefined
        return orgs.get_user_org({
          client: createKCClient(requested.token, requested.baseUrl, {
            signal: controller.signal,
          }),
        })
      })
      .then((organization) => {
        if (isCurrent()) current.value = organization
      })
      .catch((cause: unknown) => {
        if (!isCurrent()) return
        batch(() => {
          current.value = undefined
          error.value =
            cause instanceof ApiError && cause.status === 404
              ? undefined
              : isErr(cause)
                ? cause
                : new Error('Could not load organization membership.', {
                    cause,
                  })
        })
      })
      .finally(() => {
        if (!isCurrent()) return
        pending = undefined
        loading.value = false
      })
    pending = { controller, promise }
    return promise
  }
  const state: AuthOrganizationState = {
    current,
    loading,
    error,
    refresh: () => {
      if (disposed || !scope) return Promise.resolve()
      return pending?.promise ?? load(scope)
    },
  }

  return {
    state,
    start: () => {
      const stop = effect(() => {
        const runtimeInfo = runtime.value?.current.value
        const loggedIn = auth.isLoggedIn.value
        const accountId = auth.user.value?.id
        const token = auth.token.value
        const baseUrl = runtimeInfo?.apiBaseUrl
        const next =
          loggedIn && accountId && token && baseUrl
            ? {
                accountId,
                token,
                baseUrl,
                environmentName: runtimeInfo.environmentName,
              }
            : undefined
        if (sameScope(scope, next)) return
        scope = next
        pending?.controller.abort()
        pending = undefined
        clear()
        if (scope) void load(scope)
      })
      return () => {
        disposed = true
        stop()
        pending?.controller.abort()
        pending = undefined
        scope = undefined
        clear()
      }
    },
  }
}
