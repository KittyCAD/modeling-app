import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { ExecState, Program } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { rustContext } from '@src/lib/singletons'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclSingleton'
import { type Artifact, type ArtifactGraph, assertParse } from '@src/lang/wasm'
import type { Selections, Selection } from '@src/machines/modelingSharedTypes'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'

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
