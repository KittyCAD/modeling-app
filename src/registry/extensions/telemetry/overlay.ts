import { PATHS } from '@src/lib/paths'
import {
  defineAppNavigationIntent,
  defineAppNavigationIntentContribution,
} from '@src/registry/contracts/appNavigation'
import { defineAppNavigationUrlContribution } from '@src/registry/contracts/appUrl'

export interface OpenTelemetryInput {
  readonly type: 'telemetry'
}

export const openTelemetryIntent = defineAppNavigationIntent<
  OpenTelemetryInput,
  undefined
>('telemetry.open', { placement: 'additional' })

export const openTelemetryIntentContribution =
  defineAppNavigationIntentContribution(
    openTelemetryIntent,
    async () => undefined
  )

export const telemetryNavigationUrlContribution =
  defineAppNavigationUrlContribution(openTelemetryIntent, {
    parse: ({ path }) =>
      path === PATHS.TELEMETRY
        ? ({ type: 'telemetry' } satisfies OpenTelemetryInput)
        : undefined,
    format: (_state: OpenTelemetryInput) => ({ path: PATHS.TELEMETRY }),
  })
