import type {
  SourceRange as ApiSourceRange,
  SourceRangePrompt,
  TextToCadMultiFileIterationBody as ZookeeperMultiFileIterationBody,
} from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import {
  getArtifactOfTypes,
  getCapCodeRef,
  getOriginalSegmentArtifact,
  getWallCodeRef,
} from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { parentPathRelativeToProject, toWebSafePath } from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'
import {
  getSelectionReferences,
  isEnginePrimitiveSelection,
  type SelectionReference,
} from '@src/lib/selections'
import type { FileMeta } from '@src/lib/types'
import { isErr, reportRejection } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

export type KittyCadLibFile = { name: string; data: Blob }

type KclFileMetaMap = {
  [execStateFileNamesIndex: number]: Extract<FileMeta, { type: 'kcl' }>
}

export interface ZookeeperUserPromptRequest {
  body: ZookeeperMultiFileIterationBody
  files: KittyCadLibFile[]
  activeFile?: string
}

export interface ConstructZookeeperUserPromptRequestArgs {
  conversationId?: string
  prompt: string
  applicationProjectDirectory: string
  selections: Selections | null
  projectFiles: FileMeta[]
  projectName: string
  currentFile: { entry: FileEntry; content: string }
  artifactGraph: ArtifactGraph
  kclVersion: string
  kclManager: KclManager
  engineCommandManager: ConnectionManager
  wasmInstance: ModuleType
}

/**
 * Selection-derived guidance that should be sent as Zookeeper source-range
 * context. These prompts must not be appended to the user's visible prompt.
 */
type SourceRangePromptDraft = {
  prompt: string
  range: SourceRange
  required?: boolean
}

type ArtifactSelectionPromptHandlerArgs = {
  selection: Selection & {
    artifact: Artifact
    codeRef: NonNullable<Selection['codeRef']>
  }
  artifactGraph: ArtifactGraph
}

export type ArtifactSelectionPromptHandler = (
  args: ArtifactSelectionPromptHandlerArgs
) => SourceRangePromptDraft[]

function sourceIndexToLineColumn(
  code: string,
  index: number
): { line: number; column: number } {
  const codeStart = code.slice(0, index)
  const lines = codeStart.split('\n')
  const line = lines.length
  const column = lines[lines.length - 1].length
  return { line, column }
}

function convertAppRangeToApiRange(
  range: SourceRange,
  code: string
): ApiSourceRange {
  return {
    start: sourceIndexToLineColumn(code, range[0]),
    end: sourceIndexToLineColumn(code, range[1]),
  }
}

function isValidRangeForCode(range: SourceRange, code: string): boolean {
  const [start, end] = range
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= code.length
  )
}

function sourceRangePromptFromRange({
  range,
  prompt,
  kclFilesMap,
  required,
}: {
  range: SourceRange
  prompt: string
  kclFilesMap: KclFileMetaMap
  required: boolean
}): SourceRangePrompt | Error | null {
  const execStateFileNamesIndex = range[2]
  const file = kclFilesMap[execStateFileNamesIndex]

  if (!file) {
    return required
      ? new Error(
          `Could not send Zookeeper selection: no KCL file found for source range file index ${execStateFileNamesIndex}.`
        )
      : null
  }

  if (!isValidRangeForCode(range, file.fileContents)) {
    return required
      ? new Error(
          `Could not send Zookeeper selection: invalid source range ${range[0]}-${range[1]} for ${file.relPath}.`
        )
      : null
  }

  return {
    prompt,
    range: convertAppRangeToApiRange(range, file.fileContents),
    file: file.relPath,
  }
}

function selectedArtifactSourceRangePrompt({
  selection,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  return [
    {
      prompt: `This is the source range for the user's selected ${selection.artifact.type} artifact.`,
      range: selection.codeRef.range,
    },
  ]
}

function faceArtifactDescription(artifact: Artifact | undefined): string {
  if (!artifact) return 'unmapped face'

  if (artifact.type === 'wall') {
    return 'wall artifact produced from a swept sketch segment'
  }
  if (artifact.type === 'cap') {
    return `${artifact.subType} cap artifact produced by a sweep`
  }
  if (artifact.type === 'edgeCut') {
    return 'face artifact produced by an edge treatment'
  }

  return `${artifact.type} artifact`
}

function faceArtifactKind(artifact: Artifact): string {
  if (artifact.type === 'wall') return 'wall face'
  if (artifact.type === 'cap') return `${artifact.subType} cap face`
  if (artifact.type === 'edgeCut') return 'edge-treatment face'
  return `${artifact.type} face`
}

function formatFaceArtifactList(
  faceIds: string[],
  artifactGraph: ArtifactGraph
): string {
  return faceIds
    .map(
      (faceId, index) =>
        `    ${index + 1}. ${faceArtifactDescription(artifactGraph.get(faceId))}`
    )
    .join('\n')
}

function entityReferenceSelectionPrompt(
  selection: Selection,
  artifactGraph: ArtifactGraph
): string | null {
  const entityRef = selection.entityRef
  if (!entityRef) return null

  if (entityRef.type === 'edge') {
    const faceIds = [...entityRef.side_faces, ...(entityRef.end_faces ?? [])]
    if (!faceIds.some((faceId) => artifactGraph.has(faceId))) return null

    const lines = [
      'The user selected an edge using the Face API. Its reference is composed of these face artifacts:',
      '  sideFaces:',
      formatFaceArtifactList(entityRef.side_faces, artifactGraph),
    ]
    if (entityRef.end_faces?.length) {
      lines.push(
        '  endFaces:',
        formatFaceArtifactList(entityRef.end_faces, artifactGraph)
      )
    }
    if (entityRef.index !== undefined) {
      lines.push(`  index: ${entityRef.index}`)
    }
    lines.push(
      'This is the complete Face API reference returned for the selected edge. Fields not shown are not part of this reference. The associated source ranges explain how each face artifact maps to KCL.'
    )
    return lines.join('\n')
  }

  if (entityRef.type === 'vertex') {
    if (!entityRef.side_faces.some((faceId) => artifactGraph.has(faceId))) {
      return null
    }
    return [
      'The user selected a vertex using the Face API. Its reference is composed of these side-face artifacts:',
      formatFaceArtifactList(entityRef.side_faces, artifactGraph),
      ...(entityRef.index === undefined ? [] : [`  index: ${entityRef.index}`]),
      'This is the complete Face API reference returned for the selected vertex. Fields not shown are not part of this reference. The associated source ranges explain how each face artifact maps to KCL.',
    ].join('\n')
  }

  if (entityRef.type === 'face') {
    if (!artifactGraph.has(entityRef.face_id)) return null
    return `The user selected a face using the Face API. It resolves to a ${faceArtifactDescription(
      artifactGraph.get(entityRef.face_id)
    )}. The associated source range explains how this face should be tagged.`
  }

  return null
}

function isFaceApiTopologySelection(selection: Selection): boolean {
  return (
    selection.entityRef?.type === 'face' ||
    selection.entityRef?.type === 'edge' ||
    selection.entityRef?.type === 'vertex'
  )
}

function faceArtifactsFromEntityReference(
  selection: Selection,
  artifactGraph: ArtifactGraph
): Array<{ artifact: Artifact; slots: string[] }> {
  const entityRef = selection.entityRef
  if (!entityRef) return []

  const faceSlots: Array<[string, string]> =
    entityRef.type === 'face'
      ? [['face', entityRef.face_id]]
      : entityRef.type === 'edge'
        ? [
            ...entityRef.side_faces.map((faceId, index): [string, string] => [
              `sideFaces[${index}]`,
              faceId,
            ]),
            ...(entityRef.end_faces ?? []).map(
              (faceId, index): [string, string] => [
                `endFaces[${index}]`,
                faceId,
              ]
            ),
          ]
        : entityRef.type === 'vertex'
          ? entityRef.side_faces.map((faceId, index): [string, string] => [
              `sideFaces[${index}]`,
              faceId,
            ])
          : []

  const artifactsById = new Map<
    string,
    { artifact: Artifact; slots: string[] }
  >()
  for (const [slot, faceId] of faceSlots) {
    const artifact = artifactGraph.get(faceId)
    if (!artifact) continue
    const existing = artifactsById.get(artifact.id)
    if (existing) {
      existing.slots.push(slot)
    } else {
      artifactsById.set(artifact.id, { artifact, slots: [slot] })
    }
  }
  return [...artifactsById.values()]
}

function capSourceRangePrompt({
  selection,
  artifactGraph,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  const artifact = selection.artifact
  if (artifact.type !== 'cap')
    return selectedArtifactSourceRangePrompt({ selection, artifactGraph })

  const prompts: SourceRangePromptDraft[] = []

  if (!artifact.sweepId) {
    return [
      {
        prompt:
          'This region supplies the profile used to create the selected cap face.',
        range: selection.codeRef.range,
      },
    ]
  }

  const sweep = getArtifactOfTypes(
    { key: artifact.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (!isErr(sweep)) {
    prompts.push({
      prompt: `This sweep operation created the selected ${
        artifact.subType
      } cap. Add or use \`tag${
        artifact.subType === 'end' ? 'End' : 'Start'
      }\` on this operation to refer to the cap in KCL. For sketching on it, use that tag with \`faceOf\`, for example \`sketch(on = faceOf(someSweepVariable, face = capTag)) { ... }\`.`,
      range: sweep.codeRef.range,
      required: false,
    })
  }

  prompts.push({
    prompt:
      'This region supplies the profile swept by that operation. Unlike a wall face, the selected cap does not originate from one specific sketch segment.',
    range: selection.codeRef.range,
  })

  return prompts
}

function wallSourceRangePrompt({
  selection,
  artifactGraph,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  const artifact = selection.artifact
  if (artifact.type !== 'wall')
    return selectedArtifactSourceRangePrompt({ selection, artifactGraph })

  const prompts: SourceRangePromptDraft[] = []

  const sweep = getArtifactOfTypes(
    { key: artifact.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (!isErr(sweep)) {
    prompts.push({
      prompt:
        'The selected wall belongs to the sweep created by this operation.',
      range: sweep.codeRef.range,
      required: false,
    })
  }

  prompts.push({
    prompt:
      'This region supplies the profile swept by that operation. The selected wall maps through this region to one of its source sketch segments.',
    range: selection.codeRef.range,
  })

  const sourceSegment = getOriginalSegmentArtifact(
    artifact.segId,
    artifactGraph
  )
  if (
    sourceSegment &&
    (sourceSegment.codeRef.range[0] !== selection.codeRef.range[0] ||
      sourceSegment.codeRef.range[1] !== selection.codeRef.range[1] ||
      sourceSegment.codeRef.range[2] !== selection.codeRef.range[2])
  ) {
    prompts.push({
      prompt:
        'The selected wall originates from this specific sketch segment. Add or use a tag on this segment to refer to the wall, for example `sketch(on = faceOf(someSweepVariable, face = someRegion.tags.segmentTag)) { ... }`.',
      range: sourceSegment.codeRef.range,
      required: false,
    })
  }

  return prompts
}

function edgeCutSourceRangePrompt({
  selection,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  return [
    {
      prompt:
        'This edge-treatment operation created the selected face; the user selected the generated face, not the chamfer or fillet operation itself. Preserve the existing operation. Its `tag` argument, when present, names this generated face and is the KCL reference to use for the face in a later edge reference.',
      range: selection.codeRef.range,
    },
  ]
}

function sweepEdgeSourceRangePrompt({
  selection,
  artifactGraph,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  const artifact = selection.artifact
  if (artifact.type !== 'sweepEdge')
    return selectedArtifactSourceRangePrompt({ selection, artifactGraph })

  const prompts: SourceRangePromptDraft[] = [
    {
      prompt: `The user's main selection is the edge of a general sweep (that is an extrusion, revolve, sweep, or loft).
It is an ${
        artifact.subType
      } edge. To refer to this edge in current KCL, add a tag to the source segment and pass that tag to ${
        artifact.subType === 'opposite'
          ? 'getOppositeEdge'
          : artifact.subType === 'previousAdjacent'
            ? 'getPreviousAdjacentEdge'
            : 'getNextAdjacentEdge'
      }, for example \`getOppositeEdge(someRegion.tags.segmentTag)\`.
See later source ranges for more context. about the sweep`,
      range: selection.codeRef.range,
    },
  ]

  if (!artifact.sweepId) {
    return prompts
  }

  const sweep = getArtifactOfTypes(
    { key: artifact.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (!isErr(sweep)) {
    prompts.push({
      prompt: `This is the sweep's source range from the user's main selection of the edge.`,
      range: sweep.codeRef.range,
      required: false,
    })
  }

  return prompts
}

function segmentSourceRangePrompt({
  selection,
  artifactGraph,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  const artifact = selection.artifact
  if (artifact.type !== 'segment')
    return selectedArtifactSourceRangePrompt({ selection, artifactGraph })

  if (!artifact.surfaceId) {
    return [
      {
        prompt: `This selection is of a segment, likely an individual part of a profile. Segments are often "constrained" by the use of variables and relationships with other segments. Adding tags to segments helps refer to their length, angle or other properties`,
        range: selection.codeRef.range,
      },
    ]
  }

  const prompts: SourceRangePromptDraft[] = [
    {
      prompt: `This selection is for a sketch segment that has been swept (a general sweep, either an extrusion, revolve, sweep, or loft).
Because it now refers to an edge, the way to refer to this edge is to add a tag to the source segment, and then use that tag expression directly.
i.e. \`fillet(someSweepVariable, radius = someInteger, tags = [someRegion.tags.newTag])\` will work in the case of filleting this edge
See later source ranges for more context. about the sweep`,
      range: selection.codeRef.range,
    },
  ]

  const path = getArtifactOfTypes(
    { key: artifact.pathId, types: ['path'] },
    artifactGraph
  )
  if (!isErr(path) && path.sweepId) {
    const sweep = getArtifactOfTypes(
      { key: path.sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (!isErr(sweep)) {
      prompts.push({
        prompt: `This is the sweep's source range from the user's main selection of the edge.`,
        range: sweep.codeRef.range,
        required: false,
      })
    }
  }

  return prompts
}

export const zookeeperArtifactSelectionPromptHandlers = {
  compositeSolid: selectedArtifactSourceRangePrompt,
  plane: selectedArtifactSourceRangePrompt,
  path: selectedArtifactSourceRangePrompt,
  segment: segmentSourceRangePrompt,
  solid2d: selectedArtifactSourceRangePrompt,
  primitiveFace: selectedArtifactSourceRangePrompt,
  primitiveEdge: selectedArtifactSourceRangePrompt,
  planeOfFace: selectedArtifactSourceRangePrompt,
  startSketchOnFace: selectedArtifactSourceRangePrompt,
  startSketchOnPlane: selectedArtifactSourceRangePrompt,
  sketchBlock: selectedArtifactSourceRangePrompt,
  sketchBlockConstraint: selectedArtifactSourceRangePrompt,
  sweep: selectedArtifactSourceRangePrompt,
  wall: wallSourceRangePrompt,
  cap: capSourceRangePrompt,
  sweepEdge: sweepEdgeSourceRangePrompt,
  edgeCut: edgeCutSourceRangePrompt,
  edgeCutEdge: selectedArtifactSourceRangePrompt,
  helix: selectedArtifactSourceRangePrompt,
  gdtAnnotation: selectedArtifactSourceRangePrompt,
  namedView: selectedArtifactSourceRangePrompt,
  pattern: selectedArtifactSourceRangePrompt,
} satisfies Record<Artifact['type'], ArtifactSelectionPromptHandler>

export function activeFileRelativeToProject({
  currentFileEntry,
  applicationProjectDirectory,
}: {
  currentFileEntry?: FileEntry
  applicationProjectDirectory: string
}): string | undefined {
  if (!currentFileEntry) {
    return undefined
  }

  const activeFile = parentPathRelativeToProject(
    currentFileEntry.path,
    applicationProjectDirectory
  )
  return activeFile ? toWebSafePath(activeFile) : undefined
}

function kclFileForCurrentFile({
  currentFile,
  kclFilesMap,
}: {
  currentFile: { entry: FileEntry; content: string }
  kclFilesMap: KclFileMetaMap
}): Extract<FileMeta, { type: 'kcl' }> | undefined {
  return Object.values(kclFilesMap).find(
    (file) => file.absPath === currentFile.entry.path
  )
}

export function buildZookeeperSourceRangePromptsForSelection({
  selection,
  artifactGraph,
  kclFilesMap,
}: {
  selection: Selection
  artifactGraph: ArtifactGraph
  kclFilesMap: KclFileMetaMap
}): SourceRangePrompt[] {
  const faceArtifacts = faceArtifactsFromEntityReference(
    selection,
    artifactGraph
  )
  if (faceArtifacts.length > 0) {
    return faceArtifacts.flatMap(({ artifact, slots }) => {
      const codeRef =
        artifact.type === 'wall'
          ? getWallCodeRef(artifact, artifactGraph)
          : artifact.type === 'cap'
            ? getCapCodeRef(artifact, artifactGraph)
            : 'codeRef' in artifact
              ? artifact.codeRef
              : new Error('Face artifact has no source range')
      if (isErr(codeRef)) return []

      const artifactPrompts = buildZookeeperSourceRangePromptsForSelection({
        selection: { artifact, codeRef },
        artifactGraph,
        kclFilesMap,
      })
      const group =
        slots.length === 1 && slots[0] === 'face'
          ? `the selected ${faceArtifactKind(artifact)}`
          : `${slots.join(' and ')}: ${faceArtifactKind(artifact)}`
      return artifactPrompts.map((prompt, index) => ({
        ...prompt,
        prompt: `Face selection group ${group} (step ${index + 1} of ${
          artifactPrompts.length
        }).\n${prompt.prompt}`,
      }))
    })
  }

  if (!selection.codeRef) return []

  const promptDrafts: SourceRangePromptDraft[] = selection.artifact
    ? zookeeperArtifactSelectionPromptHandlers[selection.artifact.type]({
        selection: selection as ArtifactSelectionPromptHandlerArgs['selection'],
        artifactGraph,
      })
    : [
        {
          prompt: 'This is the source range selected by the user.',
          range: selection.codeRef.range,
        },
      ]

  const prompts: SourceRangePrompt[] = []
  for (const promptDraft of promptDrafts) {
    const prompt = sourceRangePromptFromRange({
      range: promptDraft.range,
      prompt: promptDraft.prompt,
      kclFilesMap,
      required: promptDraft.required ?? true,
    })
    if (prompt instanceof Error) {
      reportRejection(prompt.message)
      continue
    }
    if (prompt !== null) {
      prompts.push(prompt)
    }
  }

  return prompts
}

function isReferenceableEnginePrimitiveSelection(
  selection: EnginePrimitiveSelection
): boolean {
  return (
    selection.primitiveType === 'face' || selection.primitiveType === 'edge'
  )
}

function formatSelectionReferencePrompt(
  references: SelectionReference[]
): string | null {
  if (references.length === 0) return null

  return [
    "The user's current selection includes these KCL references that may not exist verbatim in the source:",
    ...references.map(
      (reference) => `${reference.label}: \`${reference.code}\``
    ),
  ].join('\n')
}

function appendSelectionReferenceSourceRangePrompt({
  prompt,
  selectionReferencePrompt,
}: {
  prompt: string
  selectionReferencePrompt: string | null
}): string {
  return selectionReferencePrompt
    ? `${prompt}\n\n${selectionReferencePrompt}`
    : prompt
}

async function buildSelectionReferencePrompt({
  selections,
  artifactGraph,
  kclManager,
  engineCommandManager,
  wasmInstance,
}: {
  selections: Selections
  artifactGraph: ArtifactGraph
  kclManager: KclManager
  engineCommandManager: ConnectionManager
  wasmInstance: ModuleType
}): Promise<string | Error | null> {
  const enginePrimitives = selections.otherSelections.filter(
    isEnginePrimitiveSelection
  )
  const referenceableEnginePrimitives = enginePrimitives.filter(
    isReferenceableEnginePrimitiveSelection
  )
  const hasReferenceableGraphSelections = selections.graphSelections.some(
    (selection) => selection.artifact?.id || selection.entityRef
  )

  if (
    !hasReferenceableGraphSelections &&
    referenceableEnginePrimitives.length === 0
  ) {
    return null
  }

  const references = await getSelectionReferences({
    graphSelections: selections.graphSelections.filter(
      (selection) => !isFaceApiTopologySelection(selection)
    ),
    defaultPlaneSelections: [],
    enginePrimitives,
    artifactGraph,
    engineCommandManager,
    kclManager,
    wasmInstance,
  })

  const unresolvedSelections = referenceableEnginePrimitives.filter(
    (selection) =>
      !references.some(
        (reference) =>
          reference.enginePrimitiveSelection?.entityId === selection.entityId
      )
  )
  if (unresolvedSelections.length > 0) {
    return new Error(
      `Could not send Zookeeper selection: ${unresolvedSelections.length} selected engine primitive(s) could not be resolved to KCL references.`
    )
  }

  const entityReferencePrompts = selections.graphSelections
    .map((selection) =>
      entityReferenceSelectionPrompt(selection, artifactGraph)
    )
    .filter((selection): selection is string => selection !== null)
  const generatedReferencePrompt = formatSelectionReferencePrompt(references)

  if (entityReferencePrompts.length === 0) return generatedReferencePrompt
  return [
    ...entityReferencePrompts,
    ...(generatedReferencePrompt ? [generatedReferencePrompt] : []),
  ].join('\n\n')
}

export async function constructZookeeperUserPromptRequest({
  conversationId,
  prompt,
  selections,
  projectFiles,
  applicationProjectDirectory,
  artifactGraph,
  projectName,
  currentFile,
  kclVersion,
  kclManager,
  engineCommandManager,
  wasmInstance,
}: ConstructZookeeperUserPromptRequestArgs): Promise<
  ZookeeperUserPromptRequest | Error
> {
  const kclFilesMap: KclFileMetaMap = {}
  const files: KittyCadLibFile[] = []

  projectFiles.forEach((file) => {
    let data: Blob
    if (file.type === 'other') {
      data = file.data
    } else {
      if (Number.isInteger(file.execStateFileNamesIndex)) {
        kclFilesMap[file.execStateFileNamesIndex] = file
      }
      data = new Blob([file.fileContents], { type: 'text/kcl' })
    }
    files.push({
      name: file.relPath,
      data,
    })
  })

  const currentKclFile = kclFileForCurrentFile({ currentFile, kclFilesMap })
  const activeFile =
    activeFileRelativeToProject({
      currentFileEntry: currentFile.entry,
      applicationProjectDirectory,
    }) ||
    currentKclFile?.relPath ||
    toWebSafePath(currentFile.entry.name)

  const currentFilePrompt: SourceRangePrompt = {
    prompt: 'This is the active file',
    range: convertAppRangeToApiRange(
      [0, currentFile.content.length, 0],
      currentFile.content
    ),
    file: activeFile,
  }

  if (selections === null) {
    return {
      body: {
        prompt,
        project_name:
          projectName !== '' && projectName !== 'browser'
            ? projectName
            : undefined,
        kcl_version: kclVersion,
      },
      files,
      activeFile,
    }
  }

  const ranges: SourceRangePrompt[] = []
  const selectionReferencePrompt = await buildSelectionReferencePrompt({
    selections,
    artifactGraph,
    kclManager,
    engineCommandManager,
    wasmInstance,
  })
  if (selectionReferencePrompt instanceof Error) {
    return selectionReferencePrompt
  }

  for (const selection of selections.graphSelections) {
    const selectionPrompts = buildZookeeperSourceRangePromptsForSelection({
      selection,
      artifactGraph,
      kclFilesMap,
    })
    ranges.push(...selectionPrompts)
  }

  if (selectionReferencePrompt !== null) {
    ranges.push({
      ...currentFilePrompt,
      prompt: appendSelectionReferenceSourceRangePrompt({
        prompt: currentFilePrompt.prompt,
        selectionReferencePrompt,
      }),
    })
  }

  return {
    body: {
      prompt,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      source_ranges: ranges,
      project_name:
        projectName !== '' && projectName !== 'browser'
          ? projectName
          : undefined,
      kcl_version: kclVersion,
    },
    files,
    activeFile,
  }
}
