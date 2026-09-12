import { createLiteral } from '@src/lang/create'
import {
  addChamfer,
  addFillet,
  insertPrimitiveEdgeVariablesAndOffsetPathToNode,
} from '@src/lang/modifyAst/edges'
import { addDeleteFace, addOffsetPlane } from '@src/lang/modifyAst/faces'
import {
  addDistanceGdt,
  addFlatnessGdt,
  addStraightnessGdt,
} from '@src/lang/modifyAst/gdt'
import { addMirror3D } from '@src/lang/modifyAst/transforms'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  type Artifact,
  assertParse,
  recast,
  type SourceRange,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type {
  EnginePrimitiveSelection,
  NonCodeSelection,
} from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, test } from 'vitest'

const tolerance = (
  instance: Awaited<
    ReturnType<typeof buildTheWorldAndNoEngineConnection>
  >['instance']
) => ({
  valueAst: createLiteral(0.1, instance),
  valueText: '0.1',
  valueCalculated: '0.1',
})

function codeRefFor(
  code: string,
  ast: ReturnType<typeof assertParse>,
  source: string
) {
  const start = code.indexOf(source)
  if (start < 0) {
    throw new Error(`Could not find source: ${source}`)
  }
  const range = [start, start + source.length, 0] as SourceRange
  return { range, pathToNode: getNodePathFromSourceRange(ast, range) }
}

test('adds faceId and deleteFace calls for an imported BREP face', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const codeRef = {
    range,
    pathToNode: getNodePathFromSourceRange(ast, range),
  }
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef,
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveFace: NonCodeSelection = {
    type: 'enginePrimitive',
    entityId: 'imported-face',
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    bodyPath: [3, 7],
    primitiveIndex: 4,
    primitiveType: 'face',
  }

  const result = addDeleteFace({
    ast,
    artifactGraph,
    faces: {
      graphSelections: [],
      otherSelections: [primitiveFace],
    },
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  const newCode = recast(result.modifiedAst, instance)
  expect(
    newCode
  ).toContain(`${code}body001 = bodyOf(importedPart, path = [3, 7])
face001 = faceId(body001, index = 4)
surface001 = deleteFace(importedPart, faces = face001)`)
})

test('adds an offset plane from an imported BREP engine primitive face', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: {
      range,
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveFace: EnginePrimitiveSelection = {
    type: 'enginePrimitive',
    entityId: 'imported-face',
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    kclBodyArtifactType: 'importedGeometry',
    bodyPath: [3, 7],
    primitiveIndex: 4,
    primitiveType: 'face',
  }

  const result = addOffsetPlane({
    ast,
    artifactGraph,
    variables: {},
    plane: {
      graphSelections: [],
      otherSelections: [primitiveFace],
    },
    offset: tolerance(instance),
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain('body001 = bodyOf(importedPart, path = [3, 7])')
  expect(newCode).toContain('face001 = faceId(body001, index = 4)')
  expect(newCode).toContain('plane001 = planeOf(body001, face = face001)')
  expect(newCode).toContain('plane002 = offsetPlane(plane001, offset = 0.1)')
})

test('uses an imported BREP engine primitive face as a mirror plane', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const importSource = 'import "part.step" as importedPart'
  const solidSource = 'solid001 = extrude(profile001, length = 1)'
  const code = `${importSource}
${solidSource}
`
  const ast = assertParse(code, instance)
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: codeRefFor(code, ast, importSource),
  } as Artifact
  const solid = {
    type: 'sweep',
    id: 'solid-body',
    codeRef: codeRefFor(code, ast, solidSource),
  } as Extract<Artifact, { type: 'sweep' }>
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
    [solid.id, solid],
  ])
  const primitiveFace: EnginePrimitiveSelection = {
    type: 'enginePrimitive',
    entityId: 'imported-face',
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    kclBodyArtifactType: 'importedGeometry',
    bodyPath: [3, 7],
    primitiveIndex: 4,
    primitiveType: 'face',
  }

  const result = addMirror3D({
    ast,
    artifactGraph,
    variables: {},
    bodies: {
      graphSelections: [{ artifact: solid, codeRef: solid.codeRef }],
      otherSelections: [],
    },
    across: {
      graphSelections: [],
      otherSelections: [primitiveFace],
    },
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain('body001 = bodyOf(importedPart, path = [3, 7])')
  expect(newCode).toContain('face001 = faceId(body001, index = 4)')
  expect(newCode).toContain('plane001 = planeOf(body001, face = face001)')
  expect(newCode).toContain('solid002 = mirror3d(solid001, across = plane001)')
})

test('deletes faces from different nested bodies through their root import', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: {
      range,
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveFace = (
    entityId: string,
    bodyPath: number[],
    primitiveIndex: number
  ): NonCodeSelection => ({
    type: 'enginePrimitive',
    entityId,
    parentEntityId: `${entityId}-body`,
    kclBodyId: importedGeometry.id,
    bodyPath,
    primitiveIndex,
    primitiveType: 'face',
  })

  const result = addDeleteFace({
    ast,
    artifactGraph,
    faces: {
      graphSelections: [],
      otherSelections: [
        primitiveFace('first-face', [0], 4),
        primitiveFace('second-face', [1], 5),
      ],
    },
    wasmInstance: instance,
  })
  if (err(result)) throw result

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain(`${code}body001 = bodyOf(importedPart, path = [0])
face001 = faceId(body001, index = 4)
body002 = bodyOf(importedPart, path = [1])
face002 = faceId(body002, index = 5)
surface001 = deleteFace(importedPart, faces = [face001, face002])`)
})

test('deletes coded faces from different nested bodies through their root import', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const importSource = 'import "part.step" as importedPart'
  const firstBodySource = 'body001 = bodyOf(importedPart, path = [0])'
  const firstFaceSource = 'face001 = faceId(body001, index = 4)'
  const secondParentSource = 'body002 = bodyOf(importedPart, path = [1])'
  const secondBodySource = 'body003 = bodyOf(body002, path = [2])'
  const secondFaceSource = 'face002 = faceId(body003, index = 5)'
  const code = `${importSource}
${firstBodySource}
${firstFaceSource}
${secondParentSource}
${secondBodySource}
${secondFaceSource}
`
  const ast = assertParse(code, instance)
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: codeRefFor(code, ast, importSource),
  } as Artifact
  const firstBody = {
    type: 'importedGeometry',
    id: 'first-body',
    codeRef: codeRefFor(code, ast, firstBodySource),
  } as Artifact
  const secondBody = {
    type: 'importedGeometry',
    id: 'second-body',
    codeRef: codeRefFor(code, ast, secondBodySource),
  } as Artifact
  const secondParent = {
    type: 'importedGeometry',
    id: 'second-parent',
    codeRef: codeRefFor(code, ast, secondParentSource),
  } as Artifact
  const firstFace = {
    type: 'primitiveFace',
    id: 'first-face',
    solidId: firstBody.id,
    codeRef: codeRefFor(code, ast, firstFaceSource),
  } as Extract<Artifact, { type: 'primitiveFace' }>
  const secondFace = {
    type: 'primitiveFace',
    id: 'second-face',
    solidId: secondBody.id,
    codeRef: codeRefFor(code, ast, secondFaceSource),
  } as Extract<Artifact, { type: 'primitiveFace' }>
  const artifactGraph = new Map<string, Artifact>(
    [
      importedGeometry,
      firstBody,
      secondParent,
      secondBody,
      firstFace,
      secondFace,
    ].map((artifact) => [artifact.id, artifact])
  )

  const result = addDeleteFace({
    ast,
    artifactGraph,
    faces: {
      graphSelections: [firstFace, secondFace].map((artifact) => ({
        artifact,
        codeRef: artifact.codeRef,
      })),
      otherSelections: [],
    },
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  expect(recast(result.modifiedAst, instance)).toContain(
    'surface001 = deleteFace(importedPart, faces = [face001, face002])'
  )
})

test('keeps equal edge indices from different nested imported bodies', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: {
      range,
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveEdgeSelections: EnginePrimitiveSelection[] = [
    {
      type: 'enginePrimitive',
      entityId: 'first-edge',
      parentEntityId: 'first-engine-body',
      kclBodyId: importedGeometry.id,
      bodyPath: [0],
      primitiveIndex: 4,
      primitiveType: 'edge',
    },
    {
      type: 'enginePrimitive',
      entityId: 'second-edge',
      parentEntityId: 'second-engine-body',
      kclBodyId: importedGeometry.id,
      bodyPath: [1],
      primitiveIndex: 4,
      primitiveType: 'edge',
    },
  ]

  const result = insertPrimitiveEdgeVariablesAndOffsetPathToNode({
    primitiveEdgeSelections,
    bodies: new Map(),
    modifiedAst: ast,
    artifactGraph,
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  const newCode = recast(ast, instance)
  expect(newCode).toContain(`${code}body001 = bodyOf(importedPart, path = [0])
edge001 = edgeId(body001, index = 4)
body002 = bodyOf(importedPart, path = [1])
edge002 = edgeId(body002, index = 4)`)
})

test('adds GD&T to an imported BREP face through faceId', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: {
      range,
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveFace: EnginePrimitiveSelection = {
    type: 'enginePrimitive',
    entityId: 'imported-face',
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    kclBodyArtifactType: 'importedGeometry',
    bodyPath: [3, 7],
    primitiveIndex: 4,
    primitiveType: 'face',
  }

  const result = addFlatnessGdt({
    ast,
    artifactGraph,
    faces: {
      graphSelections: [],
      otherSelections: [primitiveFace],
    },
    tolerance: tolerance(instance),
    wasmInstance: instance,
  })
  if (err(result)) throw result

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain('body001 = bodyOf(importedPart, path = [3, 7])')
  expect(newCode).toContain('face001 = faceId(body001, index = 4)')
  expect(newCode).toContain('gdt::flatness(')
  expect(newCode).toContain('faces = [face001]')
})

test('reuses one bodyOf variable for faces on the same nested body', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: {
      range,
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveFace = (entityId: string, primitiveIndex: number) =>
    ({
      type: 'enginePrimitive',
      entityId,
      parentEntityId: 'imported-engine-body',
      kclBodyId: importedGeometry.id,
      kclBodyArtifactType: 'importedGeometry',
      bodyPath: [3, 7],
      primitiveIndex,
      primitiveType: 'face',
    }) satisfies EnginePrimitiveSelection

  const result = addFlatnessGdt({
    ast,
    artifactGraph,
    faces: {
      graphSelections: [],
      otherSelections: [
        primitiveFace('first-imported-face', 4),
        primitiveFace('second-imported-face', 5),
      ],
    },
    tolerance: tolerance(instance),
    wasmInstance: instance,
  })
  if (err(result)) throw result

  const newCode = recast(result.modifiedAst, instance)
  if (err(newCode)) throw newCode
  expect(newCode.match(/bodyOf\(/g)).toHaveLength(1)
  expect(newCode).toContain('face001 = faceId(body001, index = 4)')
  expect(newCode).toContain('face002 = faceId(body001, index = 5)')
  expect(newCode).toContain('faces = [face001]')
  expect(newCode).toContain('faces = [face002]')
})

test('adds GD&T to an imported BREP edge through edgeId', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: {
      range,
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveEdge: EnginePrimitiveSelection = {
    type: 'enginePrimitive',
    entityId: 'imported-edge',
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    kclBodyArtifactType: 'importedGeometry',
    bodyPath: [0],
    primitiveIndex: 4,
    primitiveType: 'edge',
  }

  const result = addStraightnessGdt({
    ast,
    artifactGraph,
    objects: {
      graphSelections: [],
      otherSelections: [primitiveEdge],
    },
    tolerance: tolerance(instance),
    wasmInstance: instance,
  })
  if (err(result)) throw result

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain('body001 = bodyOf(importedPart, path = [0])')
  expect(newCode).toContain('edge001 = edgeId(body001, index = 4)')
  expect(newCode).toContain('gdt::straightness(')
  expect(newCode).toContain('edges = [edge001]')
})

test('adds GD&T to an already-coded imported BREP edge', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const edgeSource = 'edge001 = edgeId(body001, index = 4)'
  const code = `import "part.step" as importedPart
body001 = bodyOf(importedPart, path = [0])
${edgeSource}
`
  const ast = assertParse(code, instance)
  const primitiveEdge = {
    type: 'primitiveEdge',
    id: 'imported-edge',
    solidId: 'imported-body',
    codeRef: codeRefFor(code, ast, edgeSource),
  } as Extract<Artifact, { type: 'primitiveEdge' }>

  const result = addStraightnessGdt({
    ast,
    artifactGraph: new Map([[primitiveEdge.id, primitiveEdge]]),
    objects: {
      graphSelections: [
        { artifact: primitiveEdge, codeRef: primitiveEdge.codeRef },
      ],
      otherSelections: [],
    },
    tolerance: tolerance(instance),
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain('gdt::straightness(')
  expect(newCode).toContain('edges = [edge001]')
})

for (const operation of ['fillet', 'chamfer'] as const) {
  test(`adds ${operation} to an already-coded imported BREP edge`, async () => {
    const { instance } = await buildTheWorldAndNoEngineConnection()
    const bodySource = 'body001 = bodyOf(importedPart, path = [0])'
    const edgeSources = [
      'edge001 = edgeId(body001, index = 4)',
      'edge002 = edgeId(body001, index = 5)',
    ]
    const code = `@settings(kclVersion = "3.0-preview")
import "part.step" as importedPart
${bodySource}
${edgeSources.join('\n')}
`
    const ast = assertParse(code, instance)
    const importedGeometry = {
      type: 'importedGeometry',
      id: 'imported-body',
      codeRef: codeRefFor(code, ast, bodySource),
    } as Artifact
    const primitiveEdges = edgeSources.map(
      (edgeSource, index) =>
        ({
          type: 'primitiveEdge',
          id: `imported-edge-${index}`,
          solidId: importedGeometry.id,
          codeRef: codeRefFor(code, ast, edgeSource),
        }) as Extract<Artifact, { type: 'primitiveEdge' }>
    )
    const artifactGraph = new Map<string, Artifact>([
      [importedGeometry.id, importedGeometry],
      ...primitiveEdges.map((edge) => [edge.id, edge] as const),
    ])
    const selection = {
      graphSelections: primitiveEdges.map((edge) => ({
        artifact: edge,
        codeRef: edge.codeRef,
      })),
      otherSelections: [],
    }
    const size = tolerance(instance)
    const version = {
      valueAst: createLiteral(1, instance),
      valueText: '1',
      valueCalculated: '1',
    }
    const result =
      operation === 'fillet'
        ? addFillet({
            ast,
            artifactGraph,
            selection,
            radius: size,
            version,
            wasmInstance: instance,
          })
        : addChamfer({
            ast,
            artifactGraph,
            selection,
            length: size,
            version,
            wasmInstance: instance,
          })
    if (err(result)) throw result

    const newCode = recast(result.modifiedAst, instance)
    expect(newCode).toContain(`${operation}001 = ${operation}(`)
    expect(newCode).toContain('body001')
    expect(newCode).toContain('tags = [edge001, edge002]')
    expect(newCode).not.toContain('version =')
  })
}

test('preserves imported BREP selection order for GD&T distance', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: {
      range,
      pathToNode: getNodePathFromSourceRange(ast, range),
    },
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitive = (
    primitiveType: 'face' | 'edge',
    primitiveIndex: number
  ): EnginePrimitiveSelection => ({
    type: 'enginePrimitive',
    entityId: `imported-${primitiveType}`,
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    kclBodyArtifactType: 'importedGeometry',
    bodyPath: [0],
    primitiveIndex,
    primitiveType,
  })

  const result = addDistanceGdt({
    ast,
    artifactGraph,
    objects: {
      graphSelections: [],
      otherSelections: [primitive('edge', 4), primitive('face', 5)],
    },
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain('from = edge001')
  expect(newCode).toContain('to = face001')
})

test('preserves mixed coded and uncoded BREP selection order for GD&T distance', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const importSource = 'import "part.step" as importedPart'
  const edgeSource = 'edge001 = edgeId(body001, index = 4)'
  const code = `${importSource}
body001 = bodyOf(importedPart, path = [0])
${edgeSource}
`
  const ast = assertParse(code, instance)
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef: codeRefFor(code, ast, importSource),
  } as Artifact
  const primitiveEdge = {
    type: 'primitiveEdge',
    id: 'coded-imported-edge',
    solidId: importedGeometry.id,
    codeRef: codeRefFor(code, ast, edgeSource),
  } as Extract<Artifact, { type: 'primitiveEdge' }>
  const uncodedFace: EnginePrimitiveSelection = {
    type: 'enginePrimitive',
    selectionOrder: 0,
    entityId: 'uncoded-imported-face',
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    kclBodyArtifactType: 'importedGeometry',
    bodyPath: [0],
    primitiveIndex: 5,
    primitiveType: 'face',
  }

  const result = addDistanceGdt({
    ast,
    artifactGraph: new Map([
      [importedGeometry.id, importedGeometry],
      [primitiveEdge.id, primitiveEdge],
    ]),
    objects: {
      graphSelections: [
        {
          selectionOrder: 1,
          artifact: primitiveEdge,
          codeRef: primitiveEdge.codeRef,
        },
      ],
      otherSelections: [uncodedFace],
    },
    wasmInstance: instance,
  })
  if (err(result)) throw result

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain('from = face001')
  expect(newCode).toContain('to = edge001')
})

for (const operation of ['fillet', 'chamfer'] as const) {
  test(`adds ${operation} for an imported BREP edge`, async () => {
    const { instance } = await buildTheWorldAndNoEngineConnection()
    const importSource = 'import "part.step" as importedPart'
    const code = `@settings(kclVersion = "3.0-preview")
${importSource}
`
    const ast = assertParse(code, instance)
    const importedGeometry = {
      type: 'importedGeometry',
      id: 'imported-body',
      codeRef: codeRefFor(code, ast, importSource),
    } as Artifact
    const artifactGraph = new Map<string, Artifact>([
      [importedGeometry.id, importedGeometry],
    ])
    const primitiveEdge: EnginePrimitiveSelection = {
      type: 'enginePrimitive',
      entityId: 'imported-edge',
      parentEntityId: 'imported-engine-body',
      kclBodyId: importedGeometry.id,
      kclBodyArtifactType: 'importedGeometry',
      bodyPath: [0],
      primitiveIndex: 4,
      primitiveType: 'edge',
    }
    const selection = {
      graphSelections: [],
      otherSelections: [primitiveEdge],
    }
    const size = tolerance(instance)
    const version = {
      valueAst: createLiteral(1, instance),
      valueText: '1',
      valueCalculated: '1',
    }
    const result =
      operation === 'fillet'
        ? addFillet({
            ast,
            artifactGraph,
            selection,
            radius: size,
            version,
            wasmInstance: instance,
          })
        : addChamfer({
            ast,
            artifactGraph,
            selection,
            length: size,
            version,
            wasmInstance: instance,
          })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst, instance)
    expect(newCode).toContain('body001 = bodyOf(importedPart, path = [0])')
    expect(newCode).toContain('edge001 = edgeId(body001, index = 4)')
    expect(newCode).toContain(`${operation}001 = ${operation}(`)
    expect(newCode).toContain('tags = edge001')
    expect(newCode).toContain(
      `${operation === 'fillet' ? 'radius' : 'length'} = 0.1`
    )
    expect(newCode).not.toContain('version =')
  })
}
