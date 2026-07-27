import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import React, { use, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useSignals } from '@preact/signals-react/runtime'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useMenuListener } from '@src/hooks/useMenu'
import {
  type PendingFeatureTreeSourceSelection,
  updateOutsideEditorEvent,
} from '@src/lang/KclManager'
import { sourceRangeToUtf16 } from '@src/lang/errors'
import { useApp, useSingletons } from '@src/lib/boot'
import { createNamedViewsCommand } from '@src/lib/commandBarConfigs/namedViewsConfig'
import { createRouteCommands } from '@src/lib/commandBarConfigs/routeCommandConfig'
import { createStandardViewsCommands } from '@src/lib/commandBarConfigs/standardViewsConfig'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { kclCommands } from '@src/lib/kclCommands'
import { PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import { isArray } from '@src/lib/utils'
import { modelingMenuCallbackMostActions } from '@src/menu/register'

function isNumberArray(value: unknown): value is number[] {
  return isArray(value) && value.every((item) => typeof item === 'number')
}

function isPendingFeatureTreeSelection(
  value: unknown
): value is PendingFeatureTreeSourceSelection {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  if (!('path' in value) || typeof value.path !== 'string') {
    return false
  }

  if (
    !('range' in value) ||
    !isNumberArray(value.range) ||
    value.range.length !== 3
  ) {
    return false
  }

  return true
}

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
  useSignals()
  const { auth, commands, settings, project, systemIOActor } = useApp()
  const { kclManager } = useSingletons()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const navigate = useNavigate()
  const location = useLocation()
  const settingsValues = settings.useSettings()
  const settingsActor = settings.actor
  const projectIORef = project?.projectIORefSignal
  const file = project?.executingFileEntry.value
  const filePath = useAbsoluteFilePath()

  useEffect(() => {
    const {
      createNamedViewCommand,
      deleteNamedViewCommand,
      loadNamedViewCommand,
    } = createNamedViewsCommand(kclManager.engineCommandManager, settingsActor)

    const {
      topViewCommand,
      frontViewCommand,
      rightViewCommand,
      backViewCommand,
      bottomViewCommand,
      leftViewCommand,
      zoomToFitCommand,
    } = createStandardViewsCommands(kclManager)

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
  }, [commands, settingsActor, kclManager])

  useEffect(() => {
    markOnce('code/didLoadFile')
  }, [])

  useEffect(() => {
    const pending = kclManager.pendingFeatureTreeSourceSelection
    if (!pending || !file?.path) {
      return
    }

    if (!isPendingFeatureTreeSelection(pending)) {
      kclManager.pendingFeatureTreeSourceSelection = null
      return
    }

    if (pending.path !== file.path) {
      return
    }

    kclManager.pendingFeatureTreeSourceSelection = null

    const utf16Range = sourceRangeToUtf16(pending.range, kclManager.code)
    kclManager.editorView.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(utf16Range[0]),
      ]),
      effects: [
        EditorView.scrollIntoView(
          EditorSelection.range(utf16Range[0], utf16Range[1]),
          { y: 'center' }
        ),
      ],
      annotations: [updateOutsideEditorEvent],
    })
  }, [
    file?.path,
    kclManager,
    kclManager.code,
    kclManager.pendingFeatureTreeSourceSelection,
  ])

  // Due to the route provider, i've moved this to the ModelingPageProvider instead of CommandBarProvider
  // This will register the commands to route to Telemetry, Home, and Settings.
  useEffect(() => {
    if (file?.path === undefined) {
      return
    }

    const filePath = PATHS.FILE + '/' + encodeURIComponent(file?.path)

    const { RouteTelemetryCommand, RouteHomeCommand, RouteSettingsCommand } =
      createRouteCommands(navigate, location, filePath)
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
    return () => {
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
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [location])

  const cb = modelingMenuCallbackMostActions({
    authActor: auth.actor,
    commandBarActor: commands.actor,
    filePath,
    kclManager,
    navigate,
    settings: settingsValues,
    settingsActor,
    systemIOActor,
  })
  useMenuListener(cb)

  const kclCommandMemo = useMemo(() => {
    const providedOptions = []
    if (projectIORef?.value.children && file?.path) {
      const projectPath = projectIORef.value.path
      const filePath = file.path
      let children = structuredClone(projectIORef.value.children)
      while (children.length > 0) {
        const v = children.pop()
        if (!v) {
          continue
        }

        if (v.children) {
          children.push(...v.children)
          continue
        }

        const relativeFilePath = v.path.replace(projectPath + fsZds.sep, '')
        const isCurrentFile = v.path === filePath
        if (!isCurrentFile) {
          providedOptions.push({
            name: relativeFilePath.replaceAll(fsZds.sep, '/'),
            value: relativeFilePath.replaceAll(fsZds.sep, '/'),
          })
        }
      }
    }
    return kclCommands({
      projectData: {
        project: projectIORef?.value,
        file,
        code: project?.executingEditor.value?.state.doc.toString() ?? '',
      },
      kclManager,
      settings: {
        defaultUnit:
          settingsValues.modeling.defaultUnit.current ??
          DEFAULT_DEFAULT_LENGTH_UNIT,
      },
      specialPropsForInsertCommand: { providedOptions },
      project: projectIORef?.value,
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

  return <div>{children}</div>
}

export default ModelingPageProvider
