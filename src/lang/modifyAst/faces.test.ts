import env from '@src/env'
import {
  type Artifact,
  assertParse,
  type CodeRef,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { addShell } from '@src/lang/modifyAst/faces'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { initPromise } from '@src/lang/wasmUtils'
import { engineCommandManager, kclManager } from '@src/lib/singletons'

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast
  await kclManager.executeAst({ ast })
  const artifactGraph = kclManager.artifactGraph

  expect(kclManager.errors).toEqual([])
  return { ast, artifactGraph }
}

function createSelectionFromPathArtifact(
  artifacts: (Artifact & { codeRef: CodeRef })[]
): Selections {
  const graphSelections = artifacts.map(
    (artifact) =>
      ({
        codeRef: artifact.codeRef,
        artifact,
      }) as Selection
  )
  return {
    graphSelections,
    otherSelections: [],
  }
}

async function getAstAndSketchSelections(code: string) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifacts)
  return { artifactGraph, ast, sketches }
}

async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

// Unfortunately, we need the real engine here it seems to get sweep faces populated
beforeAll(async () => {
  await initPromise

  await new Promise((resolve) => {
    engineCommandManager.start({
      token: env().VITE_KITTYCAD_API_TOKEN,
      width: 256,
      height: 256,
      setMediaStream: () => {},
      setIsStreamReady: () => {},
      callbackOnEngineLiteConnect: () => {
        resolve(true)
      },
    })
  })
}, 30_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

describe('Testing addShell', () => {
  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)
`
    const {
      artifactGraph,
      ast,
      sketches: solids,
    } = await getAstAndSketchSelections(code)
    if (
      solids.graphSelections.length === 0 ||
      !solids.graphSelections[0].artifact
    ) {
      throw new Error('No solids found in the graph selections')
    }

    const endFace = [...artifactGraph.values()].find(
      (a) => a.type === 'cap' && a.subType === 'end'
    )
    if (!endFace || endFace.type !== 'cap' || endFace.subType !== 'end') {
      throw new Error('End face not found in the artifact graph')
    }
    const faces: Selections = {
      graphSelections: [
        {
          codeRef: endFace.faceCodeRef,
          artifact: endFace,
        },
      ],
      otherSelections: [],
    }
    const thickness = await getKclCommandValue('1')
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(
      `shell001 = shell(extrude001, faces = [END], thickness = 1)`
    )
    await enginelessExecutor(ast)
  })

  // TODO: missing multi wall test

  // TODO: missing multi solid test

  // TODO: missing edit flow test
})
