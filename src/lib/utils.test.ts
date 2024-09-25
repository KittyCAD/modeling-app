import {
  isOverlap,
  roundOff,
  simulateOnMouseDragMatch,
  onMouseDragRegex,
  onMouseDragMakeANewNumber,
  onDragNumberCalculation,
} from './utils'
import { SourceRange } from '../lang/wasm'

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

describe('testing simulateOnMouseDragMatch', () => {
  // positive numbers

  it('works with 0.0', () => {
    const actual = simulateOnMouseDragMatch('0.0')
    const expected = ['0.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 0.1', () => {
    const actual = simulateOnMouseDragMatch('0.1')
    const expected = ['0.1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 0.10', () => {
    const actual = simulateOnMouseDragMatch('0.10')
    const expected = ['0.10']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 0.100', () => {
    const actual = simulateOnMouseDragMatch('0.100')
    const expected = ['0.100']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 0.01', () => {
    const actual = simulateOnMouseDragMatch('0.01')
    const expected = ['0.01']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 0.001', () => {
    const actual = simulateOnMouseDragMatch('0.001')
    const expected = ['0.001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 0.0001', () => {
    const actual = simulateOnMouseDragMatch('0.0001')
    const expected = ['0.0001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .0', () => {
    const actual = simulateOnMouseDragMatch('.0')
    const expected = ['.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .1', () => {
    const actual = simulateOnMouseDragMatch('.1')
    const expected = ['.1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .10', () => {
    const actual = simulateOnMouseDragMatch('.10')
    const expected = ['.10']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .100', () => {
    const actual = simulateOnMouseDragMatch('.100')
    const expected = ['.100']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .1000', () => {
    const actual = simulateOnMouseDragMatch('.1000')
    const expected = ['.1000']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .01', () => {
    const actual = simulateOnMouseDragMatch('.01')
    const expected = ['.01']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .001', () => {
    const actual = simulateOnMouseDragMatch('.001')
    const expected = ['.001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with .0001', () => {
    const actual = simulateOnMouseDragMatch('.0001')
    const expected = ['.0001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 1.0', () => {
    const actual = simulateOnMouseDragMatch('1.0')
    const expected = ['1.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 10.0', () => {
    const actual = simulateOnMouseDragMatch('10.0')
    const expected = ['10.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 100.0', () => {
    const actual = simulateOnMouseDragMatch('100.0')
    const expected = ['100.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 1000.0', () => {
    const actual = simulateOnMouseDragMatch('1000.0')
    const expected = ['1000.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 1.1', () => {
    const actual = simulateOnMouseDragMatch('1.1')
    const expected = ['1.1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 10.01', () => {
    const actual = simulateOnMouseDragMatch('10.01')
    const expected = ['10.01']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 1', () => {
    const actual = simulateOnMouseDragMatch('1')
    const expected = ['1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 10', () => {
    const actual = simulateOnMouseDragMatch('10')
    const expected = ['10']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 100', () => {
    const actual = simulateOnMouseDragMatch('100')
    const expected = ['100']
    expect(actual).toStrictEqual(expected)
  })

  it('works with 1000', () => {
    const actual = simulateOnMouseDragMatch('1000')
    const expected = ['1000']
    expect(actual).toStrictEqual(expected)
  })

  // negative numbers

  it('works with -0.0', () => {
    const actual = simulateOnMouseDragMatch('-0.0')
    const expected = ['-0.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -0.1', () => {
    const actual = simulateOnMouseDragMatch('-0.1')
    const expected = ['-0.1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -0.10', () => {
    const actual = simulateOnMouseDragMatch('-0.10')
    const expected = ['-0.10']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -0.100', () => {
    const actual = simulateOnMouseDragMatch('-0.100')
    const expected = ['-0.100']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -0.01', () => {
    const actual = simulateOnMouseDragMatch('-0.01')
    const expected = ['-0.01']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -0.001', () => {
    const actual = simulateOnMouseDragMatch('-0.001')
    const expected = ['-0.001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -0.0001', () => {
    const actual = simulateOnMouseDragMatch('-0.0001')
    const expected = ['-0.0001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.0', () => {
    const actual = simulateOnMouseDragMatch('-.0')
    const expected = ['-.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.1', () => {
    const actual = simulateOnMouseDragMatch('-.1')
    const expected = ['-.1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.10', () => {
    const actual = simulateOnMouseDragMatch('-.10')
    const expected = ['-.10']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.100', () => {
    const actual = simulateOnMouseDragMatch('-.100')
    const expected = ['-.100']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.1000', () => {
    const actual = simulateOnMouseDragMatch('-.1000')
    const expected = ['-.1000']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.01', () => {
    const actual = simulateOnMouseDragMatch('-.01')
    const expected = ['-.01']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.001', () => {
    const actual = simulateOnMouseDragMatch('-.001')
    const expected = ['-.001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -.0001', () => {
    const actual = simulateOnMouseDragMatch('-.0001')
    const expected = ['-.0001']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -1.0', () => {
    const actual = simulateOnMouseDragMatch('-1.0')
    const expected = ['-1.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -10.0', () => {
    const actual = simulateOnMouseDragMatch('-10.0')
    const expected = ['-10.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -100.0', () => {
    const actual = simulateOnMouseDragMatch('-100.0')
    const expected = ['-100.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -1000.0', () => {
    const actual = simulateOnMouseDragMatch('-1000.0')
    const expected = ['-1000.0']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -1.1', () => {
    const actual = simulateOnMouseDragMatch('-1.1')
    const expected = ['-1.1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -10.01', () => {
    const actual = simulateOnMouseDragMatch('-10.01')
    const expected = ['-10.01']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -1', () => {
    const actual = simulateOnMouseDragMatch('-1')
    const expected = ['-1']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -10', () => {
    const actual = simulateOnMouseDragMatch('-10')
    const expected = ['-10']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -100', () => {
    const actual = simulateOnMouseDragMatch('-100')
    const expected = ['-100']
    expect(actual).toStrictEqual(expected)
  })

  it('works with -1000', () => {
    const actual = simulateOnMouseDragMatch('-1000')
    const expected = ['-1000']
    expect(actual).toStrictEqual(expected)
  })
})

describe('testing onDragNumberCalculation', () => {
  const positiveHundredsDecimalEvent = {
    shiftKey: true,
    metaKey: true,
    movementX: 1,
  }
  const positiveTensDecimalEvent = { metaKey: true, movementX: 1 }
  const positiveTensEvent = { shiftKey: true, movementX: 1 }
  const positiveOnesEvent = { movementX: 1 }

  const negativeHundredsDecimalEvent = {
    shiftKey: true,
    metaKey: true,
    movementx: -1,
  }
  const negativeTensDecimalEvent = { metaKey: true, movementX: -1 }
  const negativeTensEvent = { shiftKey: true, movementX: -1 }
  const negativeOnesEvent = { movementX: -1 }
  describe('positive direction', () => {
    describe('ones event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.0'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '2'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.5'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.66'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.375'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.1'
        expect(actual).toBe(expected)
      })

      test('works with .0', () => {
        const match = simulateOnMouseDragMatch('.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.0'
        expect(actual).toBe(expected)
      })

      test('works with 1.0', () => {
        const match = simulateOnMouseDragMatch('1.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '2.0'
        expect(actual).toBe(expected)
      })

      test('works with 1.66', () => {
        const match = simulateOnMouseDragMatch('1.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '2.66'
        expect(actual).toBe(expected)
      })

      test('works with 0.0000001', () => {
        const match = simulateOnMouseDragMatch('0.0000001')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.0000001'
        expect(actual).toBe(expected)
      })

      test('works with 9', () => {
        const match = simulateOnMouseDragMatch('9')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '10'
        expect(actual).toBe(expected)
      })

      test('works with 99', () => {
        const match = simulateOnMouseDragMatch('99')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '100'
        expect(actual).toBe(expected)
      })
    })
    describe('tens event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '10.0'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '11'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '10.5'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '10.66'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '10.375'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '10.1'
        expect(actual).toBe(expected)
      })
    })
    describe('tens decimal event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '0.1'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '1.1'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '0.6'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '0.76'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '0.475'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '0.2'
        expect(actual).toBe(expected)
      })
    })
    describe('hundreds decimal event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '0.01'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '1.01'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '0.51'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '0.67'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '0.385'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '0.11'
        expect(actual).toBe(expected)
      })
    })
  })
})
