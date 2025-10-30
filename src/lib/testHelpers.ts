import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  assertParse,
  type CodeRef,
  type Artifact,
  type ArtifactGraph,
  type ExecState,
  type Program,
} from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { rustContext } from '@src/lib/singletons'
import type RustContext from '@src/lib/rustContext'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import type { Selections, Selection } from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclSingleton'

export async function enginelessExecutor(
  ast: Node<Program>,
  usePrevMemory?: boolean,
  path?: string,
  providedRustContext?: RustContext
): Promise<ExecState> {
  const settings = await jsAppSettings()
  const theRustContext = providedRustContext ? providedRustContext : rustContext
  return await theRustContext.executeMock(ast, settings, path, usePrevMemory)
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
    } as Selection
  })
  return {
    graphSelections,
    otherSelections: [],
  }
}

export function createSelectionFromPathArtifact(
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

export function getCapFromCylinder(artifactGraph: ArtifactGraph) {
  const endFace = [...artifactGraph.values()].find(
    (a) => a.type === 'cap' && a.subType === 'end'
  )
  return createSelectionFromArtifacts([endFace!], artifactGraph)
}

export function getFacesFromBox(artifactGraph: ArtifactGraph, count: number) {
  const twoWalls = [...artifactGraph.values()]
    .filter((a) => a.type === 'wall')
    .slice(0, count)
  return createSelectionFromArtifacts(twoWalls, artifactGraph)
}
