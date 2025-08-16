import type { Models } from '@kittycad/lib'
import type { TextToCadMultiFileIteration_type } from '@kittycad/lib/dist/types/src/models'

import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, SourceRange } from '@src/lang/wasm'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import type { Selections } from '@src/lib/selections'
import { kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import type { File as KittyCadLibFile } from '@kittycad/lib/dist/types/src/models'
import type { FileMeta } from '@src/lib/types'
import { connectReasoningStream } from '@src/lib/reasoningWs'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

type KclFileMetaMap = {
  [execStateFileNamesIndex: number]: Extract<FileMeta, { type: 'kcl' }>
}

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
): Models['SourceRange_type'] {
  return {
    start: sourceIndexToLineColumn(code, range[0]),
    end: sourceIndexToLineColumn(code, range[1]),
  }
}

type TextToCadErrorResponse = {
  error_code: string
  message: string
}

export async function submitTextToCadMultiFileIterationRequest(
  request: {
    body: {
      prompt: string
      source_ranges: Models['SourceRangePrompt_type'][]
      project_name?: string
      kcl_version: string
    }
    files: KittyCadLibFile[]
  },
  token: string
): Promise<TextToCadMultiFileIteration_type | Error> {
  const formData = new FormData()
  formData.append('body', JSON.stringify(request.body))

  request.files.forEach((file) => {
    formData.append('files', file.data, file.name)
  })

  const response = await fetch(
    withAPIBaseURL('/ml/text-to-cad/multi-file/iteration'),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }
  )

  if (!response.ok) {
    return new Error(`HTTP error! status: ${response.status}`)
  }

  const data = await response.json()
  if ('error_code' in data) {
    const errorData = data as TextToCadErrorResponse
    return new Error(errorData.message || 'Unknown error')
  }

  connectReasoningStream(token, data.id)

  return data as TextToCadMultiFileIteration_type
}

// The ML service should know enough about caps, edges, faces, etc when doing
// ML operations, but that's currently not the case.
// This helper function should become deprecated with time.
export function constructMultiFileIterationRequestWithPromptHelpers({
  conversationId,
  prompt,
  selections,
  projectFiles,
  artifactGraph,
  projectName,
}: {
  conversationId?: string
  prompt: string
  selections: Selections | null
  projectFiles: FileMeta[]
  projectName: string
  artifactGraph: ArtifactGraph
}) {
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

  // If no selection, use whole file
  if (selections === null) {
    return {
      body: {
        prompt,
        source_ranges: [],
        project_name:
          projectName !== '' && projectName !== 'browser'
            ? projectName
            : undefined,
        kcl_version: kclManager.kclVersion,
      },
      files,
    }
  }

  // Handle manual code selections and artifact selections differently
  const ranges: Models['SourceRangePrompt_type'][] =
    selections.graphSelections.flatMap((selection) => {
      const artifact = selection.artifact
      const execStateFileNamesIndex = selection?.codeRef?.range?.[2]
      const file = kclFilesMap?.[execStateFileNamesIndex]
      const code = file?.fileContents || ''
      const filePath = file?.relPath || ''

      // For artifact selections, add context
      const prompts: Models['SourceRangePrompt_type'][] = []

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
    })
  let payload = {
    body: {
      prompt,
      conversation_id: conversationId,
      source_ranges: ranges,
      project_name:
        projectName !== '' && projectName !== 'browser'
          ? projectName
          : undefined,
      kcl_version: kclManager.kclVersion,
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
): Promise<Models['TextToCadMultiFileIteration_type'] | Error> {
  const url = withAPIBaseURL(`/user/text-to-cad/${id}`)
  const data: Models['TextToCadMultiFileIteration_type'] | Error =
    await crossPlatformFetch(
      url,
      {
        method: 'GET',
      },
      token
    )

  return data
}
