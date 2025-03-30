import { Models, ml, Client } from '@kittycad/lib'
import { VITE_KC_API_BASE_URL } from 'env'
import crossPlatformFetch from './crossPlatformFetch'
import { err, reportRejection } from './trap'
import { Selections } from './selections'
import { getArtifactOfTypes } from 'lang/std/artifactGraph'
import { ArtifactGraph, SourceRange, topLevelRange } from 'lang/wasm'
import toast from 'react-hot-toast'
import { codeManager, editorManager, kclManager } from './singletons'
import { ToastPromptToEditCadSuccess } from 'components/ToastTextToCad'
import { uuidv4 } from './utils'
import { diffLines } from 'diff'
import { Transaction, EditorSelection, SelectionRange } from '@codemirror/state'
import { modelingMachineEvent } from 'editor/manager'
import { getCookie, TOKEN_PERSIST_KEY } from 'machines/authMachine'
import { COOKIE_NAME } from './constants'
import { TextToCadMultiFileIteration_type } from '@kittycad/lib/dist/types/src/models'

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

export async function submitPromptToEditToQueue({
  prompt,
  selections,
  code,
  token,
  artifactGraph,
  projectName,
}: {
  prompt: string
  selections: Selections | null
  code: string
  projectName: string
  token?: string
  artifactGraph: ArtifactGraph
}) {
  const _token =
    token && token !== ''
      ? token
      : getCookie(COOKIE_NAME) || localStorage?.getItem(TOKEN_PERSIST_KEY) || ''

  const client = new Client(_token)

  // If no selection, use whole file
  if (selections === null) {
    const codeBlob = new Blob([code], { type: 'text/plain' })
    return ml.create_text_to_cad_multi_file_iteration({
      client,
      body: {
        source_ranges: [],
        project_name:
          projectName !== '' && projectName !== 'browser'
            ? projectName
            : undefined,
        kcl_version: kclManager.kclVersion,
      },
      files: [
        {
          name: 'myFile.kcl',
          data: codeBlob,
        },
      ],
    })
  }

  // Handle manual code selections and artifact selections differently
  const ranges: Models['SourceRangePrompt_type'][] =
    selections.graphSelections.flatMap((selection) => {
      const artifact = selection.artifact

      // For artifact selections, add context
      const prompts: Models['SourceRangePrompt_type'][] = []

      if (artifact?.type === 'cap') {
        prompts.push({
          prompt: `The users main selection is the end cap of a general-sweep (that is an extrusion, revolve, sweep or loft).
The source range most likely refers to "startProfileAt" simply because this is the start of the profile that was swept.
If you need to operate on this cap, for example for sketching on the face, you can use the special string ${
            artifact.subType === 'end' ? 'END' : 'START'
          } i.e. \`startSketchOn(someSweepVariable, ${
            artifact.subType === 'end' ? 'END' : 'START'
          })\`
When they made this selection they main have intended this surface directly or meant something more general like the sweep body.
See later source ranges for more context.`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
          file: 'myFile.kcl',
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
            file: 'myFile.kcl',
          })
        }
      }
      if (artifact?.type === 'wall') {
        prompts.push({
          prompt: `The users main selection is the wall of a general-sweep (that is an extrusion, revolve, sweep or loft).
The source range though is for the original segment before it was extruded, you can add a tag to that segment in order to refer to this wall, for example "startSketchOn(someSweepVariable, segmentTag)"
But it's also worth bearing in mind that the user may have intended to select the sweep itself, not this individual wall, see later source ranges for more context. about the sweep`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
          file: 'myFile.kcl',
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
            file: 'myFile.kcl',
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
          file: 'myFile.kcl',
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
            file: 'myFile.kcl',
          })
        }
      }
      if (artifact?.type === 'segment') {
        if (!artifact.surfaceId) {
          prompts.push({
            prompt: `This selection is of a segment, likely an individual part of a profile. Segments are often "constrained" by the use of variables and relationships with other segments. Adding tags to segments helps refer to their length, angle or other properties`,
            range: convertAppRangeToApiRange(selection.codeRef.range, code),
            file: 'myFile.kcl',
          })
        } else {
          prompts.push({
            prompt: `This selection is for a segment (line, xLine, angledLine etc) that has been swept (a general-sweep, either an extrusion, revolve, sweep or loft).
Because it now refers to an edge the way to refer to this edge is to add a tag to the segment, and then use that tag directly.
i.e. \`fillet( radius = someInteger, tags = [newTag])\` will work in the case of filleting this edge
See later source ranges for more context. about the sweep`,
            range: convertAppRangeToApiRange(selection.codeRef.range, code),
            file: 'myFile.kcl',
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
                file: 'myFile.kcl',
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
          file: 'myFile.kcl',
        })
      }
      return prompts
    })
  const codeBlob = new Blob([code], { type: 'text/plain' })
  return ml.create_text_to_cad_multi_file_iteration({
    client,
    body: {
      source_ranges: ranges,
      project_name:
        projectName !== '' && projectName !== 'browser'
          ? projectName
          : undefined,
      kcl_version: kclManager.kclVersion,
    },
    files: [
      {
        name: 'myFile.kcl',
        data: codeBlob,
      },
    ],
  })
}

export async function getPromptToEditResult(
  id: string,
  token?: string
): Promise<Models['TextToCadMultiFileIteration_type'] | Error> {
  const url = VITE_KC_API_BASE_URL + '/async/operations/' + id
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

export async function doPromptEdit({
  prompt,
  selections,
  code,
  token,
  artifactGraph,
  projectName,
}: {
  prompt: string
  selections: Selections
  code: string
  token?: string
  projectName: string
  artifactGraph: ArtifactGraph
}): Promise<Models['TextToCadMultiFileIteration_type'] | Error> {
  const toastId = toast.loading('Submitting to Text-to-CAD API...')

  const _token =
    token && token !== ''
      ? token
      : getCookie(COOKIE_NAME) || localStorage?.getItem(TOKEN_PERSIST_KEY) || ''

  let submitResult

    // work around for @kittycad/lib not really being built for the browser
  ;(window as any).process = {
    env: {
      ZOO_API_TOKEN: token,
      ZOO_HOST: VITE_KC_API_BASE_URL,
    },
  }
  try {
    submitResult = await submitPromptToEditToQueue({
      prompt,
      selections,
      code,
      token,
      artifactGraph,
      projectName,
    })
  } catch (e: any) {
    return new Error(e.message)
  }
  if ('error_code' in submitResult) {
    return new Error(submitResult.message)
  }

  const textToCadComplete = new Promise<
    Models['TextToCadMultiFileIteration_type']
  >((resolve, reject) => {
    ;(async () => {
      const MAX_CHECK_TIMEOUT = 3 * 60_000
      const CHECK_DELAY = 200

      let timeElapsed = 0

      while (timeElapsed < MAX_CHECK_TIMEOUT) {
        const check = await getPromptToEditResult(submitResult.id, token)
        if (check instanceof Error || check.status === 'failed') {
          reject(check)
          return
        } else if (check.status === 'completed') {
          resolve(check)
          return
        }

        await new Promise((r) => setTimeout(r, CHECK_DELAY))
        timeElapsed += CHECK_DELAY
      }

      reject(new Error('Text-to-CAD API timed out'))
    })().catch(reportRejection)
  })

  try {
    const result = await textToCadComplete
    toast.dismiss(toastId)
    return result
  } catch (e) {
    toast.dismiss(toastId)
    toast.error(
      'Failed to edit your KCL code, please try again with a different prompt or selection'
    )
    console.error('textToCadComplete', e)
  }

  return textToCadComplete
}

/** takes care of the whole submit prompt to endpoint flow including the accept-reject toast once the result is back */
export async function promptToEditFlow({
  prompt,
  selections,
  code,
  token,
  artifactGraph,
  projectName,
}: {
  prompt: string
  selections: Selections
  code: string
  token?: string
  artifactGraph: ArtifactGraph
  projectName: string
}) {
  const result = await doPromptEdit({
    prompt,
    selections,
    code,
    token,
    artifactGraph,
    projectName,
  })
  if (err(result)) return Promise.reject(result)
  const oldCode = codeManager.code
  // TODO remove once endpoint isn't returning fake data.
  const outputs: TextToCadMultiFileIteration_type['outputs'] = {}
  Object.entries(result.outputs).forEach(([key, value]) => {
    outputs[key] = value + '\n// yoyo a comment'
  })

  const newCode = result.outputs['myFile.kcl']
  codeManager.updateCodeEditor(newCode)
  const diff = reBuildNewCodeWithRanges(oldCode, newCode)
  const ranges: SelectionRange[] = diff.insertRanges.map((range) =>
    EditorSelection.range(range[0], range[1])
  )
  editorManager?.editorView?.dispatch({
    selection: EditorSelection.create(
      ranges,
      selections.graphSelections.length - 1
    ),
    annotations: [modelingMachineEvent, Transaction.addToHistory.of(false)],
  })
  await kclManager.executeCode()
  const toastId = uuidv4()

  toast.success(
    () =>
      ToastPromptToEditCadSuccess({
        toastId,
        data: result,
        token,
        oldCode,
      }),
    {
      id: toastId,
      duration: Infinity,
      icon: null,
    }
  )
}

const reBuildNewCodeWithRanges = (
  oldCode: string,
  newCode: string
): {
  newCode: string
  insertRanges: SourceRange[]
} => {
  let insertRanges: SourceRange[] = []
  const changes = diffLines(oldCode, newCode)
  let newCodeWithRanges = ''
  for (const change of changes) {
    if (!change.added && !change.removed) {
      // no change add it to newCodeWithRanges
      newCodeWithRanges += change.value
    } else if (change.added && !change.removed) {
      const start = newCodeWithRanges.length
      const end = start + change.value.length
      insertRanges.push(topLevelRange(start, end))
      newCodeWithRanges += change.value
    }
  }
  return {
    newCode: newCodeWithRanges,
    insertRanges,
  }
}
