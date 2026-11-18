import type { PathToNode } from '@src/lang/wasm'
import { updateSketchDetailsNodePaths } from '@src/lang/util'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const statementPath = (index: number): PathToNode => [
  ['body', ''],
  [index, 'index'],
  ['declaration', 'VariableDeclaration'],
  ['init', 'VariableDeclarator'],
]

describe('sketch paths after inserting named dimensions', () => {
  it('keeps every sketch reference on its original statement through a history of insertions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.array(fc.nat({ max: 100 }), { minLength: 1, maxLength: 40 }),
        (count, insertions) => {
          // Unique tokens model statements independently of the path arithmetic.
          const originals = Array.from(
            { length: count },
            (_, index) => `original ${index}`
          )
          const program = [...originals]
          let details = {
            sketchEntryNodePath: statementPath(count - 1),
            sketchNodePaths: originals.map((_, index) => statementPath(index)),
            planeNodePath: statementPath(0),
          }
          for (const [step, position] of insertions.entries()) {
            // Include before, at and after the selected statement, plus append.
            const insertionIndex = position % (program.length + 1)
            const previous = structuredClone(details)
            const updated = updateSketchDetailsNodePaths({
              ...details,
              exprInsertIndex: insertionIndex,
            })
            expect(details).toEqual(previous)
            program.splice(insertionIndex, 0, `dimension ${step}`)
            details = {
              sketchEntryNodePath: updated.updatedSketchEntryNodePath,
              sketchNodePaths: updated.updatedSketchNodePaths,
              planeNodePath: updated.updatedPlaneNodePath,
            }
            const resolve = (path: PathToNode) => program[Number(path[1][0])]
            expect(resolve(details.sketchEntryNodePath)).toBe(
              originals[count - 1]
            )
            expect(details.sketchNodePaths.map(resolve)).toEqual(originals)
            expect(resolve(details.planeNodePath)).toBe(originals[0])
            for (const path of [
              ...details.sketchNodePaths,
              details.planeNodePath,
              details.sketchEntryNodePath,
            ]) {
              expect(path.slice(2)).toEqual(statementPath(0).slice(2))
            }
          }
        }
      )
    )
  })

  it('leaves references unchanged when an edit inserts no statement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: -100, max: -1 }),
        (index, exprInsertIndex) => {
          const path = statementPath(index)
          const result = updateSketchDetailsNodePaths({
            sketchEntryNodePath: path,
            sketchNodePaths: [path],
            planeNodePath: path,
            exprInsertIndex,
          })
          expect(result.updatedSketchEntryNodePath).toEqual(path)
          expect(result.updatedSketchNodePaths).toEqual([path])
          expect(result.updatedPlaneNodePath).toEqual(path)
        }
      )
    )
  })
})
