import { effect } from '@preact/signals-core'
import type { App } from '@src/lib/app'
import {
  createDevAccountConfigController,
  readDevAccountConfigProject,
} from '@src/lib/appConfiguration/devAccount'
import { loadDevAccountConfig } from '@src/lib/appConfiguration/project'
import type { BundledRegistryItemId } from '@src/registry/catalogMetadata'
import { runtimeService } from '@src/registry/contracts/runtime'
import { isErr, trap } from '@src/lib/trap'

/** Boot installs this experiment in dev builds; fetched manifests cannot remove it. */
export function watchDevAccountConfig(
  app: App,
  baseline: readonly BundledRegistryItemId[]
) {
  const controller = createDevAccountConfigController({
    baseline,
    load: loadDevAccountConfig,
    apply: (ids, assertCurrent) =>
      app.configureAppComposition(ids, assertCurrent),
    reportError: (error) => trap(error),
  })
  const runtime = app.registry.required(runtimeService)
  const stopAuth = effect(() => {
    const user = app.auth.user.value
    const token = app.auth.token.value
    const environment = runtime.current.value
    const loggedIn = app.auth.isLoggedIn.value
    if (!loggedIn || !user) {
      controller.update(undefined)
      return
    }
    const projectId = readDevAccountConfigProject(user)
    if (isErr(projectId)) {
      controller.update(undefined, projectId)
      return
    }
    controller.update(
      projectId
        ? {
            accountId: user.id,
            projectId,
            token,
            baseUrl: environment.apiBaseUrl ?? '',
          }
        : undefined
    )
  })
  const stopStatus = effect(() =>
    console.info('[dev-app-config]', controller.status.value)
  )
  let stopped = false
  let subscription: { unsubscribe: () => void } | undefined
  const stop = () => {
    if (stopped) return
    stopped = true
    controller.dispose()
    stopAuth()
    stopStatus()
    subscription?.unsubscribe()
  }
  subscription = app.auth.actor.subscribe({ complete: () => stop() })
  return stop
}
