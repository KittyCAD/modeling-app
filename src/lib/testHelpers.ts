import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { KclManager } from '@src/lang/KclManager'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import {
  type Artifact,
  type ArtifactGraph,
  type CodeRef,
  type ExecState,
  type Program,
  assertParse,
} from '@src/lang/wasm'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { expect } from 'vitest'

export const clonedRegionBody = `@settings(kclVersion = 2.0)

rectangleSketch = sketch(on = XY) {
  line1 = line(start = [var 0.42mm, var 0.91mm], end = [var 3.1mm, var 0.91mm])
  line2 = line(start = [var 3.1mm, var 0.91mm], end = [var 3.1mm, var 4.36mm])
  line3 = line(start = [var 3.1mm, var 4.36mm], end = [var 0.42mm, var 4.36mm])
  line4 = line(start = [var 0.42mm, var 4.36mm], end = [var 0.42mm, var 0.91mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden001 = hide(rectangleSketch)
region001 = region(segments = [
  rectangleSketch.line4,
  rectangleSketch.line1
])
cube1 = extrude(region001, length = 2)
cube2 = clone(cube1)
  |> translate(x = 5)`

export function getSweepEdgesForBody(
  code: string,
  variableName: string,
  artifactGraph: ArtifactGraph
) {
  const bodyStart = code.indexOf(`${variableName} =`)
  if (bodyStart < 0) return []
  const bodyPath = [...artifactGraph.values()].find(
    (artifact) =>
      artifact.type === 'path' && artifact.codeRef.range[0] >= bodyStart
  )
  if (!bodyPath) return []

  return [...artifactGraph.values()].filter(
    (artifact): artifact is Extract<Artifact, { type: 'sweepEdge' }> => {
      if (artifact.type !== 'sweepEdge') return false
      const segment = artifactGraph.get(artifact.segId)
      return segment?.type === 'segment' && segment.pathId === bodyPath.id
    }
  )
}

export async function enginelessExecutor(
  ast: Node<Program>,
  rustContext: RustContext,
  usePrevMemory?: boolean,
  path?: string
): Promise<ExecState> {
  const settings = jsAppSettings(rustContext.settingsActor)
  return await rustContext.executeMock(ast, settings, path, usePrevMemory)
}

export async function getAstAndArtifactGraph(
  code: string,
  instance: ModuleType,
  kclManager: KclManager
) {
  const ast = assertParse(code, instance)
  await kclManager.executeAst({ ast })
  const {
    artifactGraph,
    execState: { operations },
    variables,
  } = kclManager
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { ast, artifactGraph, operations, variables }
}

export async function getAstAndSketchSelections(
  code: string,
  instance: ModuleType,
  kclManager: KclManager,
  count: number | undefined = undefined
) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(
    code,
    instance,
    kclManager
  )
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Artifact not found in the graph')
  }

  const sketches = createSelectionFromPathArtifact(
    artifacts.slice(count ? -count : undefined)
  )
  return { artifactGraph, ast, sketches }
}

export function createSelectionFromArtifacts(
  artifacts: Artifact[],
  artifactGraph: ArtifactGraph
): Selections {
  const graphSelections = artifacts.flatMap((artifact) => {
    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      return []
    }

    return {
      codeRef: codeRefs[0],
      artifact,
    }
  })
  return {
    graphSelections,
    otherSelections: [],
  }
}

export function createSelectionFromPathArtifact(
  artifacts: (Artifact & { codeRef: CodeRef })[]
): Selections {
  const graphSelections = artifacts.map((artifact) => ({
    codeRef: artifact.codeRef,
    artifact,
  }))
  return {
    graphSelections,
    otherSelections: [],
  }
}

export function getCapFromCylinder(artifactGraph: ArtifactGraph) {
  const endFace = [...artifactGraph.values()].find(
    (a) => a.type === 'cap' && a.subType === 'end'
  )
  return createSelectionFromArtifacts([endFace!], artifactGraph)
}

export function getWalls(
  artifactGraph: ArtifactGraph,
  count: number,
  index = 0
) {
  const walls = [...artifactGraph.values()]
    .filter((a) => a.type === 'wall')
    .slice(index, index + count)
  return createSelectionFromArtifacts(walls, artifactGraph)
}

export async function getKclCommandValue(
  value: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const allowArrays = value.trim().startsWith('[')
  const result = await stringToKclExpression(
    value,
    rustContext,
    allowArrays ? { allowArrays: true } : undefined
  )
  if (err(result) || 'errors' in result) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

export async function runNewAstAndCheckForSweep(
  ast: Node<Program>,
  rustContext: RustContext
) {
  const { artifactGraph } = await enginelessExecutor(ast, rustContext)
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}

export async function runNewAstAndCountSweeps(
  ast: Node<Program>,
  rustContext: RustContext,
  count: number
) {
  const { artifactGraph } = await enginelessExecutor(ast, rustContext)
  const sweeps = [...artifactGraph.values()].filter((a) => a.type === 'sweep')
  expect(sweeps.length).toBe(count)
}
