import type { Feature } from '@kittycad/lib'
import { effect } from '@preact/signals-core'
import { reportRejection } from '@src/lib/trap'
import type { UserFeaturesService } from '@src/machines/userFeaturesMachine'
import { observations as userFeaturesObservations } from '@src/registry/contracts/userFeatures'
import {
  factory as defineFactory,
  contribute,
  Facet,
  type Extension,
  type Factory,
  slot,
  provide,
  service,
  type Registry,
} from 'plankton'

export const PROJECT_SHELL_FEATURE =
  'zds_project_shell_refactor' satisfies Feature

export function hasProjectShellFeature(
  features: UserFeaturesService | undefined
): boolean {
  return features?.has(PROJECT_SHELL_FEATURE, false) ?? false
}

const projectShellUpdates = service<{ settled: () => Promise<void> }>(
  'project-shell.updates'
)

/** Gates share one queue; routes wait for its completed publications and cleanup. */
const replacements = defineFactory({
  create: () => {
    let pending = Promise.resolve()
    return {
      exports: (replace: () => Promise<void>) => {
        const next = pending.then(replace)
        pending = next.catch(() => {})
        return next
      },
      items: [
        provide(projectShellUpdates, {
          settled: async () => {
            let current: Promise<void>
            do {
              current = pending
              await current
            } while (current !== pending)
          },
        }),
      ],
    }
  },
})

/** Cancellation stops the route's wait, while the registry still completes its cleanup. */
export async function waitForProjectShellSettled(
  registry: Registry,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const updates = registry.optional(projectShellUpdates)
  if (!updates) return
  let onAbort = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    signal.throwIfAborted()
    await Promise.race([updates.settled(), aborted])
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Install an Extension only while the default-off project-shell flag is granted. */
export function withProjectShellFeature(item: Extension, id: string): Factory {
  const content = slot([])
  const installed = new Facet(
    `${id}.installed`,
    (values: readonly boolean[]) => values.length > 0
  )
  return defineFactory({
    dependencies: { userFeatures: userFeaturesObservations, replacements },
    key: `${id}.feature-gate`,
    create: ({ userFeatures: userFeaturesInputs, replacements }, scope) => {
      let disposed = false
      let active = false
      const mounted = scope.observe(installed)
      return {
        // Replacements wait for earlier revocation cleanup and this reconciliation.
        start: () =>
          effect(() => {
            // Publication removes this marker before child cleanup runs. Do not
            // queue a revocation for a gate that is itself being unmounted.
            if (!mounted.value) return
            const enabled = hasProjectShellFeature(
              userFeaturesInputs.userFeaturesService.current.value
            )
            if (active === enabled) return
            active = enabled
            void replacements(() =>
              disposed || !mounted.value
                ? Promise.resolve()
                : scope.replace(content, enabled ? [item] : [])
            ).catch(reportRejection)
          }),
        items: [contribute(installed, () => true), content],
        dispose: () => {
          disposed = true
        },
      }
    },
  })
}
