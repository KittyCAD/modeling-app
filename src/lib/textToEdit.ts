import { Models } from '@kittycad/lib'
import { VITE_KC_API_BASE_URL } from 'env'
import crossPlatformFetch from './crossPlatformFetch'
import { err, reportRejection } from './trap'
import { toSync } from './utils'
import { Selections } from './selections'
import { ArtifactGraph, getArtifactOfTypes } from 'lang/std/artifactGraph'
import { SourceRange } from 'lang/wasm'

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
}: {
  prompt: string
  selections: Selections
  code: string
  token?: string
  artifactGraph: ArtifactGraph
}): Promise<Models['TextToCadIteration_type'] | Error> {
  const ranges: Models['TextToCadIterationBody_type']['source_ranges'] =
    selections.graphSelections.flatMap((selection) => {
      const artifact = selection.artifact
      const prompts: Models['TextToCadIterationBody_type']['source_ranges'] = []

      if (artifact?.type === 'cap') {
        prompts.push({
          prompt: `The users main selection is the end cap of a general-sweep (that is an extrusion, revolve, sweep or loft).
The source range most likely refers to "startProfileAt" simply because this is the start of the profile that was swept.
If you need to operate on this cap, for example for sketching on the face, you can use the special string ${
            artifact.subType === 'end' ? 'END' : 'START'
          } i.e. \`startSketchOn(someSweepVariable, ${
            artifact.subType === 'end' ? 'END' : 'START'
          })\`
When they made this selection they main have intended this surface directly or meant something more broad like the sweep itself.
See later source ranges for more context.`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
          })
        }
      }
      if (artifact?.type === 'wall') {
        prompts.push({
          prompt: `The users main selection is the wall of a general-sweep (that is an extrusion, revolve, sweep or loft).
The source range though is for the original segment before it was extruded, you can add a tag to that segment in order to refer to this wall, for example "startSketchOn(someSweepVariable, segmentTag)"
But it's also worth bearing in mind that the user may have intended to select the sweep itself, not this individual wall, see later source ranges for more context. about the sweep`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
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
        })
        let sweep = getArtifactOfTypes(
          { key: artifact.sweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweep)) {
          prompts.push({
            prompt: `This is the sweep's source range from the user's main selection of the end cap.`,
            range: convertAppRangeToApiRange(sweep.codeRef.range, code),
          })
        }
      }
      if (artifact?.type === 'segment') {
        prompts.push({
          prompt: `This selection is of a segment, likely an individual part of a profile. Segments are often "constrained" by the use of variables and relationships with other segments. Adding tags to segments helps refer to their length, angle or other properties`,
          range: convertAppRangeToApiRange(selection.codeRef.range, code),
        })
      }
      return prompts
    })
  console.log('prompts')
  ranges.map((a) => console.log(a.prompt))
  const body: Models['TextToCadIterationBody_type'] = {
    original_source_code: code,
    prompt,
    source_ranges: ranges,
  }
  const url = VITE_KC_API_BASE_URL + '/ml/text-to-cad/iteration'
  const data: Models['TextToCadIteration_type'] | Error =
    await crossPlatformFetch(
      url,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      token
    )

  // Make sure we have an id.
  if (data instanceof Error) {
    return data
  }

  if (!data.id) {
    return new Error('No id returned from Text-to-CAD API')
  }
  console.log('data', data)
  return data
}

export async function getPromptToEditResult(
  id: string,
  token?: string
): Promise<Models['TextToCadIteration_type'] | Error> {
  const url = VITE_KC_API_BASE_URL + '/async/operations/' + id
  const data: Models['TextToCadIteration_type'] | Error =
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
}: {
  prompt: string
  selections: Selections
  code: string
  token?: string
  artifactGraph: ArtifactGraph
}): Promise<Models['TextToCadIteration_type'] | Error> {
  const submitResult = await submitPromptToEditToQueue({
    prompt,
    selections,
    code,
    token,
    artifactGraph,
  })
  if (err(submitResult)) return submitResult

  const textToCadComplete = new Promise<Models['TextToCadIteration_type']>(
    (resolve, reject) => {
      ;(async () => {
        // const value = await textToCadQueued
        // if (value instanceof Error) {
        //   reject(value)
        // }

        const MAX_CHECK_TIMEOUT = 3 * 60_000
        const CHECK_INTERVAL = 3000

        let timeElapsed = 0
        const interval = setInterval(
          toSync(async () => {
            timeElapsed += CHECK_INTERVAL
            if (timeElapsed >= MAX_CHECK_TIMEOUT) {
              clearInterval(interval)
              reject(new Error('Text-to-CAD API timed out'))
            }

            const check = await getPromptToEditResult(submitResult.id, token)
            if (check instanceof Error) {
              clearInterval(interval)
              reject(check)
            }

            if (check instanceof Error || check.status === 'failed') {
              console.log('check failed', check)
              clearInterval(interval)
              reject(check)
            } else if (check.status === 'completed') {
              clearInterval(interval)
              resolve(check)
            }
          }, reportRejection),
          CHECK_INTERVAL
        )
      })().catch(reportRejection)
    }
  )

  try {
    const result = await textToCadComplete
    console.log('textToCadComplete', result)
    return result
  } catch (e) {
    console.error('textToCadComplete', e)
  }

  return textToCadComplete
}
