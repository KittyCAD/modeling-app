import { Command } from '../commandTypes'
import { PATHS } from 'lib/paths'

export function createRouteCommands(navigate, location, filePath) {
  const RouteTelemetryCommand: Command = {
    name: 'Go to Telemetry',
    displayName: `Go to Telemetry`,
    description: 'View the Telemetry metrics',
    groupId: 'routes',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const path = location.pathname.includes(PATHS.FILE)
        ? filePath + PATHS.TELEMETRY + '?tab=project'
        : PATHS.HOME + PATHS.TELEMETRY
      navigate(path)
    },
  }

  return RouteTelemetryCommand
}
