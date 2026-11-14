import type { Feature } from '@kittycad/lib'
import { effect } from '@preact/signals-core'
import { reportRejection } from '@src/lib/trap'
import type { UserFeaturesService } from '@src/machines/userFeaturesMachine'
import { observations as userFeaturesObservations } from '@src/registry/contracts/userFeatures'
import {
  extension as defineExtension,
  contribute,
  Facet,
  type Item,
  type Extension,
  slot,
} from 'plankton'

export const PROJECT_SHELL_FEATURE =
  'zds_project_shell_refactor' satisfies Feature

export function hasProjectShellFeature(
  features: UserFeaturesService | undefined
): boolean {
  return features?.has(PROJECT_SHELL_FEATURE, false) ?? false
}

/** Install an Extension only while the default-off project-shell flag is granted. */
export function withProjectShellFeature(item: Item, id: string): Extension {
  const content = slot([])
  const installed = new Facet(
    `${id}.installed`,
    (values: readonly boolean[]) => values.length > 0
  )
  return defineExtension({
    dependencies: { userFeatures: userFeaturesObservations },
    key: `${id}.feature-gate`,
    create: ({ userFeatures: userFeaturesInputs }, scope) => {
      let disposed = false
      let active = false
      let stop: (() => void) | undefined
      let updates = Promise.resolve()
      const mounted = scope.observe(installed)
      // `effect` reads services immediately. Defer it until acquisition finishes;
      // queue replacements so a new grant waits for earlier revocation cleanup.
      void Promise.resolve()
        .then(() => {
          if (disposed) return
          stop = effect(() => {
            // Publication removes this marker before child cleanup runs. Do not
            // queue a revocation for a gate that is itself being unmounted.
            if (!mounted.value) return
            const enabled = hasProjectShellFeature(
              userFeaturesInputs.userFeaturesService.current.value
            )
            if (active === enabled) return
            active = enabled
            updates = updates
              .then(() =>
                disposed || !mounted.value
                  ? undefined
                  : scope.replace(content, enabled ? [item] : [])
              )
              .catch(reportRejection)
          })
        })
        .catch(reportRejection)
      return {
        items: [contribute(installed, () => true), content],
        dispose: () => {
          disposed = true
          stop?.()
        },
      }
    },
  })
}
