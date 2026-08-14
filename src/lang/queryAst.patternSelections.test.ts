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
    sourceIds: ['source-topology-id'],
    instanceIds: ['source-body-id', 'copy-body-1', 'copy-body-2'],
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
    id: pattern.instanceIds[0],
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
          value: [
            solidValue(pattern.instanceIds[0]),
            solidValue(pattern.copyIds[0]),
          ],
        }
      : solidValue(pattern.instanceIds[0]),
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
      engineEntityId: pattern.instanceIds[0],
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

it('keeps direct and indexed references to the same source distinct in an array', () => {
  const { artifactGraph, code, opArg, pattern, sourceBody, sourceCodeRef } =
    getPatternSourceFixture('[extrude001, pattern001[0]]', true)
  if (opArg.value.type !== 'Array') throw new Error('Expected array argument')
  opArg.value.value = [
    { type: 'Solid', value: { artifactId: sourceBody.id } },
    { type: 'Solid', value: { artifactId: sourceBody.id } },
  ]

  const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph, code)
  if (err(selections)) throw selections

  expect(selections.graphSelections).toEqual([
    { artifact: sourceBody, codeRef: sourceCodeRef },
    {
      artifact: pattern,
      codeRef: pattern.codeRef,
      engineEntityId: sourceBody.id,
      patternIndex: 0,
    },
  ])
})

it('uses the ordered outputs of a multi-source pattern', () => {
  const { artifactGraph, code, opArg, pattern } =
    getPatternSourceFixture('pattern001[4]')
  pattern.sourceIds = ['source-topology-a', 'source-topology-b']
  pattern.instanceIds = [
    'source-body-a',
    'copy-body-a1',
    'copy-body-a2',
    'source-body-b',
    'copy-body-b1',
    'copy-body-b2',
  ]
  pattern.copyIds = [
    'copy-body-a1',
    'copy-body-a2',
    'copy-body-b1',
    'copy-body-b2',
  ]
  if (opArg.value.type !== 'Solid') throw new Error('Expected solid argument')
  opArg.value.value.artifactId = 'copy-body-b1'

  const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph, code)
  if (err(selections)) throw selections

  expect(selections.graphSelections).toEqual([
    {
      artifact: pattern,
      codeRef: pattern.codeRef,
      engineEntityId: 'copy-body-b1',
      patternIndex: 4,
    },
  ])
})

it('distinguishes patterns that share a source inside an array', () => {
  const declarations = `pattern001 = patternLinear3d(extrude001, instances = 3, distance = 5, axis = X)
pattern002 = patternLinear3d(extrude001, instances = 3, distance = 10, axis = X)`
  const { artifactGraph, code, opArg, pattern, sourceBody } =
    getPatternSourceFixture(
      '[pattern001[0], pattern002[0]]',
      true,
      declarations
    )
  const secondCallStart = code.lastIndexOf('patternLinear3d')
  const secondPattern: Extract<Artifact, { type: 'pattern' }> = {
    ...pattern,
    id: 'pattern-command-id-2',
    sourceIds: ['source-topology-id'],
    instanceIds: [sourceBody.id, 'copy-body-3', 'copy-body-4'],
    copyIds: ['copy-body-3', 'copy-body-4'],
    codeRef: {
      ...pattern.codeRef,
      range: [secondCallStart, code.indexOf('\n', secondCallStart), 0],
    },
  }
  artifactGraph.set(secondPattern.id, secondPattern)
  if (opArg.value.type !== 'Array') throw new Error('Expected array argument')
  opArg.value.value = [
    { type: 'Solid', value: { artifactId: sourceBody.id } },
    { type: 'Solid', value: { artifactId: sourceBody.id } },
  ]

  const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph, code)
  if (err(selections)) throw selections

  expect(
    selections.graphSelections.map((selection) => selection.artifact?.id)
  ).toEqual([pattern.id, secondPattern.id])
  expect(
    selections.graphSelections.map((selection) => selection.patternIndex)
  ).toEqual([0, 0])
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
    engineEntityId: pattern.instanceIds[0],
    patternIndex: 0,
  })
})
