import type { KclManager } from '@src/lang/KclManager'
import {
  getSelectedSketchTarget,
  isCursorInFunctionDefinition,
} from '@src/lang/queryAst'
import { isCursorInSketchCommandRange } from '@src/lang/util'
import type { Command } from '@src/lib/commandTypes'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { selectSketchPlane } from '@src/lib/selectSketchPlane'
import type { UserFeaturesService } from '@src/machines/userFeaturesMachine'
import type {
  ModelingMachineEvent,
  modelingMachine,
} from '@src/machines/modelingMachine'
import { constraintToolMetadata } from '@src/machines/sketchSolve/constraints/constraintMetadata'
import {
  type EquipTool,
  isSketchBlockSelected,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import type { ConstraintToolName } from '@src/machines/sketchSolve/tools/constraintToolModel'
import {
  MODE_MODELING_COMMAND_SCOPE,
  MODE_SKETCH_NO_FACE_COMMAND_SCOPE,
  MODE_SKETCH_SOLVE_COMMAND_SCOPE,
  MODE_SKETCHING_COMMAND_SCOPE,
} from '@src/registry/contracts/commands'
import { TOOLBAR_COMMAND_IDS } from '@src/registry/extensions/commands/toolbarCommandIds'
import type { StateFrom } from 'xstate'

const TOOLBAR_COMMAND_GROUP_ID = 'toolbar'

export { TOOLBAR_COMMAND_IDS }

type ModelingState = StateFrom<typeof modelingMachine>

type ToolbarCommandConfig = {
  id: string
  displayName: string
  description: string
  icon?: Command['icon']
  scopes: Command['scopes']
  onSubmit: Command['onSubmit']
}

type SketchSolveToolCommand = {
  id: string
  displayName: string
  description: string
  icon?: Command['icon']
  tool: EquipTool
  experimental?: boolean
}

type SketchSolveConstraintToolCommand = Pick<
  SketchSolveToolCommand,
  'id' | 'icon'
> & {
  tool: ConstraintToolName
}

type SketchSolveActionCommand = {
  id: string
  displayName: string
  description: string
  icon?: Command['icon']
  event: Extract<
    ModelingMachineEvent,
    {
      type: 'Dimension' | 'construction'
    }
  >['type']
}

const createToolbarCommand = ({
  id,
  displayName,
  description,
  icon,
  scopes,
  onSubmit,
}: ToolbarCommandConfig): Command => ({
  id,
  name: id,
  groupId: TOOLBAR_COMMAND_GROUP_ID,
  displayName,
  description,
  icon,
  scopes,
  hideFromSearch: true,
  needsReview: false,
  onSubmit,
})

/** Shared command definitions use the current project editor at submission time. */
export function createToolbarCommands(
  getExecutingEditor: () => KclManager | undefined,
  getUserFeatures: () => UserFeaturesService | undefined = () => undefined
): readonly Command[] {
  function hasSketchExperimentalFeatures(): boolean {
    return (
      getUserFeatures()?.has(EXPERIMENTAL_POINT_AND_CLICK_FLAG, false) ?? false
    )
  }

  function getModelingState(): ModelingState | undefined {
    return getExecutingEditor()?.modelingState ?? undefined
  }

  function sendModelingEvent(event: ModelingMachineEvent): true | Error {
    const kclManager = getExecutingEditor()

    if (!kclManager?.modelingState) {
      return new Error('No active modeling context')
    }

    kclManager.sendModelingEvent(event)
    return true
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
      scopes: [MODE_SKETCH_SOLVE_COMMAND_SCOPE],
      onSubmit: () => {
        if (experimental && !hasSketchExperimentalFeatures()) {
          return
        }

        return toggleSketchSolveTool(tool)
      },
    })
  }

  function createSketchSolveConstraintToolCommand({
    id,
    icon,
    tool,
  }: SketchSolveConstraintToolCommand): Command {
    const metadata = constraintToolMetadata[tool]

    return createSketchSolveToolCommand({
      id,
      displayName: metadata.title,
      description: metadata.description,
      icon,
      tool,
    })
  }

  function toggleSketchSolveTool(tool: EquipTool) {
    const state = getModelingState()
    if (!state?.matches('sketchSolveMode')) {
      return
    }

    return sendModelingEvent(
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
      scopes: [MODE_SKETCH_SOLVE_COMMAND_SCOPE],
      onSubmit: () => sendModelingEvent({ type: event }),
    })
  }

  async function enterSketch() {
    const kclManager = getExecutingEditor()
    if (!kclManager?.modelingState) {
      return new Error('No active modeling context')
    }

    const path = kclManager.path
    const wasmInstance = await kclManager.wasmInstancePromise
    if (getExecutingEditor() !== kclManager || kclManager.path !== path) return
    const state = kclManager.modelingState
    if (!state) return new Error('No active modeling context')
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

    // Legacy KCL 1.0 sketch editing is no longer supported.
    if (kclManager.editorView.hasFocus && sketchPathId && !isSketchBlock) {
      return
    }
    if (isSketchBlock) {
      return sendModelingEvent({ type: 'Enter sketch' })
    }

    if (!selectedSketchTarget) {
      return sendModelingEvent({
        type: 'Enter sketch',
        data: { forceNewSketch: true },
      })
    }

    const result = sendModelingEvent({
      type: 'Enter sketch',
      data: {
        forceNewSketch: true,
        keepDefaultPlaneVisibility: true,
      },
    })

    if (result instanceof Error) {
      return result
    }

    void selectSketchPlane(selectedSketchTarget, kclManager)

    return result
  }

  function exitSketch() {
    const state = getModelingState()

    if (state?.matches('Sketch') || state?.matches('Sketch no face')) {
      return sendModelingEvent({ type: 'Cancel' })
    }

    if (state?.matches('sketchSolveMode')) {
      return sendModelingEvent({ type: 'Exit sketch' })
    }
  }

  return [
    createToolbarCommand({
      id: TOOLBAR_COMMAND_IDS.modeling.sketch,
      displayName: 'Start or edit sketch',
      description: 'Start drawing a 2D sketch.',
      icon: 'sketch',
      scopes: [MODE_MODELING_COMMAND_SCOPE],
      onSubmit: enterSketch,
    }),
    createToolbarCommand({
      id: TOOLBAR_COMMAND_IDS.sketching.exit,
      displayName: 'Exit sketch',
      description: 'Exit the current sketch.',
      icon: 'arrowShortLeft',
      scopes: [MODE_SKETCHING_COMMAND_SCOPE, MODE_SKETCH_NO_FACE_COMMAND_SCOPE],
      onSubmit: exitSketch,
    }),
    createToolbarCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.exit,
      displayName: 'Exit sketch',
      description: 'Exit the current sketch.',
      icon: 'arrowShortLeft',
      scopes: [MODE_SKETCH_SOLVE_COMMAND_SCOPE],
      onSubmit: () => sendModelingEvent({ type: 'Exit sketch' }),
    }),
    createToolbarCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.cancel,
      displayName: 'Cancel sketch solve action',
      description: 'Cancel the active sketch solve action.',
      scopes: [MODE_SKETCH_SOLVE_COMMAND_SCOPE],
      onSubmit: () => sendModelingEvent({ type: 'Cancel' }),
    }),
    createToolbarCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.toolPicker,
      displayName: 'Pick hovered sketch tool',
      description:
        'Equip the sketch tool matching the object under the cursor.',
      scopes: [MODE_SKETCH_SOLVE_COMMAND_SCOPE],
      onSubmit: () => sendModelingEvent({ type: 'pick hovered tool' }),
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
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.coincident,
      icon: 'coincident',
      tool: 'coincidentConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.midpoint,
      icon: 'midpoint',
      tool: 'midpointConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.tangent,
      icon: 'tangent',
      tool: 'tangentConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.parallel,
      icon: 'parallel',
      tool: 'parallelConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.perpendicular,
      icon: 'perpendicular',
      tool: 'perpendicularConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.equal,
      icon: 'equal',
      tool: 'equalLengthConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.symmetric,
      icon: 'symmetric',
      tool: 'symmetricConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.vertical,
      icon: 'vertical',
      tool: 'verticalConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.horizontal,
      icon: 'horizontal',
      tool: 'horizontalConstraintTool',
    }),
    createSketchSolveConstraintToolCommand({
      id: TOOLBAR_COMMAND_IDS.sketchSolve.fixed,
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
      id: TOOLBAR_COMMAND_IDS.sketchSolve.construction,
      displayName: 'Construction',
      description: 'Toggle construction geometry on selected segments.',
      icon: 'construction',
      event: 'construction',
    }),
  ]
}
