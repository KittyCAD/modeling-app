import type { App } from '@src/lib/app'
import type { Location, NavigateFunction } from 'react-router-dom'

import type { Command } from '@src/lib/commandTypes'
import { PATHS, webSafeJoin } from '@src/lib/paths'

export function createRouteCommands(
  app: App,
  navigate: NavigateFunction,
  location: Location,
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
      const path = webSafeJoin([
        location.pathname.includes(PATHS.FILE) ? filePath : PATHS.HOME,
        PATHS.TELEMETRY,
      ])
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
      // Over a project, settings opens on the project tab. Which place the app
      // is in is the app's own answer now, not something read back off a path.
      app.openSettings(
        location.pathname.includes(PATHS.FILE) ? { tab: 'project' } : undefined
      )
    },
  }

  return {
    RouteTelemetryCommand,
    RouteHomeCommand,
    RouteSettingsCommand,
  }
}
