import type {
  SourceRange as ApiSourceRange,
  SourceRangePrompt,
  TextToCadMultiFileIterationBody as ZookeeperMultiFileIterationBody,
} from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
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
  selection: Selection & { artifact: Artifact }
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

function capSourceRangePrompt({
  selection,
  artifactGraph,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  const artifact = selection.artifact
  if (artifact.type !== 'cap')
    return selectedArtifactSourceRangePrompt({ selection, artifactGraph })

  const prompts: SourceRangePromptDraft[] = [
    {
      prompt: `The user's main selection is the end cap of a general sweep (that is an extrusion, revolve, sweep, or loft).
The source range most likely refers to the sketch block or region that produced the swept profile.
If you need to operate on this cap, for example sketching on the face, use the special string ${
        artifact.subType === 'end' ? 'END' : 'START'
      }, for example \`sketch(on = faceOf(someSweepVariable, face = ${
        artifact.subType === 'end' ? 'END' : 'START'
      })) { ... }\`
When they made this selection they may have intended this surface directly or meant something more general like the sweep body.
See later source ranges for more context.`,
      range: selection.codeRef.range,
    },
  ]

  const sweep = getArtifactOfTypes(
    { key: artifact.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (!isErr(sweep)) {
    prompts.push({
      prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
      range: sweep.codeRef.range,
      required: false,
    })
  }

  return prompts
}

function wallSourceRangePrompt({
  selection,
  artifactGraph,
}: ArtifactSelectionPromptHandlerArgs): SourceRangePromptDraft[] {
  const artifact = selection.artifact
  if (artifact.type !== 'wall')
    return selectedArtifactSourceRangePrompt({ selection, artifactGraph })

  const prompts: SourceRangePromptDraft[] = [
    {
      prompt: `The user's main selection is the wall of a general sweep (that is an extrusion, revolve, sweep, or loft).
The source range though is for the original segment before it was swept. You can add a tag to that segment in order to refer to this wall, for example \`sketch(on = faceOf(someSweepVariable, face = someRegion.tags.segmentTag)) { ... }\`
But it's also worth bearing in mind that the user may have intended to select the sweep itself, not this individual wall, see later source ranges for more context. about the sweep`,
      range: selection.codeRef.range,
    },
  ]

  const sweep = getArtifactOfTypes(
    { key: artifact.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (!isErr(sweep)) {
    prompts.push({
      prompt: `This is the sweep's source range from the user's main selection of the wall.`,
      range: sweep.codeRef.range,
      required: false,
    })
  }

  return prompts
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
  edgeCut: selectedArtifactSourceRangePrompt,
  edgeCutEdge: selectedArtifactSourceRangePrompt,
  helix: selectedArtifactSourceRangePrompt,
  importedGeometry: selectedArtifactSourceRangePrompt,
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
  const promptDrafts: SourceRangePromptDraft[] = selection.artifact
    ? zookeeperArtifactSelectionPromptHandlers[selection.artifact.type]({
        selection: selection as Selection & { artifact: Artifact },
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
    (selection) => selection.artifact?.id
  )

  if (
    !hasReferenceableGraphSelections &&
    referenceableEnginePrimitives.length === 0
  ) {
    return null
  }

  const references = await getSelectionReferences({
    graphSelections: selections.graphSelections,
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

  return formatSelectionReferencePrompt(references)
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
