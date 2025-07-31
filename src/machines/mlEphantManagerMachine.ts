import { assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import { ACTOR_IDS } from '@src/machines/machineConstants'
import { S, transitions } from '@src/machines/utils'

import type { Selections } from '@src/lib/selections'
import type { Project } from '@src/lib/project'
import type { Prompt } from '@src/lib/prompt'
import { generateFakeSubmittedPrompt, PromptType } from '@src/lib/prompt'
import {
  textToCadMlConversations,
  IResponseMlConversations,
} from '@src/lib/textToCad'

const MLEPHANT_POLL_STATUSES_MS = 5000

export enum MlEphantManagerStates {
  NeedDependencies = 'need-dependencies',
  Setup = 'setup',
  Ready = 'ready',
  Background = 'background',
  Foreground = 'foreground',
}

export enum MlEphantManagerTransitions {
  SetApiToken = 'set-api-token',
  GetConversationsThatCreatedProjects = 'get-conversations-that-created-projects',
  GetPromptsBelongingToProject = 'get-prompts-belonging-to-project',
  GetPromptsPendingStatuses = 'get-prompts-pending-statuses',
  PromptEditModel = 'prompt-edit-model',
  PromptCreateModel = 'prompt-create-model',
  PromptRate = 'prompt-rate',
  // Note, technically hiding.
  PromptDelete = 'prompt-delete',
}

export type MlEphantManagerEvents =
  | {
      type: MlEphantManagerTransitions.SetApiToken
      token: string
    }
  | {
      type: MlEphantManagerTransitions.GetConversationsThatCreatedProjects
    }
  | {
      type: MlEphantManagerTransitions.GetPromptsBelongingToProject
      projectId: string
    }
  | {
      type: MlEphantManagerTransitions.PromptCreateModel
      projectForPromptOutput: Project
      prompt: string
    }
  | {
      type: MlEphantManagerTransitions.PromptEditModel
      projectForPromptOutput: Project
      prompt: string
      fileSelectedDuringPrompting: string
      projectFiles: Project[]
      selections: Selections
      artifactGraph: ArtifactGraph
    }
  | {
      type: MlEphantManagerTransitions.PromptRate
      promptId: string
    }
  | {
      type: MlEphantManagerTransitions.PromptDelete
      promptId: string
    }

// Used to specify a specific event in input properties
type XSEvent<T> = Extract<MlEphantManagerEvents, { type: T }>

export interface MlEphantManagerContext {
  apiTokenMlephant?: string

  conversations: IResponseMlConversations

  // A cache of prompts
  promptsPool: Map<Prompt['id'], Prompt>

  // Project related data is reset on project changes.
  // If no project is selected: undefined.
  promptsBelongingToProject?: Set<Prompt['id']>
  pageTokenPromptsBelongingToProject?: string

  // When prompts transition from in_progress to completed
  // NOTE TO SUBSCRIBERS! You must check the last event in combination with this
  // data to ensure it's from a status poll, and not some other event, that
  // update the context.
  promptsInProgressToCompleted: {
    promptsBelongingToProject: Set<Prompt['id']>
  }

  // Metadata per prompt that needs to be kept track separately.
  promptsMeta: Map<
    Prompt['id'],
    {
      // If it's a creation prompt, it'll run some SystemIO code that
      // creates a new project and other goodies.
      type: PromptType

      // Where the prompt's output should be placed on completion.
      project: Project

      // The file that was the "target" during prompting.
      targetFile: string
    }
  >
}

export const mlEphantDefaultContext = () => ({
  apiTokenMlephant: undefined,
  conversations: {
    items: [],
    next_page: undefined,
  },
  promptsPool: new Map(),
  promptsBelongingToProject: undefined,
  promptsInProgressToCompleted: {
    promptsBelongingToProject: [],
  },
  promptsMeta: new Map(),
  conversationsMeta: new Map(),
})

export const mlEphantManagerMachine = setup({
  types: {
    context: {} as MlEphantManagerContext,
    events: {} as MlEphantManagerEvents,
  },
  actors: {
    [MlEphantManagerTransitions.GetConversationsThatCreatedProjects]:
      fromPromise(async function (args: {
        input: {
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        const conversations: IResponseMlConversations =
          await textToCadMlConversations(context.apiTokenMlephant, {
            pageToken: context.conversations.next_page,
            limit: 20,
            sortBy: 'created_at',
          })

        const nextItems = context.conversations.items.concat(
          conversations.items
        )

        return {
          conversations: {
            items: nextItems,
            next_page: conversations.next_page,
          },
        }
      }),
    [MlEphantManagerTransitions.PromptCreateModel]: fromPromise(
      async function (args: {
        system: any
        input: {
          event: XSEvent<MlEphantManagerTransitions.PromptCreateModel>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        return new Promise((resolve) => {
          setTimeout(() => {
            // const response = await submitTextToCadCreateRequest(
            // prompt,
            // projectName,
            // token
            // )
            // project.conversationId = response.conversationId
            // writeToFile(project)

            const result = generateFakeSubmittedPrompt({ prompt: args.input.event.prompt })
            result.status = 'in_progress'

            const promptsPool = context.promptsPool
            const promptsBelongingToProject = new Set(
              context.promptsBelongingToProject
            )
            const promptsMeta = new Map(context.promptsMeta)

            promptsPool.set(result.id, result)
            promptsBelongingToProject.add(result.id)
            promptsMeta.set(result.id, {
              type: PromptType.Create,
              project: args.input.event.projectForPromptOutput,
            })

            resolve({
              promptsBelongingToProject,
              promptsMeta,
            })
          }, 1000)
        })
      }
    ),
    [MlEphantManagerTransitions.PromptEditModel]: fromPromise(
      async function (args: {
        system: any
        input: {
          event: XSEvent<MlEphantManagerTransitions.PromptEditModel>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        // const requestData = constructMultiFileIterationRequestWithPromptHelpers({
        //  // Need to implement, could be undefined if not created with text to cad.
        //   conversationId: project.conversationId,
        //   prompt,
        //   selections,
        //   projectFiles,
        //   token,
        //   artifactGraph,
        //   projectName,
        // })
        // const response = await submitTextToCadMultiFileIterationRequest(requestData, token)
        // if no conversation id:
        // project.conversationId = response.conversation_id
        // writeTofile(project)

        const result = generateFakeSubmittedPrompt({ prompt: args.input.event.prompt })
        result.status = 'in_progress'
        result.outputs = {
          'brake-caliper.kcl': `
          // Brake Caliper
// Brake calipers are used to squeeze the brake pads against the rotor, causing larger and larger amounts of friction depending on how hard the brakes are pressed.

// Set units
@settings(defaultLengthUnit = in, kclVersion = 1.0)

// Import parameters
import caliperTolerance, caliperPadLength, caliperThickness, caliperOuterEdgeRadius, caliperInnerEdgeRadius, rotorDiameter, rotorTotalThickness, yAxisOffset from "parameters.kcl"

// Sketch the brake caliper profile
brakeCaliperSketch = startSketchOn(XY)
  |> startProfile(at = [
       rotorDiameter / 2 + caliperTolerance,
       0
     ])
  |> line(end = [
       0,
       rotorTotalThickness + caliperTolerance - caliperInnerEdgeRadius
     ])
  |> tangentialArc(angle = 90, radius = caliperInnerEdgeRadius)
  |> line(end = [
       -caliperPadLength + 2 * caliperInnerEdgeRadius,
       0
     ])
  |> tangentialArc(angle = -90, radius = caliperInnerEdgeRadius)
  |> line(end = [
       0,
       caliperThickness - (caliperInnerEdgeRadius * 2)
     ])
  |> tangentialArc(angle = -90, radius = caliperInnerEdgeRadius)
  |> line(end = [
       caliperPadLength + caliperThickness - caliperOuterEdgeRadius - caliperInnerEdgeRadius,
       0
     ])
  |> tangentialArc(angle = -90, radius = caliperOuterEdgeRadius)
  |> line(end = [
       0,
       -2 * caliperTolerance - (2 * caliperThickness) - rotorTotalThickness + 2 * caliperOuterEdgeRadius
     ])
  |> tangentialArc(angle = -90, radius = caliperOuterEdgeRadius)
  |> line(end = [
       -caliperPadLength - caliperThickness + caliperOuterEdgeRadius + caliperInnerEdgeRadius,
       0
     ])
  |> tangentialArc(angle = -90, radius = caliperInnerEdgeRadius)
  |> line(end = [
       0,
       caliperThickness - (2 * caliperInnerEdgeRadius)
     ])
  |> tangentialArc(angle = -90, radius = caliperInnerEdgeRadius)
  |> line(end = [
       caliperPadLength - (2 * caliperInnerEdgeRadius),
       0
     ])
  |> tangentialArc(angle = 90, radius = caliperInnerEdgeRadius)
  |> close()

// Revolve the brake caliper sketch
revolve(brakeCaliperSketch, axis = Y, angle = -70)
  |> appearance(color = "#c82d2d", metalness = 90, roughness = 90)
          `,
          'car-rotor.kcl': `
          // Wheel rotor
// A component of a disc brake system. It provides a surface for brake pads to press against, generating the friction needed to slow or stop the vehicle.

// Set units
@settings(defaultLengthUnit = in, kclVersion = 1.0)

// Import parameters
import rotorDiameter, rotorInnerDiameter, rotorSinglePlateThickness, rotorInnerDiameterThickness, lugHolePatternDia, lugSpacing, rotorTotalThickness, spacerPatternDiameter, spacerDiameter, spacerLength, spacerCount, wheelDiameter, lugCount, yAxisOffset, drillAndSlotCount from "parameters.kcl"

rotorSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = rotorDiameter / 2)
rotor = extrude(rotorSketch, length = rotorSinglePlateThickness)
  |> appearance(color = "#dbcd70", roughness = 90, metalness = 90)

rotorBumpSketch = startSketchOn(rotor, face = END)
  |> circle(center = [0, 0], radius = rotorInnerDiameter / 2)
rotorBump = extrude(rotorBumpSketch, length = rotorInnerDiameterThickness)

lugHoles = startSketchOn(rotorBump, face = END)
  |> circle(center = [-lugSpacing / 2, 0], radius = 0.315)
  |> patternCircular2d(
       arcDegrees = 360,
       center = [0, 0],
       instances = lugCount,
       rotateDuplicates = true,
     )
  |> extrude(length = -(rotorInnerDiameterThickness + rotorSinglePlateThickness))
  |> appearance(color = "#dbcd70", roughness = 90, metalness = 90)

// (update when boolean is available)
centerSpacer = startSketchOn(rotor, face = START)
  |> circle(center = [0, 0], radius = .25)
  |> extrude(length = spacerLength)

secondaryRotorSketch = startSketchOn(centerSpacer, face = END)
  |> circle(center = [0, 0], radius = rotorDiameter / 2)
secondRotor = extrude(secondaryRotorSketch, length = rotorSinglePlateThickness)

lugHoles2 = startSketchOn(secondRotor, face = END)
  |> circle(center = [lugSpacing / 2, 0], radius = 0.315)
  |> patternCircular2d(
       arcDegrees = 360,
       center = [0, 0],
       instances = lugCount,
       rotateDuplicates = true,
     )
  |> extrude(length = -rotorSinglePlateThickness)

spacerSketch = startSketchOn(rotor, face = START)
  |> circle(center = [spacerPatternDiameter / 2, 0], radius = spacerDiameter)
  |> patternCircular2d(
       arcDegrees = 360,
       center = [0, 0],
       instances = spacerCount,
       rotateDuplicates = true,
     )
spacers = extrude(spacerSketch, length = spacerLength)

rotorSlottedSketch = startSketchOn(rotor, face = START)
  |> startProfile(at = [2.17, 2.56])
  |> xLine(length = 0.12)
  |> yLine(length = 2.56)
  |> xLine(length = -0.12)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> patternCircular2d(
       center = [0, 0],
       instances = drillAndSlotCount,
       arcDegrees = 360,
       rotateDuplicates = true,
     )
rotorSlotted = extrude(rotorSlottedSketch, length = -rotorSinglePlateThickness / 2)

secondRotorSlottedSketch = startSketchOn(secondRotor, face = END)
  |> startProfile(at = [-2.17, 2.56])
  |> xLine(length = -0.12)
  |> yLine(length = 2.56)
  |> xLine(length = 0.12)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> patternCircular2d(
       center = [0, 0],
       instances = drillAndSlotCount,
       arcDegrees = 360,
       rotateDuplicates = true,
     )

carRotor = extrude(secondRotorSlottedSketch, length = -rotorSinglePlateThickness / 2)
  |> appearance(color = "#dbcd70", roughness = 90, metalness = 90)
          `,
          'car-tire.kcl': `
          // Tire
// A tire is a critical component of a vehicle that provides the necessary traction and grip between the car and the road. It supports the vehicle's weight and absorbs shocks from road irregularities.

// Set units
@settings(defaultLengthUnit = in, kclVersion = 1.0)

// Import parameters
import tireInnerDiameter, tireOuterDiameter, tireDepth, bendRadius, tireTreadWidth, tireTreadDepth, tireTreadOffset from "parameters.kcl"

// Create the sketch of the tire
tireSketch = startSketchOn(XY)
  |> startProfile(at = [tireInnerDiameter / 2, tireDepth / 2])
  |> line(
       endAbsolute = [
         tireOuterDiameter / 2 - bendRadius,
         tireDepth / 2
       ],
       tag = $edge1,
     )
  |> tangentialArc(angle = -90, radius = bendRadius)
  |> line(endAbsolute = [
       tireOuterDiameter / 2,
       tireDepth / 2 - tireTreadOffset
     ])
  |> line(end = [-tireTreadDepth, 0])
  |> line(end = [0, -tireTreadWidth])
  |> line(end = [tireTreadDepth, 0])
  |> line(endAbsolute = [
       tireOuterDiameter / 2,
       -tireDepth / 2 + tireTreadOffset + tireTreadWidth
     ])
  |> line(end = [-tireTreadDepth, 0])
  |> line(end = [0, -tireTreadWidth])
  |> line(end = [tireTreadDepth, 0])
  |> line(endAbsolute = [
       tireOuterDiameter / 2,
       -tireDepth / 2 + bendRadius
     ])
  |> tangentialArc(angle = -90, radius = bendRadius)
  |> line(endAbsolute = [tireInnerDiameter / 2, -tireDepth / 2], tag = $edge2)
  |> close()

// Revolve the sketch to create the tire
carTire = revolve(tireSketch, axis = Y)
  |> appearance(color = "#0f0f0f", roughness = 80)
          `,
          'car-wheel.kcl': `
          // Car Wheel
// A sports car wheel with a circular lug pattern and spokes.

// Set units
@settings(defaultLengthUnit = in, kclVersion = 1.0)

// Import parameters
import lugCount, lugSpacing, offset, backSpacing, wheelWidth, wheelDiameter, spokeCount, spokeGap, spokeAngle, spokeThickness from "parameters.kcl"

// Create the wheel center
lugBase = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = (lugSpacing + 1.5) / 2)
  |> subtract2d(tool = circle(center = [0, 0], radius = (lugSpacing - 1.5) / 2))
  |> extrude(length = wheelWidth / 20)

// Extend the wheel center and bore holes to accomidate the lug heads
lugExtrusion = startSketchOn(lugBase, face = END)
  |> circle(center = [0, 0], radius = (lugSpacing + 1.5) / 2)
  |> subtract2d(tool = circle(center = [0, 0], radius = (lugSpacing - 1.5) / 2))
  |> extrude(length = wheelWidth / 10)

// Create the circular pattern for the lugs
lugClearance = startSketchOn(lugExtrusion, face = END)
  |> circle(center = [lugSpacing / 2, 0], radius = 1.2 / 2)
  |> patternCircular2d(
       arcDegrees = 360,
       center = [0, 0],
       instances = lugCount,
       rotateDuplicates = true,
     )
  |> extrude(length = -wheelWidth / 10)

// Create the circular pattern for the lug holes
lugHoles = startSketchOn(lugBase, face = END)
  |> circle(center = [lugSpacing / 2, 0], radius = 16mm / 2)
  |> patternCircular2d(
       arcDegrees = 360,
       center = [0, 0],
       instances = lugCount,
       rotateDuplicates = true,
     )
  |> extrude(length = -wheelWidth / 20)
  |> appearance(color = "#ffffff", metalness = 0, roughness = 0)

// Add detail to the wheel center by revolving curved edge profiles
wheelCenterInner = startSketchOn(XY)
  |> startProfile(at = [(lugSpacing - 1.5) / 2, 0])
  |> yLine(length = -wheelWidth / 10 - (wheelWidth / 20))
  |> bezierCurve(control1 = [-0.3, 0], control2 = [0, 0.3], end = [-0.4, 0.3])
  |> yLine(endAbsolute = 0)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> revolve(axis = Y)
  |> appearance(color = "#ffffff", metalness = 0, roughness = 0)

wheelCenterOuter = startSketchOn(XY)
  |> startProfile(at = [(lugSpacing + 1.5) / 2, 0])
  |> yLine(length = -wheelWidth / 10 - (wheelWidth / 20))
  |> bezierCurve(control1 = [0.3, 0], control2 = [0.2, -0.3], end = [0.4, -0.1])
  |> yLine(endAbsolute = -wheelWidth / 20)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> revolve(axis = Y)
  |> appearance(color = "#ffffff", metalness = 0, roughness = 0)

// Write a function that defines the spoke geometry, patterns and extrudes it
fn spoke(spokeGap, spokeAngle, spokeThickness) {
  // Seperating the spoke base planes
  plane001 = {
    origin = [0.0, 0.0, spokeGap / 2],
    xAxis = [1.0, 0.0, spokeAngle],
    yAxis = [0.0, 1.0, 0.0],
    zAxis = [0.0, 0.0, 1.0]
  }

  // Spoke cross sections
  spokeProfile = startSketchOn(plane001)
    |> startProfile(at = [(lugSpacing + 2) / 2, -0.7])
    |> bezierCurve(
         control1 = [
           (wheelDiameter - lugSpacing - 2.9) / 3.5,
           offset / 7
         ],
         control2 = [
           (wheelDiameter - lugSpacing - 2.9) / 4,
           offset / 1.5
         ],
         end = [
           (wheelDiameter - lugSpacing - 2.9) / 2,
           offset
         ],
       )
    |> yLine(length = -wheelWidth / 15)
    |> bezierCurve(
         control1 = [
           -(wheelDiameter - lugSpacing - 2.9) / 5,
           -offset / 7
         ],
         control2 = [
           -(wheelDiameter - lugSpacing - 2.9) / 5,
           -offset / 1.5
         ],
         end = [
           -(wheelDiameter - lugSpacing - 2.9) / 2,
           -offset
         ],
       )
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()

  // Circular pattern spokes
  spokePattern = extrude(spokeProfile, length = spokeThickness)
    |> patternCircular3d(
         axis = [0, 1, 0],
         center = [0, -2000, 0],
         instances = spokeCount,
         arcDegrees = 360,
         rotateDuplicates = true,
       )
    |> appearance(color = "#ffffff", metalness = 0, roughness = 0)
  return spokePattern
}

spoke(spokeGap = spokeGap, spokeAngle = spokeAngle, spokeThickness = spokeThickness)
spoke(spokeGap = -spokeGap, spokeAngle = -spokeAngle, spokeThickness = -spokeThickness)

// Define and revolve wheel exterior
startSketchOn(XY)
  |> startProfile(at = [
       wheelDiameter / 2,
       -wheelWidth + backSpacing + offset
     ])
  |> yLine(length = wheelWidth * 0.25)
  |> line(end = [-wheelWidth * 0.02, wheelWidth * 0.02])
  |> yLine(length = wheelWidth * 0.25)
  |> line(end = [wheelWidth * 0.02, wheelWidth * 0.02])
  |> yLine(endAbsolute = backSpacing + offset)
  |> line(end = [wheelWidth * 0.05, wheelWidth * .01])
  |> yLine(length = wheelWidth * 0.05)
  |> xLine(length = -wheelWidth * 0.03)
  |> yLine(length = -wheelWidth * 0.02)
  |> line(end = [-wheelWidth * 0.05, -wheelWidth * 0.01])
  |> yLine(length = -backSpacing * 0.7)
  |> line(end = [
       -wheelDiameter * 0.01,
       -wheelWidth * 0.02
     ])
  |> yLine(endAbsolute = offset - 0.2)
  |> line(end = [
       -wheelDiameter * 0.03,
       -wheelWidth * 0.02
     ])
  |> yLine(length = -wheelWidth * 0.02)
  |> line(end = [
       wheelDiameter * 0.03,
       -wheelWidth * 0.1
     ])
  |> yLine(length = -wheelWidth * 0.05)
  |> line(end = [wheelWidth * 0.02, -wheelWidth * 0.02])
  |> yLine(endAbsolute = -wheelWidth + backSpacing + offset - 0.28)
  |> line(end = [wheelWidth * 0.05, -wheelWidth * 0.01])
  |> yLine(length = -wheelWidth * 0.02)
  |> xLine(length = wheelWidth * 0.03)
  |> yLine(length = wheelWidth * 0.05)
  |> close()
  |> revolve(axis = Y)
  |> appearance(color = "#ffffff", metalness = 0, roughness = 0)
          `,
          'lug-nut.kcl':
          `
          // Lug Nut
// lug Nuts are essential components used to create secure connections, whether for electrical purposes, like terminating wires or grounding, or for mechanical purposes, such as providing mounting points or reinforcing structural joints.

// Set units
@settings(defaultLengthUnit = in, kclVersion = 1.0)

// Import parameters
import lugDiameter, lugHeadLength, lugThreadDiameter, lugLength, lugThreadDepth, lugSpacing from "parameters.kcl"

customPlane = {
  origin = { x = lugSpacing / 2, y = -30mm, z = 0 },
  xAxis = { x = 1, y = 0, z = 0 },
  yAxis = { x = 0, y = -1, z = 0 },
  zAxis = { x = 0, y = 0, z = 1 }
}

fn lug(plane, length, diameter) {
  lugSketch = startSketchOn(customPlane)
    |> startProfile(at = [0 + diameter / 2, 0])
    |> angledLine(angle = 70, lengthY = lugHeadLength)
    |> xLine(endAbsolute = lugDiameter / 2)
    |> yLine(endAbsolute = lugLength)
    |> tangentialArc(angle = 90, radius = 3mm)
    |> xLine(endAbsolute = 0 + .001, tag = $c1)
    |> yLine(endAbsolute = lugThreadDepth)
    |> xLine(endAbsolute = lugThreadDiameter)
    |> yLine(endAbsolute = 0)
    |> close()
    |> revolve(axis = Y)
    |> appearance(color = "#dbcd70", roughness = 90, metalness = 90)
  return lugSketch
}

lugNut = lug(plane = customPlane, length = lugLength, diameter = lugDiameter)
          `,
          'parameters.kcl':
          `
          // Car wheel assembly parameters

// Set units
@settings(defaultLengthUnit = in, kclVersion = 1.0)

// Car wheel
export lugCount = 5
export lugSpacing = 114.3mm
export offset = -35mm
export backSpacing = 6.38
export wheelWidth = 9.5
export wheelDiameter = 19
export spokeCount = 6
export spokeGap = 0.2
export spokeAngle = 0.02
export spokeThickness = 0.95

// Lug Nut
export lugDiameter = 24mm
export lugHeadLength = lugDiameter * .5
export lugThreadDiameter = lugDiameter / 2 * .85
export lugLength = 30mm
export lugThreadDepth = lugLength - 12.7mm

// Car rotor
export rotorDiameter = 12
export rotorInnerDiameter = 6
export rotorSinglePlateThickness = 0.25
export rotorInnerDiameterThickness = 0.5
export lugHolePatternDia = 3
export rotorTotalThickness = 1
export spacerPatternDiameter = 11
export spacerDiameter = 0.25
export spacerLength = rotorTotalThickness - (2 * rotorSinglePlateThickness)
export spacerCount = 16
export yAxisOffset = 0.5
export drillAndSlotCount = 5

// Car tire
export tireInnerDiameter = 19
export tireOuterDiameter = 24
export tireDepth = 11.02
export bendRadius = 1.6
export tireTreadWidth = 0.39
export tireTreadDepth = 0.39
export tireTreadOffset = 3.15

// Brake caliper
export caliperTolerance = 0.050
export caliperPadLength = 1.6
export caliperThickness = 0.39
export caliperOuterEdgeRadius = 0.39
export caliperInnerEdgeRadius = 0.12
          `,
          'main.kcl': `
// Car Wheel Assembly
// A car wheel assembly with a rotor, tire, and lug nuts.

// Set units
@settings(defaultLengthUnit = in, kclVersion = 1.0)

// Import parts
import "car-wheel.kcl" as carWheel
import "car-rotor.kcl" as carRotor
import "brake-caliper.kcl" as brakeCaliper
import "lug-nut.kcl" as lugNut
import "car-tire.kcl" as carTire

// Import parameters
import * from "parameters.kcl"

// Place the car rotor
carRotor
  |> translate(x = 0, y = 0.5, z = 0)

// Place the car wheel
carWheel

// Place the lug nuts
lugNut
  |> patternCircular3d(
       arcDegrees = 360,
       axis = [0, 1, 0],
       center = [0, 0, 0],
       instances = lugCount,
       rotateDuplicates = false,
     )

// Place the brake caliper
brakeCaliper
  |> translate(x = 0, y = 0.5, z = 0)

// Place the car tire
carTire
          `,
        }

        const promptsPool = context.promptsPool
        const promptsBelongingToProject = new Set(
          context.promptsBelongingToProject
        )
        const promptsMeta = new Map(context.promptsMeta)

        promptsPool.set(result.id, result)
        promptsBelongingToProject.add(result.id)
        promptsMeta.set(result.id, {
          type: PromptType.Edit,
          targetFile: args.input.event.fileSelectedDuringPrompting,
          project: args.input.event.projectForPromptOutput,
        })

        return {
          promptsBelongingToProject,
          promptsMeta,
        }
      }
    ),
    [MlEphantManagerTransitions.GetPromptsPendingStatuses]: fromPromise(
      async function (args: {
        input: {
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context

        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        return new Promise((resolve) => {
          setTimeout(() => {
            const promptsPool = context.promptsPool
            const promptsInProgressToCompleted = {
              promptsBelongingToProject: new Set(),
            }
            const promptsBelongingToProject = context.promptsBelongingToProject

            promptsPool.values().forEach((prompt) => {
              // Replace this with the actual request call.
              if (prompt.status !== ('in_progress' as any)) return
              prompt.status = 'completed'

              if (promptsBelongingToProject?.has(prompt.id)) {
                promptsInProgressToCompleted.promptsBelongingToProject.add(
                  prompt.id
                )
              }
            })

            resolve({
              promptsInProgressToCompleted,
            })
          }, 3000)
        })
      }
    ),
  },
}).createMachine({
  initial: MlEphantManagerStates.NeedDependencies,
  context: mlEphantDefaultContext(),
  states: {
    [MlEphantManagerStates.NeedDependencies]: {
      on: {
        [MlEphantManagerTransitions.SetApiToken]: {
          actions: [
            assign({
              apiTokenMlephant: ({ event }) => event.token,
            }),
          ],
          target: MlEphantManagerStates.Setup,
        },
      },
    },
    [MlEphantManagerStates.Setup]: {
      invoke: {
        input: (args: { context: MlEphantManagerContext }) => args,
        src: MlEphantManagerTransitions.GetConversationsThatCreatedProjects,
        onDone: {
          target: MlEphantManagerStates.Ready,
          actions: assign(({ event }) => event.output),
        },
        // On failure we need correct dependencies still.
        onError: { target: MlEphantManagerStates.NeedDependencies },
      },
    },
    [MlEphantManagerStates.Ready]: {
      type: 'parallel',
      states: {
        [MlEphantManagerStates.Background]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              after: {
                [MLEPHANT_POLL_STATUSES_MS]: {
                  target: MlEphantManagerTransitions.GetPromptsPendingStatuses,
                },
              },
            },
            [MlEphantManagerTransitions.GetPromptsPendingStatuses]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.GetPromptsPendingStatuses>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.GetPromptsPendingStatuses,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
          },
        },
        [MlEphantManagerStates.Foreground]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              // Reduces boilerplate. Lets you specify many transitions with
              // states of the same name.
              on: transitions([
                MlEphantManagerTransitions.GetConversationsThatCreatedProjects,
                MlEphantManagerTransitions.PromptCreateModel,
                MlEphantManagerTransitions.PromptEditModel,
              ]),
            },
            [MlEphantManagerTransitions.GetConversationsThatCreatedProjects]: {
              invoke: {
                input: (args) => ({
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.GetConversationsThatCreatedProjects,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
            [MlEphantManagerTransitions.PromptCreateModel]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.PromptCreateModel>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.PromptCreateModel,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
            [MlEphantManagerTransitions.PromptEditModel]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.PromptEditModel>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.PromptEditModel,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
          },
        },
      },
    },
  },
})

export type MlEphantManagerActor = ActorRefFrom<typeof mlEphantManagerMachine>
