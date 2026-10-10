import { withProjectSubRoute } from '@src/lib/projectNavigation'
import type { Location, NavigateFunction } from 'react-router-dom'

import type { Command } from '@src/lib/commandTypes'
import { PATHS } from '@src/lib/paths'

export function createRouteCommands(
  navigate: NavigateFunction,
  _location: Location,
  filePath: string,
  scopes: Command['scopes']
) {
  const RouteTelemetryCommand: Command = {
    scopes,
    name: 'Go to Telemetry',
    displayName: `Go to Telemetry`,
    description: 'View the Telemetry metrics',
    groupId: 'routes',
    icon: 'settings',
    needsReview: false,
    onSubmit: (_data) => {
      const path = withProjectSubRoute(filePath || PATHS.HOME, PATHS.TELEMETRY)
      void navigate(path)
    },
  }

  const RouteHomeCommand: Command = {
    scopes,
    name: 'Go to Home',
    displayName: `Go to Home`,
    description: 'Go to the home page',
    groupId: 'routes',
    icon: 'settings',
    needsReview: false,
    onSubmit: (_data) => {
      void navigate(PATHS.HOME)
    },
  }

  const RouteSettingsCommand: Command = {
    scopes,
    name: 'Go to Settings',
    displayName: `Go to Settings`,
    description: 'Go to the settings page',
    groupId: 'routes',
    icon: 'settings',
    needsReview: false,
    onSubmit: (_data) => {
      void navigate(
        withProjectSubRoute(filePath || PATHS.HOME, PATHS.SETTINGS_PROJECT)
      )
    },
  }

  return {
    RouteTelemetryCommand,
    RouteHomeCommand,
    RouteSettingsCommand,
  }
}
