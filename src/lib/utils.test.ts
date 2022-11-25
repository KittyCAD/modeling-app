import { isOverlapping } from './utils'
import { Range } from '../useStore'

describe('testing isOverlapping', () => {
  testBothOrders([0, 5], [3, 10])
  testBothOrders([0, 5], [3, 4])
  testBothOrders([0, 5], [5, 10])
  testBothOrders([0, 5], [6, 10], false)
  testBothOrders([0, 5], [-1, 1])
  testBothOrders([0, 5], [-1, 0])
  testBothOrders([0, 5], [-2, -1], false)
})

function testBothOrders(a: Range, b: Range, result = true) {
  it(`test is overlapping ${a} ${b}`, () => {
    expect(isOverlapping(a, b)).toBe(result)
    expect(isOverlapping(b, a)).toBe(result)
  })
}
