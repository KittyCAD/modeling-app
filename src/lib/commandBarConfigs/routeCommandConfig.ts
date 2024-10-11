import { Command } from '../commandTypes'
import { PATHS } from 'lib/paths'
import { NavigateFunction, Location } from 'react-router-dom'
export function createRouteCommands(
  navigate: NavigateFunction,
  location: Location,
  filePath: string
) {
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

  const RouteHomeCommand: Command = {
    name: 'Go to Home',
    displayName: `Go to Home`,
    description: 'Go to the home page',
    groupId: 'routes',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      navigate(PATHS.HOME)
    },
  }

  const RouteSettingsCommand: Command = {
    name: 'Go to Settings',
    displayName: `Go to Settings`,
    description: 'Go to the settings page',
    groupId: 'routes',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const path = location.pathname.includes(PATHS.FILE)
        ? filePath + PATHS.SETTINGS + '?tab=project'
        : PATHS.HOME + PATHS.SETTINGS
      navigate(path)
    },
  }

  return { RouteTelemetryCommand, RouteHomeCommand, RouteSettingsCommand }
}
