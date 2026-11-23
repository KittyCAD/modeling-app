import { join } from 'path'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createLiteral } from '@src/lang/create'
import { getNodeFromPath, traverse } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { topLevelRange } from '@src/lang/util'
import type { Expr, LabeledArg, Literal, Program } from '@src/lang/wasm'
import {
  assertParse,
  nodePathFromRange,
  pathToNodeFromRustNodePath,
  recast,
} from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

const source = `@settings(kclVersion = "3.0", experimentalFeatures = allow)

planeArg = XY
fn makeProfile() {
  profile = sketch(on = planeArg) {
    // Keep the arc and its constraint when editing another binding.
    arc1 = arc(start = [var 1mm, 0mm], end = [0mm, var 2mm], center = [0mm, 0mm])
    line1 = line(start = [0mm, 0mm], end = [var 3mm, 0mm])
    tangent([arc1, line1])
    guess = var
  }
  return profile
}
// Selections and edits in this sketch must not affect the first sketch.
second = sketch(on = XZ) {
  size = 7mm
  marker = point(at = [var 7mm, var 8mm])
}
`

const bodySelections = [
  'arc(start = [var 1mm, 0mm], end = [0mm, var 2mm], center = [0mm, 0mm])',
  'var 1mm',
  'var 2mm',
  'tangent([arc1, line1])',
  'var\n',
  'point(at = [var 7mm, var 8mm])',
  'var 7mm',
  'var 8mm',
]

let instance: ModuleType

beforeAll(async () => {
  instance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

function selection(text: string) {
  // lastIndexOf skips the planeArg declaration. Callers include a newline
  // to distinguish bare `var` and the size literal from other matches.
  const start = source.lastIndexOf(text)
  expect(start).toBeGreaterThanOrEqual(0)
  return topLevelRange(start, start + text.trimEnd().length)
}

// Give each selection or edit a fresh JSON copy. Neither should depend on
// object identity or state left by the parser.
function transportedAst(): Node<Program> {
  return JSON.parse(JSON.stringify(assertParse(source, instance)))
}

describe('sketch block application contracts', () => {
  // Check selected source ranges so AST fields and path steps can change
  // when blocks are generalized.
  it.each(['planeArg', ...bodySelections])(
    'resolves an editor selection after JSON transport: %s',
    (text) => {
      const ast = transportedAst()
      const range = selection(text)
      const path = getNodePathFromSourceRange(ast, range)
      const result = getNodeFromPath<Node<Expr>>(ast, path, instance)
      if (err(result)) throw result
      expect(topLevelRange(result.node.start, result.node.end)).toEqual(range)

      const visited: string[] = []
      traverse(ast, {
        enter(node, nodePath) {
          if (
            'start' in node &&
            node.start === range[0] &&
            node.end === range[1]
          ) {
            const found = getNodeFromPath<Node<Expr>>(ast, nodePath, instance)
            if (err(found)) throw found
            visited.push(source.slice(found.node.start, found.node.end))
          }
        },
      })
      expect(visited).toContain(text.trimEnd())
    }
  )

  it.each(bodySelections)(
    'converts a Rust source path into a usable application path: %s',
    async (text) => {
      const ast = transportedAst()
      const range = selection(text)
      const rustPath = await nodePathFromRange(ast, range, instance)
      expect(rustPath).not.toBeNull()
      if (!rustPath) throw new Error('Missing source path')
      const converted = pathToNodeFromRustNodePath(rustPath)
      const result = getNodeFromPath<Node<Expr>>(ast, converted, instance)
      if (err(result)) throw result
      expect(topLevelRange(result.node.start, result.node.end)).toEqual(range)
    }
  )

  // Rust source lookup returns the sketch's argument list. App lookup returns
  // the argument expression. Test this separately from bodySelections, where
  // each converted path must point to the selected expression.
  it('converts the Rust argument-container path for a sketch surface selection', async () => {
    const ast = transportedAst()
    const rustPath = await nodePathFromRange(
      ast,
      selection('planeArg'),
      instance
    )
    if (!rustPath) throw new Error('Missing argument path')
    const result = getNodeFromPath<LabeledArg[]>(
      ast,
      pathToNodeFromRustNodePath(rustPath),
      instance
    )
    if (err(result)) throw result
    expect(result.node).toHaveLength(1)
    expect(source.slice(result.node[0].arg.start, result.node[0].arg.end)).toBe(
      'planeArg'
    )
  })

  it('edits a selected binding without changing the other sketch or its comments', () => {
    const ast = transportedAst()
    const path = getNodePathFromSourceRange(ast, selection('7mm\n'))
    const result = getNodeFromPath<Node<Literal>>(
      ast,
      path,
      instance,
      undefined,
      false,
      false,
      createLiteral(9, instance, 'Mm')
    )
    if (err(result)) throw result
    const edited = recast(ast, instance)
    if (err(edited)) throw edited
    expect(edited).toBe(source.replace('size = 7mm', 'size = 9mm'))
    const reparsed = assertParse(edited, instance)
    const start = edited.indexOf('9mm')
    const range = topLevelRange(start, start + '9mm'.length)
    const updated = getNodeFromPath<Node<Literal>>(
      reparsed,
      getNodePathFromSourceRange(reparsed, range),
      instance
    )
    if (err(updated)) throw updated
    expect(topLevelRange(updated.node.start, updated.node.end)).toEqual(range)
    expect(recast(reparsed, instance)).toBe(edited)
  })
})
