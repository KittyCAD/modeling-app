import { attachDiscoveryCapture } from '@e2e/playwright/lib/interaction-discovery-reporter'
import type { Fixtures, PlaywrightTestArgs } from '@playwright/test'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'

const CHECKPOINT_INTERVAL_MS = 1_000
const COLLECTION_DEADLINE_MS = 2_000
const MAX_DOCUMENTS = 32

export interface DiscoveryDocument {
  timeOrigin: number
  profile: {
    browser: string
    reducedMotion: boolean
    width: number
    height: number
    scale: number
  }
  profileUnchangedAtCheckpoints: boolean
  finalSnapshot: boolean
  snapshot: InteractionSnapshot
}

export interface DiscoveryCapture {
  documents: DiscoveryDocument[]
  diagnostics: string[]
}

export interface InteractionDiscoveryFixtures {
  _interactionDiscovery: undefined
}

/** Compose into zoo-test only when PLAYWRIGHT_INTERACTION_DISCOVERY=1. */
export const interactionDiscoveryFixtures: Fixtures<
  InteractionDiscoveryFixtures,
  object,
  Pick<PlaywrightTestArgs, 'page'>
> = {
  _interactionDiscovery: [
    async ({ page }, use, testInfo) => {
      const documents: DiscoveryDocument[] = []
      const diagnostics = new Set<string>()
      let current: DiscoveryDocument | undefined
      let pending: Promise<void> | undefined
      let enabled = true

      const update = (document: DiscoveryDocument) => {
        if (!current || current.timeOrigin !== document.timeOrigin) {
          if (current)
            diagnostics.add('navigation-may-have-lost-uncheckpointed-inputs')
          current = document
          documents.push(document)
        } else {
          current.profileUnchangedAtCheckpoints &&=
            JSON.stringify(current.profile) === JSON.stringify(document.profile)
          current.snapshot = document.snapshot
          current.finalSnapshot = document.finalSnapshot
          if (!current.profileUnchangedAtCheckpoints)
            diagnostics.add('motion-or-viewport-changed-during-capture')
        }
      }

      const checkpoint = () => {
        if (!enabled) return Promise.resolve()
        // Bulk checkpoints stay single-flight even when the renderer is busy.
        return (pending ??= page
          .evaluate(
            async ({ timeOrigin, atLimit }) => {
              if (
                typeof PerformanceObserver === 'undefined' ||
                !PerformanceObserver.supportedEntryTypes.includes('event')
              ) {
                return { diagnostic: 'event-timing-unsupported' }
              }
              if (!window.app)
                return { diagnostic: 'app-not-ready-at-checkpoint' }
              const service = window.app.interactionPerformance
              if (!service) return { diagnostic: 'instrumentation-not-built' }
              if (performance.timeOrigin !== timeOrigin) {
                if (atLimit) return { diagnostic: 'document-limit-reached' }
                await service.start()
              }
              return {
                document: {
                  timeOrigin: performance.timeOrigin,
                  profile: {
                    browser: navigator.userAgent,
                    reducedMotion: matchMedia(
                      '(prefers-reduced-motion: reduce)'
                    ).matches,
                    width: innerWidth,
                    height: innerHeight,
                    scale: devicePixelRatio,
                  },
                  profileUnchangedAtCheckpoints: true,
                  finalSnapshot: false,
                  snapshot: service.snapshot(),
                },
              }
            },
            {
              timeOrigin: current?.timeOrigin ?? null,
              atLimit: documents.length >= MAX_DOCUMENTS,
            }
          )
          .then((result) => {
            if (!enabled) return
            if (result.document) update(result.document)
            if (result.diagnostic) {
              diagnostics.add(result.diagnostic)
              if (result.diagnostic !== 'app-not-ready-at-checkpoint')
                enabled = false
            }
          })
          .catch(() => {
            diagnostics.add('checkpoint-unavailable')
          })
          .finally(() => {
            pending = undefined
          }))
      }

      const bounded = async (operation: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            operation,
            new Promise<void>((resolve) => {
              timer = setTimeout(() => {
                diagnostics.add('collector-deadline-exceeded')
                resolve()
              }, COLLECTION_DEADLINE_MS)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }

      await bounded(checkpoint())
      const interval = enabled
        ? setInterval(() => {
            void checkpoint()
          }, CHECKPOINT_INTERVAL_MS)
        : undefined
      // A same-document route change keeps its recorder. Full navigations are
      // discovered at the next checkpoint; inputs before that restart can be lost.
      try {
        await use(undefined)
      } finally {
        enabled = false
        clearInterval(interval)
        const stop = page
          .evaluate(() => {
            const service = window.app?.interactionPerformance
            if (!service) return null
            return {
              timeOrigin: performance.timeOrigin,
              profile: {
                browser: navigator.userAgent,
                reducedMotion: matchMedia('(prefers-reduced-motion: reduce)')
                  .matches,
                width: innerWidth,
                height: innerHeight,
                scale: devicePixelRatio,
              },
              profileUnchangedAtCheckpoints: true,
              finalSnapshot: true,
              snapshot: service.stop(),
            }
          })
          .then((result) => {
            if (result && current?.timeOrigin === result.timeOrigin) {
              update(result)
            }
          })
          .catch(() => {
            diagnostics.add('final-snapshot-unavailable')
          })
        await bounded(Promise.all([pending, stop]))
        try {
          await attachDiscoveryCapture(testInfo, {
            documents,
            diagnostics: [...diagnostics],
          })
        } catch {
          console.warn('Interaction discovery attachment unavailable.')
        }
      }
    },
    // Collector setup and teardown must not consume the functional test's budget.
    { auto: true, timeout: 10_000 },
  ],
}
