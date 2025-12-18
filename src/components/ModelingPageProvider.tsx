import React, { use, useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useRouteLoaderData } from 'react-router-dom'

import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useMenuListener } from '@src/hooks/useMenu'
import { createNamedViewsCommand } from '@src/lib/commandBarConfigs/namedViewsConfig'
import { createRouteCommands } from '@src/lib/commandBarConfigs/routeCommandConfig'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { kclCommands } from '@src/lib/kclCommands'
import { BROWSER_PATH, PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
} from '@src/lib/singletons'
import { useSettings, useToken } from '@src/lib/singletons'
import { commandBarActor } from '@src/lib/singletons'
import { type IndexLoaderData } from '@src/lib/types'
import { modelingMenuCallbackMostActions } from '@src/menu/register'

/**
 * FileMachineProvider moved to ModelingPageProvider.
 * This is a root provider for the modeling page to initialize any react code required for the run
 * time of the modeling page.
 */

export const ModelingPageProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const navigate = useNavigate()
  const location = useLocation()
  const token = useToken()
  const settings = useSettings()
  const projectData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const { project, file } = projectData

  const filePath = useAbsoluteFilePath()

  useEffect(() => {
    const {
      createNamedViewCommand,
      deleteNamedViewCommand,
      loadNamedViewCommand,
    } = createNamedViewsCommand(engineCommandManager)

    const commands = [
      createNamedViewCommand,
      deleteNamedViewCommand,
      loadNamedViewCommand,
    ]
    commandBarActor.send({
      type: 'Add commands',
      data: {
        commands,
      },
    })
    return () => {
      // Remove commands if you go to the home page
      commandBarActor.send({
        type: 'Remove commands',
        data: {
          commands,
        },
      })
    }
  }, [])

  useEffect(() => {
    markOnce('code/didLoadFile')
  }, [])

  // Due to the route provider, i've moved this to the ModelingPageProvider instead of CommandBarProvider
  // This will register the commands to route to Telemetry, Home, and Settings.
  useEffect(() => {
    const filePath =
      PATHS.FILE + '/' + encodeURIComponent(file?.path || BROWSER_PATH)
    const { RouteTelemetryCommand, RouteHomeCommand, RouteSettingsCommand } =
      createRouteCommands(navigate, location, filePath)
    commandBarActor.send({
      type: 'Remove commands',
      data: {
        commands: [
          RouteTelemetryCommand,
          RouteHomeCommand,
          RouteSettingsCommand,
        ],
      },
    })
    if (location.pathname === PATHS.HOME) {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: [RouteTelemetryCommand, RouteSettingsCommand],
        },
      })
    } else if (location.pathname.includes(PATHS.FILE)) {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: [
            RouteTelemetryCommand,
            RouteSettingsCommand,
            RouteHomeCommand,
          ],
        },
      })
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [location])

  const cb = modelingMenuCallbackMostActions(
    settings,
    navigate,
    filePath,
    engineCommandManager,
    sceneInfra
  )
  useMenuListener(cb)

  const kclCommandMemo = useMemo(() => {
    const providedOptions = []
    if (window.electron && project?.children && file?.path) {
      const projectPath = project.path
      const filePath = file.path
      let children = project.children
      while (children.length > 0) {
        const v = children.pop()
        if (!v) {
          continue
        }

        if (v.children) {
          children.push(...v.children)
          continue
        }

        const relativeFilePath = v.path.replace(
          projectPath + window.electron.sep,
          ''
        )
        const isCurrentFile = v.path === filePath
        if (!isCurrentFile) {
          providedOptions.push({
            name: relativeFilePath.replaceAll(window.electron.sep, '/'),
            value: relativeFilePath.replaceAll(window.electron.sep, '/'),
          })
        }
      }
    }
    return kclCommands({
      authToken: token ?? '',
      projectData,
      kclManager,
      settings: {
        defaultUnit:
          settings.modeling.defaultUnit.current ?? DEFAULT_DEFAULT_LENGTH_UNIT,
      },
      specialPropsForInsertCommand: { providedOptions },
      project,
      wasmInstance,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager, project, file])

  useEffect(() => {
    commandBarActor.send({
      type: 'Add commands',
      data: { commands: kclCommandMemo },
    })

    return () => {
      commandBarActor.send({
        type: 'Remove commands',
        data: { commands: kclCommandMemo },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [commandBarActor.send, kclCommandMemo])

  return <div>{children}</div>
}

export default ModelingPageProvider
