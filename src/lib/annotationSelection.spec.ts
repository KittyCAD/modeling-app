import { afterAll, beforeAll, expect, test } from 'vitest'

import {
  artifactToEntityRef,
  resolveToCodeRef,
  selectionV2Equals,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact, SourceRange } from '@src/lang/wasm'
import { assertParse, defaultNodePath } from '@src/lang/wasm'
import {
  getCodeRefsFromEntityReference,
  getEventForQueryEntityTypeWithPoint,
  handleSelectionBatch,
  normalizeEntityReference,
} from '@src/lib/selections'
import type {
  EntityReference,
  Selections,
} from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

const code = `@settings(kclVersion = 3.0)
datumA = gdt::datum(face = capEnd001, name = "A")`
const reference = {
  type: 'annotation',
  annotation_id: 'annotation-id',
} satisfies EntityReference
let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
let annotation: Extract<Artifact, { type: 'gdtAnnotation' }>

beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
  const ast = assertParse(code, world.instance)
  const range: SourceRange = [code.indexOf('gdt::datum'), code.length, 0]
  annotation = {
    type: 'gdtAnnotation',
    id: reference.annotation_id,
    consumed: false,
    codeRef: {
      range,
      nodePath: defaultNodePath(),
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  }
  world.kclManager.astSignal.value = ast
  world.kclManager.artifactGraph = new Map([[annotation.id, annotation]])
})

afterAll(() => {
  world?.settingsActor.stop()
  world?.commandBarActor.stop()
})

test('maps annotation hover and click responses to the GD&T source', async () => {
  expect(normalizeEntityReference(reference)).toEqual(reference)
  expect(
    getCodeRefsFromEntityReference(reference, world.kclManager.artifactGraph)
  ).toEqual([{ range: annotation.codeRef.range }])
  expect(artifactToEntityRef(annotation.type, annotation.id)).toEqual(reference)
  expect(
    resolveToCodeRef({ entityRef: reference }, world.kclManager.artifactGraph)
  ).toEqual({ codeRef: annotation.codeRef, artifact: annotation })
  expect(
    selectionV2Equals({ entityRef: reference }, { entityRef: reference })
  ).toBe(true)
  expect(
    selectionV2Equals(
      { entityRef: reference },
      { entityRef: { type: 'annotation', annotation_id: 'another-annotation' } }
    )
  ).toBe(false)
  const event = await getEventForQueryEntityTypeWithPoint(
    { data: { reference } },
    {
      engineCommandManager: world.engineCommandManager,
      kclManager: world.kclManager,
      rustContext: world.rustContext,
      wasmInstance: world.instance,
    }
  )
  expect(event).toEqual({
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: { entityRef: reference, codeRef: annotation.codeRef },
    },
  })
})

test.each([false, true])(
  'mirrors annotation selections to the engine (mixed with a face: %s)',
  (withFace) => {
    const selections: Selections = {
      graphSelections: [{ entityRef: reference, codeRef: annotation.codeRef }],
      otherSelections: [],
    }
    if (withFace) {
      selections.graphSelections.push({
        entityRef: { type: 'face', face_id: 'face-id' },
      })
    }
    Object.defineProperty(world.engineCommandManager, 'connection', {
      value: { pingIntervalId: 1 },
      writable: true,
      configurable: true,
    })
    try {
      const result = handleSelectionBatch({
        selections,
        artifactGraph: world.kclManager.artifactGraph,
        code,
        ast: world.kclManager.ast,
        systemDeps: {
          engineCommandManager: world.engineCommandManager,
          sceneEntitiesManager: world.sceneEntitiesManager,
          wasmInstance: world.instance,
        },
      })
      const commands = result.engineEvents.flatMap((event) =>
        event.type === 'modeling_cmd_req' ? [event.cmd] : []
      )
      expect(commands).toEqual([
        withFace
          ? {
              type: 'select_entity',
              entities: [{ type: 'face', face_id: 'face-id' }],
            }
          : { type: 'select_clear' },
        { type: 'select_add', entities: [annotation.id] },
      ])
    } finally {
      world.engineCommandManager.connection = undefined
    }
  }
)
