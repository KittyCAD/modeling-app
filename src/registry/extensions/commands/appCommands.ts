import { getAutomaticallyRenderEnabledFromSettings } from '@src/lib/automaticRendering'
import type { Command } from '@src/lib/commandTypes'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import {
  projectSearchFocusRequest,
  settingsSearchFocusRequest,
} from '@src/lib/searchFocusRequests'
import { selectAllInCurrentSketch } from '@src/lib/selections'
import { reportRejection } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { ModelingMachineEvent } from '@src/machines/modelingMachine'
import toast from 'react-hot-toast'

const APP_COMMAND_GROUP_ID = 'zds'

export const APP_COMMAND_IDS = Object.freeze({
  editor: {
    undo: 'zds.editor.undo',
    redo: 'zds.editor.redo',
    format: 'zds.editor.format',
    convertToVariable: 'zds.editor.convertToVariable',
    render: 'zds.editor.render',
  },
  modeling: {
    deleteSelection: 'zds.modeling.deleteSelection',
    centerCameraOnSelection: 'zds.modeling.centerCameraOnSelection',
    selectAllInCurrentSketch: 'zds.modeling.selectAllInCurrentSketch',
    toggleSnapToGrid: 'zds.modeling.toggleSnapToGrid',
  },
  view: {
    reset: 'zds.view.reset',
  },
  search: {
    focusProjects: 'zds.search.focusProjects',
    focusSettings: 'zds.search.focusSettings',
  },
} as const)

type CommandSubmitInput = {
  context?: CommandBarContext
}

function getCommandBarContext(input: unknown): CommandBarContext | undefined {
  return input &&
    typeof input === 'object' &&
    'context' in input &&
    input.context &&
    typeof input.context === 'object'
    ? (input as CommandSubmitInput).context
    : undefined
}

function getKclManager(input: unknown) {
  return getCommandBarContext(input)?.kclManager
}

function sendModelingEvent(
  input: unknown,
  event: ModelingMachineEvent
): true | Error {
  const kclManager = getKclManager(input)
  if (!kclManager?.modelingState) {
    return new Error('No active modeling context')
  }

  kclManager.sendModelingEvent(event)
  return true
}

function createAppCommand({
  id,
  displayName,
  onSubmit,
}: {
  id: string
  displayName: string
  onSubmit: Command['onSubmit']
}): Command {
  return {
    id,
    name: id,
    groupId: APP_COMMAND_GROUP_ID,
    displayName,
    hideFromSearch: true,
    needsReview: false,
    onSubmit,
  }
}

function deleteSelection(input: unknown) {
  const kclManager = getKclManager(input)
  const state = kclManager?.modelingState
  if (!kclManager || !state) {
    return new Error('No active modeling context')
  }

  if (state.matches('sketchSolveMode')) {
    kclManager.sendModelingEvent({ type: 'delete selected' })
    return
  }

  const segmentNodePaths = Object.keys(state.context.segmentOverlays)
  const selections = state.context.selectionRanges.graphSelections.filter(
    (selection) =>
      segmentNodePaths.includes(JSON.stringify(selection.codeRef.pathToNode))
  )
  const orderedSelections = selections.slice().sort((a, b) => {
    const aStart = a.codeRef.range?.[0] ?? 0
    const bStart = b.codeRef.range?.[0] ?? 0
    return bStart - aStart
  })

  kclManager.sendModelingEvent({
    type: 'Delete segments',
    data: orderedSelections.map((selection) => selection.codeRef.pathToNode),
  })

  if (
    state.context.selectionRanges.graphSelections.length > selections.length
  ) {
    kclManager.sendModelingEvent({ type: 'Delete selection' })
  }
}

function resetView(input: unknown) {
  const kclManager = getKclManager(input)
  if (!kclManager) {
    return new Error('No active modeling context')
  }

  return resetCameraPosition({
    sceneInfra: kclManager.sceneInfra,
    engineCommandManager: kclManager.engineCommandManager,
    settingsActor: kclManager.systemDeps.settings,
  })
}

function toggleSnapToGrid(input: unknown) {
  const kclManager = getKclManager(input)
  const settingsActor = kclManager?.systemDeps.settings
  if (!settingsActor) {
    return new Error('No active settings context')
  }

  settingsActor.send({
    type: 'set.modeling.snapToGrid',
    data: {
      level: 'project',
      value: !settingsActor.getSnapshot().context.modeling.snapToGrid.current,
    },
  })
}

function selectAllInCurrentSketchCommand(input: unknown) {
  const kclManager = getKclManager(input)
  if (!kclManager) {
    return
  }

  const selection = selectAllInCurrentSketch(
    kclManager.artifactGraph,
    kclManager.sceneEntitiesManager
  )
  return sendModelingEvent(input, {
    type: 'Set selection',
    data: { selectionType: 'completeSelection', selection },
  })
}

function reexecuteOrToastAutosaveBehavior(input: unknown) {
  const kclManager = getKclManager(input)
  if (!kclManager) {
    return new Error('No active editor context')
  }

  const automaticallyRenderEnabled = getAutomaticallyRenderEnabledFromSettings(
    kclManager.systemDeps.settings.getSnapshot().context
  )
  if (
    !automaticallyRenderEnabled &&
    kclManager.hasEditsSinceLastExecutionSignal.value
  ) {
    return kclManager.executeCode()
  }

  toast.success('Your work is auto-saved in real-time.')
}

export const appCommands: readonly Command[] = [
  createAppCommand({
    id: APP_COMMAND_IDS.editor.undo,
    displayName: 'Undo',
    onSubmit: (input) => getKclManager(input)?.undo(),
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.editor.redo,
    displayName: 'Redo',
    onSubmit: (input) => getKclManager(input)?.redo(),
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.editor.format,
    displayName: 'Format code',
    onSubmit: (input) => getKclManager(input)?.format().catch(reportRejection),
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.editor.convertToVariable,
    displayName: 'Convert to variable',
    onSubmit: (input) => getKclManager(input)?.convertToVariable(),
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.editor.render,
    displayName: 'Render code',
    onSubmit: reexecuteOrToastAutosaveBehavior,
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.modeling.deleteSelection,
    displayName: 'Delete selection',
    onSubmit: deleteSelection,
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.modeling.centerCameraOnSelection,
    displayName: 'Center camera on selection',
    onSubmit: (input) =>
      sendModelingEvent(input, { type: 'Center camera on selection' }),
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.modeling.selectAllInCurrentSketch,
    displayName: 'Select all in current sketch',
    onSubmit: selectAllInCurrentSketchCommand,
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.modeling.toggleSnapToGrid,
    displayName: 'Toggle snap to grid',
    onSubmit: toggleSnapToGrid,
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.view.reset,
    displayName: 'Reset view',
    onSubmit: resetView,
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.search.focusProjects,
    displayName: 'Focus project search',
    onSubmit: () => {
      projectSearchFocusRequest.value += 1
    },
  }),
  createAppCommand({
    id: APP_COMMAND_IDS.search.focusSettings,
    displayName: 'Focus settings search',
    onSubmit: () => {
      settingsSearchFocusRequest.value += 1
    },
  }),
]
