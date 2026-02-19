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
import { useApp, useSingletons } from '@src/lib/boot'
import { type IndexLoaderData } from '@src/lib/types'
import { modelingMenuCallbackMostActions } from '@src/menu/register'
import { createStandardViewsCommands } from '@src/lib/commandBarConfigs/standardViewsConfig'
import type { SaveSettingsPayload } from '@src/lib/settings/settingsTypes'
import { reportRejection } from '@src/lib/trap'
import { getOppositeTheme, getResolvedTheme } from '@src/lib/theme'
import type { SnapshotFrom } from 'xstate'
import {
  getOnlySettingsFromContext,
  type SettingsActorType,
} from '@src/machines/settingsMachine'
import { getAllCurrentSettings } from '@src/lib/settings/settingsUtils'

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
  const { auth, commands, settings, lastSettings } = useApp()
  const {
    engineCommandManager,
    kclManager,
    rustContext,
    sceneInfra,
    systemIOActor,
    sceneEntitiesManager,
  } = useSingletons()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const navigate = useNavigate()
  const location = useLocation()
  const token = auth.useToken()
  const settingsValues = settings.useSettings()
  const settingsActor = settings.actor
  const projectData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const { project, file } = projectData

  const filePath = useAbsoluteFilePath()

  useEffect(() => {
    const {
      createNamedViewCommand,
      deleteNamedViewCommand,
      loadNamedViewCommand,
    } = createNamedViewsCommand(engineCommandManager, settingsActor)

    const {
      topViewCommand,
      frontViewCommand,
      rightViewCommand,
      backViewCommand,
      bottomViewCommand,
      leftViewCommand,
      zoomToFitCommand,
    } = createStandardViewsCommands(engineCommandManager)

    const namedViewCommands = [
      createNamedViewCommand,
      deleteNamedViewCommand,
      loadNamedViewCommand,
      topViewCommand,
      frontViewCommand,
      rightViewCommand,
      backViewCommand,
      bottomViewCommand,
      leftViewCommand,
      zoomToFitCommand,
    ]
    commands.send({
      type: 'Add commands',
      data: {
        commands: namedViewCommands,
      },
    })
    return () => {
      // Remove commands if you go to the home page
      commands.send({
        type: 'Remove commands',
        data: {
          commands: namedViewCommands,
        },
      })
    }
  }, [commands, engineCommandManager, settingsActor])

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
    commands.send({
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
      commands.send({
        type: 'Add commands',
        data: {
          commands: [RouteTelemetryCommand, RouteSettingsCommand],
        },
      })
    } else if (location.pathname.includes(PATHS.FILE)) {
      commands.send({
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

  const cb = modelingMenuCallbackMostActions({
    authActor: auth.actor,
    commandBarActor: commands.actor,
    engineCommandManager,
    filePath,
    kclManager,
    navigate,
    sceneInfra,
    settings: settingsValues,
    settingsActor,
  })
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
          settingsValues.modeling.defaultUnit.current ??
          DEFAULT_DEFAULT_LENGTH_UNIT,
      },
      specialPropsForInsertCommand: { providedOptions },
      project,
      rustContext,
      systemIOActor,
      wasmInstance,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager, project, file])

  useEffect(() => {
    commands.send({
      type: 'Add commands',
      data: { commands: kclCommandMemo },
    })

    return () => {
      commands.send({
        type: 'Remove commands',
        data: { commands: kclCommandMemo },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, @typescript-eslint/unbound-method -- TODO: blanket-ignored fix me!
  }, [commands.send, kclCommandMemo])

  // Subscribe to the settings to perform effects on the editor, stream, and other systems.
  // TODO: pass in the settings as a dependency to these systems so that this is unnecessary,
  // and they just have the values they need.
  useEffect(() => {
    const onSettingsUpdate = (snapshot: SnapshotFrom<SettingsActorType>) => {
      const { context } = snapshot

      // Update line wrapping
      const newWrapping = context.textEditor.textWrapping.current
      if (newWrapping !== lastSettings.value?.textEditor.textWrapping) {
        kclManager.setEditorLineWrapping(newWrapping)
      }

      // Update engine highlighting
      const newHighlighting = context.modeling.highlightEdges.current
      if (newHighlighting !== lastSettings.value?.modeling.highlightEdges) {
        engineCommandManager
          .setHighlightEdges(newHighlighting)
          .catch(reportRejection)
      }

      // Update cursor blinking
      const newBlinking = context.textEditor.blinkingCursor.current
      if (newBlinking !== lastSettings.value?.textEditor.blinkingCursor) {
        document.documentElement.style.setProperty(
          `--cursor-color`,
          newBlinking ? 'auto' : 'transparent'
        )
        kclManager.setCursorBlinking(newBlinking)
      }

      // Update theme
      const newTheme = context.app.theme.current
      if (newTheme !== lastSettings.value?.app.theme) {
        const resolvedTheme = getResolvedTheme(newTheme)
        const opposingTheme = getOppositeTheme(newTheme)
        sceneInfra.theme = opposingTheme
        sceneEntitiesManager.updateSegmentBaseColor(opposingTheme)
        kclManager.setEditorTheme(resolvedTheme)
        engineCommandManager.setTheme(newTheme).catch(reportRejection)
      }

      // Execute AST
      try {
        const relevantSetting = (s: SaveSettingsPayload | undefined) => {
          const hasScaleGrid =
            s?.modeling.showScaleGrid !== context.modeling.showScaleGrid.current
          const hasHighlightEdges =
            s?.modeling?.highlightEdges !==
            context.modeling.highlightEdges.current
          return hasScaleGrid || hasHighlightEdges
        }

        const settingsIncludeNewRelevantValues = relevantSetting(
          lastSettings.value
        )

        // Unit changes requires a re-exec of code
        if (settingsIncludeNewRelevantValues) {
          kclManager.executeCode().catch(reportRejection)
        }
      } catch (e) {
        console.error('Error executing AST after settings change', e)
      }

      sceneInfra.camControls._setting_allowOrbitInSketchMode =
        context.app.allowOrbitInSketchMode.current

      const newCurrentProjection = context.modeling.cameraProjection.current
      if (
        sceneInfra.camControls &&
        !kclManager.modelingState?.matches('Sketch') &&
        newCurrentProjection !== sceneInfra.camControls.engineCameraProjection
      ) {
        sceneInfra.camControls.engineCameraProjection = newCurrentProjection
      }

      // TODO: Migrate settings to not be an XState actor so we don't need to save a snapshot
      // of the last settings to know if they've changed.
      lastSettings.value = getAllCurrentSettings(
        getOnlySettingsFromContext(context)
      )
    }

    const subscription = settingsActor.subscribe(onSettingsUpdate)

    return () => subscription.unsubscribe()
  }, [
    sceneEntitiesManager,
    kclManager,
    sceneInfra,
    engineCommandManager,
    lastSettings,
    settingsActor,
  ])

  return <div>{children}</div>
}

export default ModelingPageProvider
