import { isOverlap, roundOff } from './utils'
import { SourceRange } from '../lang/executor'

describe('testing isOverlapping', () => {
  testBothOrders([0, 3], [3, 10])
  testBothOrders([0, 5], [3, 4])
  testBothOrders([0, 5], [5, 10])
  testBothOrders([0, 5], [6, 10], false)
  testBothOrders([0, 5], [-1, 1])
  testBothOrders([0, 5], [-1, 0])
  testBothOrders([0, 5], [-2, -1], false)
})

function testBothOrders(a: SourceRange, b: SourceRange, result = true) {
  it(`test is overlapping ${a} ${b}`, () => {
    expect(isOverlap(a, b)).toBe(result)
    expect(isOverlap(b, a)).toBe(result)
  })
}

describe('testing roundOff', () => {
  it('defaults to 2 decimal places', () => {
    expect(roundOff(1.23456789)).toBe(1.23)
  })
  it('rounds off to 3 decimal places', () => {
    expect(roundOff(1.23456789, 3)).toBe(1.235)
  })
  it('works with whole numbers', () => {
    expect(roundOff(1.23456789, 0)).toBe(1)
  })
  it('rounds up ok', () => {
    expect(roundOff(1.273456789, 1)).toBe(1.3)
  })
})
