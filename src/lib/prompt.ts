import type { Models } from '@kittycad/lib'

export type Prompt = Models['TextToCad_type']

// export interface TextToCad_type {
//     code?: string;
//     completed_at?: string;
//     created_at: string;
//     error?: string;
//     feedback?: MlFeedback_type;
//     id: Uuid_type;
//     kcl_version?: string;
//     model: TextToCadModel_type;
//     model_version: string;
//     output_format: FileExportFormat_type;
//     outputs: {
//         [key: string]: string;
//     };
//     prompt: string;
//     started_at?: string;
//     status: ApiCallStatus_type;
//     updated_at: string;
//     user_id: Uuid_type;
// }
// export interface TextToCadCreateBody_type {
//     kcl_version?: string;
//     project_name?: string;
//     prompt: string;
// }
// export interface TextToCadIteration_type {
//     code: string;
//     completed_at?: string;
//     created_at: string;
//     error?: string;
//     feedback?: MlFeedback_type;
//     id: Uuid_type;
//     model: TextToCadModel_type;
//     model_version: string;
//     original_source_code: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
//     started_at?: string;
//     status: ApiCallStatus_type;
//     updated_at: string;
//     user_id: Uuid_type;
// }
// export interface TextToCadIterationBody_type {
//     kcl_version?: string;
//     original_source_code: string;
//     project_name?: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
// }
// export interface TextToCadMultiFileIteration_type {
//     completed_at?: string;
//     created_at: string;
//     error?: string;
//     feedback?: MlFeedback_type;
//     id: Uuid_type;
//     kcl_version?: string;
//     model: TextToCadModel_type;
//     model_version: string;
//     outputs: {
//         [key: string]: string;
//     };
//     project_name?: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
//     started_at?: string;
//     status: ApiCallStatus_type;
//     updated_at: string;
//     user_id: Uuid_type;
// }
// export interface TextToCadMultiFileIterationBody_type {
//     kcl_version?: string;
//     project_name?: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
// }
// export interface TextToCadResultsPage_type {
//     items: TextToCad_type[];
//     next_page?: string;
// }

const PROMPTS = [
  'Generate a step-by-step guide to design a parametric gear with adjustable tooth count.',
  'Explain how to model a hollow cylinder with internal threads using 3D modeling principles.',
  'Create a script to generate a customizable box with finger joints using parametric design.',
  'Suggest best practices for modeling an ergonomic handheld object in CAD.',
  'Convert this verbal sketch description into structured CAD modeling steps.',
  'Define geometric constraints for modeling a modular rail profile used in assembly systems.',
  'How do I design a 3D-printable snap-fit enclosure with proper tolerances?',
  'Generate geometry instructions for creating a ball-and-socket joint.',
  'Model a heat-dissipating structure suitable for passive cooling in electronic assemblies.',
]

export enum PromptType {
  Create = 'create',
  Edit = 'edit',
}

export const generateFakeSubmittedPrompt = (args = {}) => ({
  code: `

// Brake Rotor
// A 320mm vented brake disc (rotor), with straight vanes, 30mm thick. The disc bell should accommodate 5 M12 wheel studs on a 114.3mm pitch circle diameter.




@settings(defaultLengthUnit = mm)

// Define parameters.
dDisc = 320
dPitchCircle = 114.3
dBore = 64
nStuds = 5
dStudDrilling = 12.5 // M12
hFrictionSurface = 60
tDiscHalf = 10

// Vent parameters.
tVent = 10
wVent = 6
rVentFillet = 2
nVentBosses = 36

// Drilling parameters.
dDrillDia = 6
aBase = 90
aSweep = 30
nArcs = 12

// Bell parameters.
aDraftBell = 5
tBell = 5 // Wall thickness.
hBellAboveDiscFace = 40
hBellSubflush = 4
wUndercut = 8

fn drillHole(activeSketch, t) {
  // Sketch a vent hole at line parameter value t on an arc drawn across the disc surface.
  rInner = dDisc / 2 - hFrictionSurface
  rOuter = dDisc / 2

  aStart = aBase
  aEnd = aBase - aSweep

  // Linear interpolation of radius.
  rCurrent = rInner + t * (rOuter - rInner)

  // Linear interpolation of angle.
  aCurrent = aStart + t * (aEnd - aStart)

  // Calculate position.
  xCenter = rCurrent * cos(aCurrent)
  yCenter = rCurrent * sin(aCurrent)

  // Draw.
  drillCircle = circle(activeSketch, center = [xCenter, yCenter], radius = dDrillDia / 2)
  return drillCircle
}

fn createDiscHalf(plane, dDiscParam, hFrictionSurfaceParam, tDiscHalfParam) {
  // Create a disc half with a vent hole pattern.
  sketchFace = startSketchOn(plane)
  profileFace = circle(sketchFace, center = [0, 0], radius = dDiscParam / 2)
    |> subtract2d(tool = circle(sketchFace, center = [0, 0], radius = dDiscParam / 2 - hFrictionSurfaceParam))

  // Create three circles at t = 0, 0.5, and 1
  hole1 = drillHole(activeSketch = sketchFace, t = 0.2)
  hole2 = drillHole(activeSketch = sketchFace, t = 0.5)
  hole3 = drillHole(activeSketch = sketchFace, t = 0.8)

  // Pattern and cut.
  holes = patternCircular2d(
    [hole1, hole2, hole3],
    instances = nArcs,
    center = [0, 0],
    arcDegrees = 360,
    rotateDuplicates = true,
  )
  profileDrilled = subtract2d(profileFace, tool = holes)

  // Extrude.
  discHalf = extrude(profileFace, length = tDiscHalfParam)
  return discHalf
}

// ---------------------------------------------------------------------------------------------------------------------

// Create inboard half.
discInboard = createDiscHalf(
  plane = XY,
  dDiscParam = dDisc,
  hFrictionSurfaceParam = hFrictionSurface,
  tDiscHalfParam = tDiscHalf,
)

// Create vents.
planeVent = offsetPlane(XY, offset = tDiscHalf)
sketchVent = startSketchOn(planeVent)
profileVent = startProfile(sketchVent, at = [-wVent, dDisc / 2])
  |> angledLine(angle = 0, length = wVent, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = hFrictionSurface, tag = $seg02)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg03)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()

ventPad = extrude(profileVent, length = tVent)
  |> fillet(
       radius = rVentFillet,
       tags = [
         getCommonEdge(faces = [seg01, rectangleSegmentA001]),
         getCommonEdge(faces = [seg02, rectangleSegmentA001]),
         getCommonEdge(faces = [seg01, seg03]),
         getCommonEdge(faces = [seg03, seg02])
       ],
     )
ventSet = patternCircular3d(
  ventPad,
  instances = nVentBosses,
  axis = [0, 0, 1],
  center = [0, 0, tDiscHalf],
  arcDegrees = 360,
  rotateDuplicates = true,
)

// Create outboard half.
planeOutboard = offsetPlane(XY, offset = tDiscHalf + tVent)
discOutboard = createDiscHalf(
  plane = planeOutboard,
  dDiscParam = dDisc,
  hFrictionSurfaceParam = hFrictionSurface,
  tDiscHalfParam = tDiscHalf,
)

// Now create bell.
rCenter = dDisc / 2 - hFrictionSurface - wUndercut
rBore = dBore / 2
lDraftExterior = hBellAboveDiscFace / tan(90 - aDraftBell)
lDraftInterior = (hBellAboveDiscFace - tBell) / tan(90 - aDraftBell)

// Inner and outer radius of outboard face of disc bell.
rOuter = rCenter - lDraftExterior - rBore
rInner = rOuter + lDraftExterior - (tBell + lDraftInterior)

sketchDiscBell = startSketchOn(-YZ)
bodyDiscBell = startProfile(
       sketchDiscBell,
       at = [
         -dDisc / 2 + hFrictionSurface,
         tDiscHalf * 2 + tVent
       ],
     )
  |> arc(angleStart = -180, angleEnd = 0, radius = wUndercut / 2)
  |> line(end = [lDraftExterior, hBellAboveDiscFace])
  |> xLine(length = rOuter, tag = $seg04)
  |> yLine(length = -tBell)
  |> xLine(length = -rInner)
  |> line(end = [-lDraftInterior, -hBellAboveDiscFace])
  |> line(end = [0, -2]) // Wall thickness.
  |> xLine(length = -1 * (tBell + wUndercut))
  |> close()
  |> revolve(axis = Y)

// Drill lug holes.
sketchLugs = startSketchOn(bodyDiscBell, face = seg04)
profileStud = circle(sketchLugs, center = [0, dPitchCircle / 2], radius = dStudDrilling / 2)
  |> patternCircular2d(
       instances = nStuds,
       center = [0, 0],
       arcDegrees = 360,
       rotateDuplicates = true,
     )

clearance = 2 // Some margin on negative extrude.
lugs = extrude(profileStud, length = -1 * (tBell + clearance))

`,
  completed_at: Math.random().toString(),
  created_at: new Date(Math.random() * 100000000).toISOString(),
  error: Math.random().toString(),
  // declare type MlFeedback_type = 'thumbs_up' | 'thumbs_down' | 'accepted' | 'rejected';
  feedback: 'thumbs_up' as Prompt['feedback'],
  id: Math.random().toString(),
  kcl_version: Math.random().toString(),
  model_version: Math.random().toString(),
  // export declare type TextToCadModel_type = 'cad' | 'kcl' | 'kcl_iteration'; model : 'kcl',
  model: 'kcl' as Prompt['model'],
  // export declare type FileExportFormat_type = 'fbx' | 'glb' | 'gltf' | 'obj' | 'ply' | 'step' | 'stl';
  output_format: 'glb' as Prompt['output_format'],
  outputs: {
    [Math.random().toString()]: Math.random().toString(),
  },
  prompt: args.prompt ?? PROMPTS[parseInt((Math.random() * 10).toString()[0])],
  started_at: new Date(Math.random()).toISOString(),
  // declare type ApiCallStatus_type = 'queued' | 'uploaded' | 'in_progress' | 'completed' | 'failed';
  status: ['completed', 'in_progress'][
    Math.trunc((Math.random() * 100) % 2)
  ] as Prompt['status'],
  updated_at: Math.random().toString(),
  // declare type ApiTokenUuid_type = string;
  user_id: Math.random().toString(),
})
