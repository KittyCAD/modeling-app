import { afterAll, beforeAll, expect, test } from 'vitest'

import {
  artifactToEntityRef,
  getEntityRefId,
  resolveToCodeRef,
  selectionV2Equals,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact, SourceRange } from '@src/lang/wasm'
import { assertParse, defaultNodePath } from '@src/lang/wasm'
import {
  getCodeRefsFromEntityReference,
  getEventForQueryEntityTypeWithPoint,
  getSelectionTypeDisplayText,
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

test('resolves annotation hover and feature-tree references to the same code', () => {
  const normalized = normalizeEntityReference(reference)
  expect(normalized).toEqual(reference)
  if (!normalized) throw new Error('Annotation reference was discarded')

  expect(
    getCodeRefsFromEntityReference(normalized, world.kclManager.artifactGraph)
  ).toEqual([{ range: annotation.codeRef.range }])
  expect(artifactToEntityRef(annotation.type, annotation.id)).toEqual(reference)
  expect(getEntityRefId(normalized)).toBe(annotation.id)
  expect(
    resolveToCodeRef({ entityRef: normalized }, world.kclManager.artifactGraph)
  ).toEqual({ codeRef: annotation.codeRef, artifact: annotation })
  expect(
    selectionV2Equals({ entityRef: normalized }, { entityRef: reference })
  ).toBe(true)
  expect(
    selectionV2Equals(
      { entityRef: normalized },
      { entityRef: { type: 'annotation', annotation_id: 'another-annotation' } }
    )
  ).toBe(false)
})

test('selects the GD&T source code from an annotation click response', async () => {
  const event = await getEventForQueryEntityTypeWithPoint(
    { data: { reference } },
    {
      engineCommandManager: world.engineCommandManager,
      kclManager: world.kclManager,
      rustContext: world.rustContext,
      wasmInstance: world.instance,
    }
  )
  const selections: Selections = {
    graphSelections: [{ entityRef: reference, codeRef: annotation.codeRef }],
    otherSelections: [],
  }
  expect(event).toEqual({
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: selections.graphSelections[0],
    },
  })
  expect(
    getSelectionTypeDisplayText(
      world.kclManager.ast,
      selections,
      world.kclManager.artifactGraph
    )
  ).toBe('1 annotation')
})

test.each([false, true])(
  'mirrors annotation selections to the engine (mixed with a face: %s)',
  (withFace) => {
    Object.defineProperty(world.engineCommandManager, 'connection', {
      value: { pingIntervalId: 1 },
      writable: true,
      configurable: true,
    })
    try {
      const result = handleSelectionBatch({
        selections: {
          graphSelections: [
            { entityRef: reference, codeRef: annotation.codeRef },
            ...(withFace
              ? [
                  {
                    entityRef: {
                      type: 'face',
                      face_id: 'face-id',
                    } satisfies EntityReference,
                  },
                ]
              : []),
          ],
          otherSelections: [],
        },
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
      expect(result.codeMirrorSelection.main.head).toBe(
        annotation.codeRef.range[1]
      )
    } finally {
      world.engineCommandManager.connection = undefined
    }
  }
)
