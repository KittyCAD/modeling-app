import type {
  TextToCadMultiFileIteration,
  SourceRange as ApiSourceRange,
  SourceRangePrompt,
} from '@kittycad/lib'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
import type { SourceRange } from '@src/lang/wasm'
import { ml } from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { err } from '@src/lib/trap'
import type { KittyCadLibFile } from '@src/lib/promptToEditTypes'
import type {
  ConstructRequestArgs,
  KclFileMetaMap,
  PromptToEditRequest,
} from '@src/lib/promptToEditTypes'
import { parentPathRelativeToProject } from '@src/lib/paths'

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

export async function submitTextToCadMultiFileIterationRequest(
  request: PromptToEditRequest,
  token: string
): Promise<TextToCadMultiFileIteration | Error> {
  const client = createKCClient(token)
  const data = await kcCall(() =>
    ml.create_text_to_cad_multi_file_iteration({
      client,
      files: request.files as any,
      body: request.body as any,
    })
  )
  return data
}

// The ML service should know enough about caps, edges, faces, etc when doing
// ML operations, but that's currently not the case.
// This helper function should become deprecated with time.
export function constructMultiFileIterationRequestWithPromptHelpers({
  conversationId,
  prompt,
  selections,
  projectFiles,
  applicationProjectDirectory,
  artifactGraph,
  projectName,
  currentFile,
  kclVersion,
}: ConstructRequestArgs): PromptToEditRequest {
  const kclFilesMap: KclFileMetaMap = {}
  const files: KittyCadLibFile[] = []

  projectFiles.forEach((file) => {
    let data: Blob
    if (file.type === 'other') {
      data = file.data
    } else {
      // file.type === 'kcl'
      kclFilesMap[file.execStateFileNamesIndex] = file
      data = new Blob([file.fileContents], { type: 'text/kcl' })
    }
    files.push({
      name: file.relPath,
      data,
    })
  })

  // Way to patch in supplying the currently-opened file without updating the API.
  // TODO: update the API to support currently-opened files as other parts of the payload
  const currentFilePrompt: SourceRangePrompt | null = currentFile.entry
    ? {
        prompt: 'This is the active file',
        range: convertAppRangeToApiRange(
          [0, currentFile.content.length, 0],
          currentFile.content
        ),
        file: parentPathRelativeToProject(
          currentFile.entry?.path,
          applicationProjectDirectory
        ),
      }
    : null

  // If no selection, use whole file
  if (selections === null) {
    const rangePrompts: SourceRangePrompt[] = []
    if (currentFilePrompt !== null) {
      rangePrompts.push(currentFilePrompt)
    }
    return {
      body: {
        prompt,
        source_ranges: rangePrompts,
        project_name:
          projectName !== '' && projectName !== 'browser'
            ? projectName
            : undefined,
        kcl_version: kclVersion,
      },
      files,
    }
  }

  // Handle manual code selections and artifact selections differently
  const ranges: SourceRangePrompt[] = selections.graphSelections.flatMap(
    (selection) => {
      const artifact = selection.artifact
      const execStateFileNamesIndex = selection?.codeRef?.range?.[2]
      const file = kclFilesMap?.[execStateFileNamesIndex]
      const code = file?.fileContents || ''
      const filePath = file?.relPath || ''

      // For artifact selections, add context
      const prompts: SourceRangePrompt[] = []

      if (artifact?.type === 'cap') {
        prompts.push({
          prompt: `The users main selection is the end cap of a general-sweep (that is an extrusion, revolve, sweep or loft).
The source range most likely refers to "startProfile" simply because this is the start of the profile that was swept.
If you need to operate on this cap, for example for sketching on the face, you can use the special string ${
            artifact.subType === 'end' ? 'END' : 'START'
          } i.e. \`startSketchOn(someSweepVariable, face = ${
            artifact.subType === 'end' ? 'END' : 'START'
          })\`
When they made this selection they main have intended this surface directly or meant something more general like the sweep body.
See later source ranges for more context.`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
          file: filePath,
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
            file: filePath,
          })
        }
      }
      if (artifact?.type === 'wall') {
        prompts.push({
          prompt: `The users main selection is the wall of a general-sweep (that is an extrusion, revolve, sweep or loft).
The source range though is for the original segment before it was extruded, you can add a tag to that segment in order to refer to this wall, for example "startSketchOn(someSweepVariable, face = segmentTag)"
But it's also worth bearing in mind that the user may have intended to select the sweep itself, not this individual wall, see later source ranges for more context. about the sweep`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
          file: filePath,
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
            file: filePath,
          })
        }
      }
      if (artifact?.type === 'sweepEdge') {
        prompts.push({
          prompt: `The users main selection is the edge of a general-sweep (that is an extrusion, revolve, sweep or loft).
it is an ${
            artifact.subType
          } edge, in order to refer to this edge you should add a tag to the segment function in this source range,
and then use the function ${
            artifact.subType === 'adjacent'
              ? 'getAdjacentEdge'
              : 'getOppositeEdge'
          }
See later source ranges for more context. about the sweep`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
          file: filePath,
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
            file: filePath,
          })
        }
      }
      if (artifact?.type === 'segment') {
        if (!artifact.surfaceId) {
          prompts.push({
            prompt: `This selection is of a segment, likely an individual part of a profile. Segments are often "constrained" by the use of variables and relationships with other segments. Adding tags to segments helps refer to their length, angle or other properties`,
            range: convertAppRangeToApiRange(selection.codeRef.range, code),
            file: filePath,
          })
        } else {
          prompts.push({
            prompt: `This selection is for a segment (line, xLine, angledLine etc) that has been swept (a general-sweep, either an extrusion, revolve, sweep or loft).
Because it now refers to an edge the way to refer to this edge is to add a tag to the segment, and then use that tag directly.
i.e. \`fillet( radius = someInteger, tags = [newTag])\` will work in the case of filleting this edge
See later source ranges for more context. about the sweep`,
            range: convertAppRangeToApiRange(selection.codeRef.range, code),
            file: filePath,
          })
          let path = getArtifactOfTypes(
            { key: artifact.pathId, types: ['path'] },
            artifactGraph
          )
          if (!err(path) && path.sweepId) {
            const sweep = getArtifactOfTypes(
              { key: path.sweepId, types: ['sweep'] },
              artifactGraph
            )
            if (!err(sweep)) {
              prompts.push({
                prompt: `This is the sweep's source range from the user's main selection of the edge.`,
                range: convertAppRangeToApiRange(sweep.codeRef.range, code),
                file: filePath,
              })
            }
          }
        }
      }
      if (!artifact) {
        // manually selected code is more likely to not have an artifact
        // an example might be highlighting the variable name only in a variable declaration
        prompts.push({
          prompt: '',
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
          file: filePath,
        })
      }
      return prompts
    }
  )
  // Push the current file prompt alongside the selection-based prompts
  if (currentFilePrompt !== null) {
    ranges.push(currentFilePrompt)
  }
  let payload = {
    body: {
      prompt,
      conversation_id: conversationId,
      source_ranges: ranges,
      project_name:
        projectName !== '' && projectName !== 'browser'
          ? projectName
          : undefined,
      kcl_version: kclVersion,
    },
    files,
  }

  if (!conversationId) {
    delete payload.body.conversation_id
  }

  return payload
}

export async function getPromptToEditResult(
  id: string,
  token?: string
): Promise<TextToCadMultiFileIteration | Error> {
  const client = createKCClient(token)
  const data = await kcCall(() =>
    ml.get_text_to_cad_model_for_user({ client, id })
  )
  return data as TextToCadMultiFileIteration | Error
}
