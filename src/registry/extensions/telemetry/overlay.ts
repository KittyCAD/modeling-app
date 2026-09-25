import { PATHS } from '@src/lib/paths'
import { defineAppNavigationIntent } from '@src/registry/contracts/appNavigation'
import { defineAppNavigationUrlContribution } from '@src/registry/contracts/appUrl'

export interface TelemetryOverlayState {
  readonly type: 'telemetry'
}

export const openTelemetryIntent = defineAppNavigationIntent<
  TelemetryOverlayState,
  undefined
>('telemetry.open')

export const telemetryNavigationUrlContribution =
  defineAppNavigationUrlContribution(openTelemetryIntent, {
    parse: ({ path }) =>
      path === PATHS.TELEMETRY
        ? ({ type: 'telemetry' } satisfies TelemetryOverlayState)
        : undefined,
    format: (_state: TelemetryOverlayState) => ({ path: PATHS.TELEMETRY }),
  })
