import type { OpArg } from '@rust/kcl-lib/bindings/Operation'
import { retrieveSelectionsFromOpArg } from '@src/lang/queryAst'
import type {
  Artifact,
  ArtifactGraph,
  PathToNode,
  SourceRange,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { expect, it } from 'vitest'

const nonEmptyPath = [['body', '']] as unknown as PathToNode

function getPatternSourceFixture(
  argExpression: string,
  arrayValue = false,
  patternDeclaration = 'pattern001 = patternLinear3d(extrude001, instances = 3, distance = 5, axis = X)'
) {
  const code = `extrude001 = 0
${patternDeclaration}
translate(${argExpression}, x = 5)`
  const patternCallStart = code.indexOf('patternLinear3d')
  const patternRange: SourceRange = [
    patternCallStart,
    code.indexOf('\n', patternCallStart),
    0,
  ]
  const sourceRange: SourceRange = [
    code.lastIndexOf(argExpression),
    code.lastIndexOf(argExpression) + argExpression.length,
    0,
  ]
  const pattern: Extract<Artifact, { type: 'pattern' }> = {
    type: 'pattern',
    id: 'pattern-command-id',
    subType: 'linear',
    sourceId: 'source-body-id',
    copyIds: ['copy-body-1', 'copy-body-2'],
    copyFaceIds: [],
    copyEdgeIds: [],
    codeRef: {
      range: patternRange,
      pathToNode: nonEmptyPath,
      nodePath: { steps: [] },
    },
  }
  const sourceCodeRef = {
    range: [code.indexOf('0'), code.indexOf('0') + 1, 0] as SourceRange,
    pathToNode: nonEmptyPath,
    nodePath: { steps: [] },
  }
  const sourceBody = {
    type: 'sweep',
    id: pattern.sourceId,
    codeRef: sourceCodeRef,
  } as unknown as Artifact
  const artifactGraph: ArtifactGraph = new Map([
    [pattern.id, pattern],
    [sourceBody.id, sourceBody],
  ])
  const solidValue = (artifactId: string) => ({
    type: 'Solid' as const,
    value: { artifactId },
  })
  const opArg = {
    value: arrayValue
      ? {
          type: 'Array',
          value: [solidValue(pattern.sourceId), solidValue(pattern.copyIds[0])],
        }
      : solidValue(pattern.sourceId),
    sourceRange,
  } as unknown as OpArg

  return { artifactGraph, code, opArg, pattern, sourceBody, sourceCodeRef }
}

it('recovers an explicit pattern source index from an operation argument', () => {
  const { artifactGraph, code, opArg, pattern } =
    getPatternSourceFixture('pattern001[0]')

  const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph, code)
  if (err(selections)) throw selections

  expect(selections.graphSelections).toEqual([
    {
      artifact: pattern,
      codeRef: pattern.codeRef,
      engineEntityId: pattern.sourceId,
      patternIndex: 0,
    },
  ])
})

it('keeps a direct pattern source reference as the source body', () => {
  const { artifactGraph, code, opArg, sourceBody, sourceCodeRef } =
    getPatternSourceFixture('extrude001')

  const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph, code)
  if (err(selections)) throw selections

  expect(selections.graphSelections).toEqual([
    {
      artifact: sourceBody,
      codeRef: sourceCodeRef,
    },
  ])
})

it('recovers pattern index zero inside an array argument', () => {
  const { artifactGraph, code, opArg, pattern } = getPatternSourceFixture(
    '[pattern001[0], pattern001[1]]',
    true
  )

  const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph, code)
  if (err(selections)) throw selections

  expect(
    selections.graphSelections.map((selection) => selection.patternIndex)
  ).toEqual([0, 1])
  expect(
    selections.graphSelections.every(
      (selection) => selection.artifact === pattern
    )
  ).toBe(true)
})

it('recovers pattern index zero when the pattern call is piped', () => {
  const { artifactGraph, code, opArg, pattern } = getPatternSourceFixture(
    'pattern001[0]',
    false,
    `pattern001 = extrude001
  |> patternLinear3d(instances = 3, distance = 5, axis = X)`
  )

  const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph, code)
  if (err(selections)) throw selections

  expect(selections.graphSelections[0]).toMatchObject({
    artifact: pattern,
    engineEntityId: pattern.sourceId,
    patternIndex: 0,
  })
})
