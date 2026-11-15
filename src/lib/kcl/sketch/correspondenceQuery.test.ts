import { expect, it } from 'vitest'
import { createSketchCorrespondenceQuery } from '@src/lib/kcl/sketch/correspondenceQuery'
import { nativeSketchDelta } from '@src/lib/kcl/sketch/correspondenceTestUtils'

it('uses native definition/backtrace provenance and excludes other sketches sharing a source range', () => {
  const query = createSketchCorrespondenceQuery(
    nativeSketchDelta().new_graph.objects,
    0
  )
  expect(query.relationshipsFor(1)).toEqual([
    { range: [10, 20, 0], relation: 'defined-by' },
  ])
  expect(query.relationshipsFor(2)).toEqual([
    { range: [30, 40, 1], relation: 'derived-from' },
    { range: [50, 60, 0], relation: 'derived-from' },
  ])
  expect(query.targetsFor([12, 12, 0])).toEqual([1])
  expect(query.targetsFor([32, 32, 1])).toEqual([2])
  expect(query.targetsFor([32, 32, 1], ['defined-by'])).toEqual([])
  expect(query.targetsFor([12, 12, 1])).toEqual([])
  expect(query.sourcesFor(11)).toEqual([])
  expect(query.sourcesFor(0)).toEqual([])
})
