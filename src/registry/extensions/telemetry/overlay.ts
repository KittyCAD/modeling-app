import { PATHS } from '@src/lib/paths'
import { defineAppOverlayContribution } from '@src/registry/contracts/appUrl'

export interface TelemetryOverlayState {
  readonly type: 'telemetry'
}

export const telemetryOverlayContribution = defineAppOverlayContribution({
  id: 'telemetry',
  parse: ({ path }) =>
    path === PATHS.TELEMETRY
      ? ({ type: 'telemetry' } satisfies TelemetryOverlayState)
      : undefined,
  format: (_state: TelemetryOverlayState) => ({ path: PATHS.TELEMETRY }),
})
