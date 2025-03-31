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
import { KittyCadLibFile, uuidv4 } from './utils'
import { diffLines } from 'diff'
import { Transaction, EditorSelection, SelectionRange } from '@codemirror/state'
import { modelingMachineEvent } from 'editor/manager'
import { getCookie, TOKEN_PERSIST_KEY } from 'machines/authMachine'
import { COOKIE_NAME } from './constants'
import { TextToCadMultiFileIteration_type } from '@kittycad/lib/dist/types/src/models'
import { isDesktop } from './isDesktop'
import { openExternalBrowserIfDesktop } from './openWindow'
import { ActionButton } from 'components/ActionButton'
import { CustomIcon } from 'components/CustomIcon'

export type FileMeta =
  | {
      type: 'kcl'
      relPath: string
      absPath: string
      fileContents: string
      execStateFileNamesIndex: number
    }
  | {
      type: 'other'
      relPath: string
      data: Blob
    }

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

export async function submitPromptToEditToQueue({
  prompt,
  selections,
  projectFiles,
  token,
  artifactGraph,
  projectName,
}: {
  prompt: string
  selections: Selections | null
  projectFiles: FileMeta[]
  projectName: string
  token?: string
  artifactGraph: ArtifactGraph
}) {
  const _token =
    token && token !== ''
      ? token
      : getCookie(COOKIE_NAME) || localStorage?.getItem(TOKEN_PERSIST_KEY) || ''

  const client = new Client(_token)

  const kclFilesMap: KclFileMetaMap = {}
  const endPointFiles: KittyCadLibFile[] = []
  projectFiles.forEach((file) => {
    let data: Blob
    if (file.type === 'other') {
      data = file.data
    } else {
      // file.type === 'kcl'
      kclFilesMap[file.execStateFileNamesIndex] = file
      data = new Blob([file.fileContents], { type: 'text/kcl' })
    }
    endPointFiles.push({
      name: file.relPath,
      data,
    })
  })

  // If no selection, use whole file
  if (selections === null) {
    return ml.create_text_to_cad_multi_file_iteration({
      client,
      body: {
        prompt,
        source_ranges: [],
        project_name:
          projectName !== '' && projectName !== 'browser'
            ? projectName
            : undefined,
        kcl_version: kclManager.kclVersion,
      },
      files: endPointFiles,
    })
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
The source range most likely refers to "startProfileAt" simply because this is the start of the profile that was swept.
If you need to operate on this cap, for example for sketching on the face, you can use the special string ${
            artifact.subType === 'end' ? 'END' : 'START'
          } i.e. \`startSketchOn(someSweepVariable, ${
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
The source range though is for the original segment before it was extruded, you can add a tag to that segment in order to refer to this wall, for example "startSketchOn(someSweepVariable, segmentTag)"
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
  return ml.create_text_to_cad_multi_file_iteration({
    client,
    body: {
      prompt,
      source_ranges: ranges,
      project_name:
        projectName !== '' && projectName !== 'browser'
          ? projectName
          : undefined,
      kcl_version: kclManager.kclVersion,
    },
    files: endPointFiles,
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
  projectFiles,
  token,
  artifactGraph,
  projectName,
}: {
  prompt: string
  selections: Selections
  projectFiles: FileMeta[]
  token?: string
  projectName: string
  artifactGraph: ArtifactGraph
}): Promise<Models['TextToCadMultiFileIteration_type'] | Error> {
  const toastId = toast.loading('Submitting to Text-to-CAD API...')

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
      projectFiles,
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
  projectFiles,
  token,
  artifactGraph,
  projectName,
  basePath,
}: {
  prompt: string
  selections: Selections
  projectFiles: FileMeta[]
  token?: string
  artifactGraph: ArtifactGraph
  projectName: string
  basePath: string
}) {
  const result = await doPromptEdit({
    prompt,
    selections,
    projectFiles,
    token,
    artifactGraph,
    projectName,
  })
  if (err(result)) return Promise.reject(result)
  const oldCodeWebAppOnly = codeManager.code
  // TODO remove once endpoint isn't returning fake data.
  const outputs: TextToCadMultiFileIteration_type['outputs'] = {}
  Object.entries(result.outputs).forEach(([key, value]) => {
    outputs[key] = value + '\n// yoyo a comment'
  })

  if (!isDesktop() && Object.values(outputs).length > 1) {
    const toastId = uuidv4()
    toast.error(
      (t) => (
        <div className="flex flex-col gap-2">
          <p>Multiple files were returned from Text-to-CAD.</p>
          <p>You need to use the desktop app to support this.</p>
          <div className="flex justify-between items-center mt-2">
            <>
              <a
                href="https://zoo.dev/modeling-app/download"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline flex align-middle"
                onClick={openExternalBrowserIfDesktop(
                  'https://zoo.dev/modeling-app/download'
                )}
              >
                <CustomIcon
                  name="link"
                  className="w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40"
                />
                Download Desktop App
              </a>
            </>
            <ActionButton
              Element="button"
              iconStart={{
                icon: 'close',
              }}
              name="Dismiss"
              onClick={() => {
                toast.dismiss(toastId)
              }}
            >
              Dismiss
            </ActionButton>
          </div>
        </div>
      ),
      {
        id: toastId,
        duration: Infinity,
        icon: null,
      }
    )
    return
  }

  if (isDesktop()) {
    // write all of the outputs to disk
    for (const [relativePath, fileContents] of Object.entries(outputs)) {
      window.electron.writeFile(
        window.electron.join(basePath, relativePath),
        fileContents
      )
    }
  } else {
    const newCode = outputs['main.kcl']
    codeManager.updateCodeEditor(newCode)
    const diff = reBuildNewCodeWithRanges(oldCodeWebAppOnly, newCode)
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
  }
  const toastId = uuidv4()

  toast.success(
    () =>
      ToastPromptToEditCadSuccess({
        toastId,
        data: result,
        token,
        oldCodeWebAppOnly,
        oldFiles: projectFiles,
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
