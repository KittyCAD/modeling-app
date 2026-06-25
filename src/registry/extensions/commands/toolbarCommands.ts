import type { KclManager } from '@src/lang/KclManager'
import {
  getSelectedSketchTarget,
  isCursorInFunctionDefinition,
} from '@src/lang/queryAst'
import { isCursorInSketchCommandRange } from '@src/lang/util'
import type { Command } from '@src/lib/commandTypes'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { selectSketchPlane } from '@src/lib/selectSketchPlane'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type {
  ModelingMachineEvent,
  modelingMachine,
} from '@src/machines/modelingMachine'
import type { SketchTool } from '@src/machines/modelingSharedTypes'
import {
  type EquipTool,
  isSketchBlockSelected,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { TOOLBAR_COMMAND_IDS } from '@src/registry/extensions/commands/toolbarCommandIds'
import type { StateFrom } from 'xstate'

const TOOLBAR_COMMAND_GROUP_ID = 'toolbar'
const SKETCH_TOOL_NONE: SketchTool = 'none'

export { TOOLBAR_COMMAND_IDS }

type ModelingState = StateFrom<typeof modelingMachine>
type ToolbarCommandSubmit = { context: CommandBarContext }

type ToolbarCommandConfig = {
  id: string
  displayName: string
  description: string
  icon?: Command['icon']
  onSubmit: Command['onSubmit']
}

type LegacySketchToolCommand = {
  id: string
  displayName: string
  description: string
  icon?: Command['icon']
  tool: SketchTool
  isActive: (state: ModelingState) => boolean
}

type SketchSolveToolCommand = {
  id: string
  displayName: string
  description: string
  icon?: Command['icon']
  tool: EquipTool
  experimental?: boolean
}

type SketchSolveActionCommand = {
  id: string
  displayName: string
  description: string
  icon?: Command['icon']
  event: Extract<
    ModelingMachineEvent,
    {
      type:
        | 'Dimension'
        | 'HorizontalDistance'
        | 'VerticalDistance'
        | 'construction'
    }
  >['type']
}

const createToolbarCommand = ({
  id,
  displayName,
  description,
  icon,
  onSubmit,
}: ToolbarCommandConfig): Command => ({
  id,
  name: id,
  groupId: TOOLBAR_COMMAND_GROUP_ID,
  displayName,
  description,
  icon,
  hideFromSearch: true,
  needsReview: false,
  onSubmit,
})

// Temporary adapter between registry commands and the pre-registry modeling
// runtime. Command submissions carry command bar context in `input`, including
// the active KclManager while we wait for KclManager/modelingMachine to become
// registry services. Once those services exist, toolbar commands should consume
// them directly and this helper layer can go away.
function getCommandBarContext(input: unknown): CommandBarContext | undefined {
  return input &&
    typeof input === 'object' &&
    'context' in input &&
    input.context &&
    typeof input.context === 'object'
    ? (input as ToolbarCommandSubmit).context
    : undefined
}

function getKclManager(input: unknown): KclManager | undefined {
  return getCommandBarContext(input)?.kclManager
}

function getUserFeatures(input: unknown): CommandBarContext['userFeatures'] {
  return getCommandBarContext(input)?.userFeatures
}

function hasSketchExperimentalFeatures(input: unknown): boolean {
  return (
    getUserFeatures(input)?.has(EXPERIMENTAL_POINT_AND_CLICK_FLAG, false) ??
    false
  )
}

function getModelingState(input: unknown): ModelingState | undefined {
  return getKclManager(input)?.modelingState ?? undefined
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

function createLegacySketchToolCommand({
  id,
  displayName,
  description,
  icon,
  tool,
  isActive,
}: LegacySketchToolCommand): Command {
  return createToolbarCommand({
    id,
    displayName,
    description,
    icon,
    onSubmit: (input) => {
      const state = getModelingState(input)
      if (!state || state.matches('Sketch no face')) {
        return
      }

      return sendModelingEvent(input, {
        type: 'change tool',
        data: { tool: isActive(state) ? SKETCH_TOOL_NONE : tool },
      })
    },
  })
}

function createSketchSolveToolCommand({
  id,
  displayName,
  description,
  icon,
  tool,
  experimental = false,
}: SketchSolveToolCommand): Command {
  return createToolbarCommand({
    id,
    displayName,
    description,
    icon,
    onSubmit: (input) => {
      if (experimental && !hasSketchExperimentalFeatures(input)) {
        return
      }

      return toggleSketchSolveTool(input, tool)
    },
  })
}

function toggleSketchSolveTool(input: unknown, tool: EquipTool) {
  const state = getModelingState(input)
  if (!state?.matches('sketchSolveMode')) {
    return
  }

  return sendModelingEvent(
    input,
    state.context.sketchSolveToolName === tool
      ? { type: 'unequip tool' }
      : { type: 'equip tool', data: { tool } }
  )
}

function createSketchSolveActionCommand({
  id,
  displayName,
  description,
  icon,
  event,
}: SketchSolveActionCommand): Command {
  return createToolbarCommand({
    id,
    displayName,
    description,
    icon,
    onSubmit: (input) => sendModelingEvent(input, { type: event }),
  })
}

async function enterSketch(input: unknown) {
  const kclManager = getKclManager(input)
  const state = kclManager?.modelingState
  if (!kclManager || !state) {
    return new Error('No active modeling context')
  }

  const wasmInstance = await kclManager.wasmInstancePromise
  const cursorSelection = state.context.selectionRanges.graphSelections[0]
  const sketchPathId = isCursorInFunctionDefinition(
    kclManager.ast,
    cursorSelection,
    wasmInstance
  )
    ? false
    : isCursorInSketchCommandRange(
        kclManager.artifactGraph,
        state.context.selectionRanges
      )
  const isSketchBlock = isSketchBlockSelected(
    state.context.selectionRanges,
    state.context.kclManager.artifactGraph
  )
  const selectedSketchTarget = getSelectedSketchTarget(
    state.context.selectionRanges
  )

  if ((kclManager.editorView.hasFocus && sketchPathId) || isSketchBlock) {
    return sendModelingEvent(input, { type: 'Enter sketch' })
  }

  if (!selectedSketchTarget) {
    return sendModelingEvent(input, {
      type: 'Enter sketch',
      data: { forceNewSketch: true },
    })
  }

  const result = sendModelingEvent(input, {
    type: 'Enter sketch',
    data: {
      forceNewSketch: true,
      keepDefaultPlaneVisibility: true,
    },
  })

  if (result instanceof Error) {
    return result
  }

  void selectSketchPlane(
    selectedSketchTarget,
    state.context.store.useSketchSolveMode?.current,
    kclManager
  )

  return result
}

function exitSketch(input: unknown) {
  const state = getModelingState(input)

  if (state?.matches('Sketch') || state?.matches('Sketch no face')) {
    return sendModelingEvent(input, { type: 'Cancel' })
  }

  if (state?.matches('sketchSolveMode')) {
    return sendModelingEvent(input, { type: 'Exit sketch' })
  }
}

function cancelLegacySketchTool(input: unknown) {
  const state = getModelingState(input)
  if (!state?.matches('Sketch') || state.matches({ Sketch: 'SketchIdle' })) {
    return
  }

  return sendModelingEvent(input, {
    type: 'change tool',
    data: { tool: SKETCH_TOOL_NONE },
  })
}

export const toolbarCommands: readonly Command[] = [
  createToolbarCommand({
    id: TOOLBAR_COMMAND_IDS.modeling.sketch,
    displayName: 'Start or edit sketch',
    description: 'Start drawing a 2D sketch.',
    icon: 'sketch',
    onSubmit: enterSketch,
  }),
  createToolbarCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.exit,
    displayName: 'Exit sketch',
    description: 'Exit the current sketch.',
    icon: 'arrowShortLeft',
    onSubmit: exitSketch,
  }),
  createToolbarCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.cancelTool,
    displayName: 'Cancel sketch tool',
    description: 'Cancel the active sketch tool.',
    onSubmit: cancelLegacySketchTool,
  }),
  createLegacySketchToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.line,
    displayName: 'Line',
    description: 'Start drawing straight lines.',
    icon: 'line',
    tool: 'line',
    isActive: (state) => state.matches({ Sketch: 'Line tool' }),
  }),
  createLegacySketchToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.threePointArc,
    displayName: 'Three-Point Arc',
    description: 'Draw a circular arc defined by three points.',
    icon: 'arc',
    tool: 'arcThreePoint',
    isActive: (state) => state.matches({ Sketch: 'Arc three point tool' }),
  }),
  createLegacySketchToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.tangentialArc,
    displayName: 'Tangential Arc',
    description: 'Start drawing an arc tangent to the current segment.',
    icon: 'arc',
    tool: 'tangentialArc',
    isActive: (state) => state.matches({ Sketch: 'Tangential arc to' }),
  }),
  createLegacySketchToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.circleCenter,
    displayName: 'Center Circle',
    description: 'Start drawing a circle from its center.',
    icon: 'circle',
    tool: 'circle',
    isActive: (state) => state.matches({ Sketch: 'Circle tool' }),
  }),
  createLegacySketchToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.circleThreePoints,
    displayName: '3-Point Circle',
    description: 'Draw a circle defined by three points.',
    icon: 'circle',
    tool: 'circleThreePoint',
    isActive: (state) => state.matches({ Sketch: 'Circle three point tool' }),
  }),
  createLegacySketchToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.cornerRectangle,
    displayName: 'Corner Rectangle',
    description: 'Start drawing a rectangle.',
    icon: 'rectangle',
    tool: 'rectangle',
    isActive: (state) => state.matches({ Sketch: 'Rectangle tool' }),
  }),
  createLegacySketchToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketching.centerRectangle,
    displayName: 'Center Rectangle',
    description: 'Start drawing a rectangle from its center.',
    icon: 'rectangle',
    tool: 'center rectangle',
    isActive: (state) => state.matches({ Sketch: 'Center Rectangle tool' }),
  }),
  createToolbarCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.exit,
    displayName: 'Exit sketch',
    description: 'Exit the current sketch.',
    icon: 'arrowShortLeft',
    onSubmit: (input) => sendModelingEvent(input, { type: 'Exit sketch' }),
  }),
  createToolbarCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.cancel,
    displayName: 'Cancel sketch solve action',
    description: 'Cancel the active sketch solve action.',
    onSubmit: (input) => sendModelingEvent(input, { type: 'Cancel' }),
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.line,
    displayName: 'Line',
    description: 'Start drawing straight lines.',
    icon: 'line',
    tool: 'lineTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.point,
    displayName: 'Point',
    description: 'Start drawing straight points.',
    icon: 'oneDot',
    tool: 'pointTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.spline,
    displayName: 'Spline',
    description: 'Draw a control-point spline.',
    icon: 'spline',
    tool: 'splineTool',
    experimental: true,
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.circleCenter,
    displayName: 'Center Circle',
    description: 'Draw a circle from a center point and radius.',
    icon: 'circle',
    tool: 'circleTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.centerArc,
    displayName: 'Center Arc',
    description: 'Draw an arc by center and two endpoints.',
    icon: 'arcCenter',
    tool: 'centerArcTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.threePointArc,
    displayName: '3-Point Arc',
    description: 'Draw an arc from start, end, and a third point.',
    icon: 'arc',
    tool: 'threePointArcTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.tangentialArc,
    displayName: 'Tangential Arc',
    description: 'Draw an arc tangent to an existing line endpoint.',
    icon: 'tangent',
    tool: 'tangentialArcTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.trim,
    displayName: 'Trim',
    description:
      'Draw a trimming line through parts of segments to be removed.',
    icon: 'trimTool',
    tool: 'trimTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.cornerRectangle,
    displayName: 'Corner Rectangle',
    description: 'Start drawing a rectangle.',
    icon: 'rectangle',
    tool: 'cornerRectTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.centerRectangle,
    displayName: 'Center Rectangle',
    description: 'Start drawing a rectangle from its center.',
    icon: 'rectangleCenter',
    tool: 'centerRectTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.angledRectangle,
    displayName: 'Angled Rectangle',
    description: 'Draw a rotated rectangle with three clicks.',
    icon: 'rectangleAngled',
    tool: 'angledRectTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.coincident,
    displayName: 'Coincident',
    description: 'Constrain points or curves to be coincident.',
    icon: 'coincident',
    tool: 'coincidentConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.midpoint,
    displayName: 'Midpoint',
    description: 'Constrain a point to lie at the midpoint of a selected line.',
    icon: 'midpoint',
    tool: 'midpointConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.tangent,
    displayName: 'Tangent',
    description:
      'Constrain a selected line and arc, or two arcs, to be tangent at their shared contact.',
    icon: 'tangent',
    tool: 'tangentConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.parallel,
    displayName: 'Parallel',
    description: 'Constrain lines or curves to be parallel.',
    icon: 'parallel',
    tool: 'parallelConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.perpendicular,
    displayName: 'Perpendicular',
    description: 'Constrain lines or curves to be perpendicular.',
    icon: 'perpendicular',
    tool: 'perpendicularConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.equal,
    displayName: 'Equal',
    description:
      'Constrain lines to have equal length, or arcs and circles to have equal radius.',
    icon: 'equal',
    tool: 'equalLengthConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.symmetric,
    displayName: 'Symmetric',
    description:
      'Constrain two points, two arc-like segments, or two lines to be symmetric across a selected axis line.',
    icon: 'symmetric',
    tool: 'symmetricConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.vertical,
    displayName: 'Vertical',
    description: 'Constrain lines to be vertical.',
    icon: 'vertical',
    tool: 'verticalConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.horizontal,
    displayName: 'Horizontal',
    description: 'Constrain lines to be horizontal.',
    icon: 'horizontal',
    tool: 'horizontalConstraintTool',
  }),
  createSketchSolveToolCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.fixed,
    displayName: 'Fixed',
    description: 'Lock selected points to their current x and y positions.',
    icon: 'fix',
    tool: 'fixedConstraintTool',
  }),
  createSketchSolveActionCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.dimension,
    displayName: 'Dimension',
    description:
      'Constrain distance between points, length of lines, or radius of arcs.',
    icon: 'dimension',
    event: 'Dimension',
  }),
  createSketchSolveActionCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.horizontalDistance,
    displayName: 'Horizontal Distance',
    description: 'Constrain horizontal distance between two points.',
    icon: 'horizontalDimension',
    event: 'HorizontalDistance',
  }),
  createSketchSolveActionCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.verticalDistance,
    displayName: 'Vertical Distance',
    description: 'Constrain vertical distance between two points.',
    icon: 'verticalDimension',
    event: 'VerticalDistance',
  }),
  createSketchSolveActionCommand({
    id: TOOLBAR_COMMAND_IDS.sketchSolve.construction,
    displayName: 'Construction',
    description: 'Toggle construction geometry on selected segments.',
    icon: 'construction',
    event: 'construction',
  }),
]
