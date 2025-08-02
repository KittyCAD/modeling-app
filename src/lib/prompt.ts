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

export const generateFakeSubmittedPrompt = () => ({
  code: `
  sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-400.87, 125.73])
  |> line(end = [46.16, -415.45])
  |> line(end = [268.46, 201.65])
  |> line(end = [-215.01, -81.39])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile002 = startProfile(sketch001, at = [-36.44, 231.41])
  |> line(end = [-57.1, -211.37])
  |> line(end = [240.52, -128.76])
  |> line(end = [43.73, 219.87])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile003 = startProfile(sketch001, at = [267.24, 333.45])
  |> line(end = [35.23, -523.56])
  |> line(end = [155.49, 269.68])
  |> line(end = [-127.55, -109.33])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude([profile002, profile003, profile001], length = 5)
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
  prompt: PROMPTS[parseInt((Math.random() * 10).toString()[0])],
  started_at: new Date(Math.random()).toISOString(),
  // declare type ApiCallStatus_type = 'queued' | 'uploaded' | 'in_progress' | 'completed' | 'failed';
  status: ['completed', 'in_progress'][
    Math.trunc((Math.random() * 100) % 2)
  ] as Prompt['status'],
  updated_at: Math.random().toString(),
  // declare type ApiTokenUuid_type = string;
  user_id: Math.random().toString(),
})
