import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { findOperationForArtifact } from '@src/lang/queryAst'
import { defaultNodePath } from '@src/lang/wasm'
import type { Artifact, SourceRange } from '@src/lang/wasm'
import { describe, expect, it } from 'vitest'

function range(start: number, end: number, moduleId = 0): SourceRange {
  return [start, end, moduleId]
}

function gdtOperation(
  sourceRange: SourceRange,
  stdlibEntrySourceRange?: SourceRange
): Operation {
  const operation: Operation = {
    type: 'StdLibCall',
    name: 'gdt::flatness',
    unlabeledArg: null,
    labeledArgs: {},
    nodePath: defaultNodePath(),
    sourceRange,
    isError: false,
  }
  if (stdlibEntrySourceRange) {
    operation.stdlibEntrySourceRange = stdlibEntrySourceRange
  }
  return operation
}

function gdtAnnotationArtifact(id: string, sourceRange: SourceRange): Artifact {
  return {
    type: 'gdtAnnotation',
    id,
    codeRef: {
      range: sourceRange,
      nodePath: defaultNodePath(),
      pathToNode: [],
    },
  }
}

describe('findOperationForArtifact', () => {
  it('resolves a GD&T annotation artifact contained by its source operation', () => {
    const gdtRange = range(10, 80)
    const operation = gdtOperation(gdtRange)
    const artifact = gdtAnnotationArtifact('gdt-artifact', range(20, 70))

    expect(
      findOperationForArtifact({
        artifact,
        operations: [operation],
      })
    ).toBe(operation)
  })

  it('resolves a GD&T annotation artifact via stdlib entry range', () => {
    const declarationRange = range(0, 90, 1)
    const gdtRange = range(12, 89)
    const operation = gdtOperation(declarationRange, gdtRange)
    const artifact = gdtAnnotationArtifact('gdt-artifact', gdtRange)

    expect(
      findOperationForArtifact({
        artifact,
        operations: [operation],
      })
    ).toBe(operation)
  })

  it('does not resolve artifacts that do not point at an operation range', () => {
    const operation = gdtOperation(range(10, 80))
    const artifact = gdtAnnotationArtifact('gdt-artifact', range(90, 120))

    expect(
      findOperationForArtifact({
        artifact,
        operations: [operation],
      })
    ).toBeUndefined()
  })

  it('does not resolve artifacts in another module id', () => {
    const operation = gdtOperation(range(10, 80))
    const artifact = gdtAnnotationArtifact('gdt-artifact', range(10, 80, 1))

    expect(
      findOperationForArtifact({
        artifact,
        operations: [operation],
      })
    ).toBeUndefined()
  })
})
