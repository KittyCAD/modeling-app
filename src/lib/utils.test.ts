import {
  isOverlap,
  roundOff,
  simulateOnMouseDragMatch,
  onDragNumberCalculation,
  hasLeadingZero,
  hasDigitsLeftOfDecimal,
} from './utils'
import { SourceRange } from '../lang/wasm'

describe('testing isOverlapping', () => {
  testBothOrders([0, 3, true], [3, 10, true])
  testBothOrders([0, 5, true], [3, 4, true])
  testBothOrders([0, 5, true], [5, 10, true])
  testBothOrders([0, 5, true], [6, 10, true], false)
  testBothOrders([0, 5, true], [-1, 1, true])
  testBothOrders([0, 5, true], [-1, 0, true])
  testBothOrders([0, 5, true], [-2, -1, true], false)
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

describe('testing hasLeadingZero', () => {
  it('.1 should have no leading zero', () => {
    const actual = hasLeadingZero('.1')
    const expected = false
    expect(actual).toBe(expected)
  })
  it('1.1 should have no leading zero', () => {
    const actual = hasLeadingZero('1.1')
    const expected = false
    expect(actual).toBe(expected)
  })
  it('0.1 should have leading zero', () => {
    const actual = hasLeadingZero('0.1')
    const expected = true
    expect(actual).toBe(expected)
  })
  it('10 should have no leading zero', () => {
    const actual = hasLeadingZero('10')
    const expected = false
    expect(actual).toBe(expected)
  })
  it('0.375 should have leading zero', () => {
    const actual = hasLeadingZero('0.375')
    const expected = true
    expect(actual).toBe(expected)
  })
  it('-0.375 should have leading zero', () => {
    const actual = hasLeadingZero('-0.375')
    const expected = true
    expect(actual).toBe(expected)
  })
  it('-0.0 should have leading zero', () => {
    const actual = hasLeadingZero('-0.0')
    const expected = true
    expect(actual).toBe(expected)
  })
  it('0.0 should have leading zero', () => {
    const actual = hasLeadingZero('0.0')
    const expected = true
    expect(actual).toBe(expected)
  })
})

describe('testing hasDigitsLeftOfDecimal', () => {
  it('0.25 should be whole', () => {
    const actual = hasDigitsLeftOfDecimal('0.25')
    const expected = true
    expect(actual).toBe(expected)
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

  it('works with =-500', () => {
    const actual = simulateOnMouseDragMatch('=-500')
    const expected = ['-500']
    expect(actual).toStrictEqual(expected)
  })

  it('works with =500', () => {
    const actual = simulateOnMouseDragMatch('=500')
    const expected = ['500']
    expect(actual).toStrictEqual(expected)
  })

  it('works with = 500', () => {
    const actual = simulateOnMouseDragMatch('= 500')
    const expected = ['500']
    expect(actual).toStrictEqual(expected)
  })
})

describe('testing onDragNumberCalculation', () => {
  // Need to simulate the MouseEvent object with limited values
  const positiveHundredsDecimalEvent = new MouseEvent('mousemove', {
    shiftKey: true,
    metaKey: true,
    movementX: 1,
  })
  const positiveTensDecimalEvent = new MouseEvent('mousemove', {
    metaKey: true,
    movementX: 1,
  })
  const positiveTensEvent = new MouseEvent('mousemove', {
    shiftKey: true,
    movementX: 1,
  })
  const positiveOnesEvent = new MouseEvent('mousemove', { movementX: 1 })
  const negativeHundredsDecimalEvent = new MouseEvent('mousemove', {
    shiftKey: true,
    metaKey: true,
    movementX: -1,
  })
  const negativeTensDecimalEvent = new MouseEvent('mousemove', {
    metaKey: true,
    movementX: -1,
  })
  const negativeTensEvent = new MouseEvent('mousemove', {
    shiftKey: true,
    movementX: -1,
  })
  const negativeOnesEvent = new MouseEvent('mousemove', { movementX: -1 })
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

      test('works with .123', () => {
        const match = simulateOnMouseDragMatch('.123')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveOnesEvent)
        const expected = '1.123'
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

      test('works with 90', () => {
        const match = simulateOnMouseDragMatch('90')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '100'
        expect(actual).toBe(expected)
      })

      test('works with .0', () => {
        const match = simulateOnMouseDragMatch('.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, positiveTensEvent)
        const expected = '10.0'
        expect(actual).toBe(expected)
      })

      test('works with .1', () => {
        const match = simulateOnMouseDragMatch('.1')
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

      test('works with .1', () => {
        const match = simulateOnMouseDragMatch('.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '.2'
        expect(actual).toBe(expected)
      })

      test('works with 10', () => {
        const match = simulateOnMouseDragMatch('10')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '10.1'
        expect(actual).toBe(expected)
      })

      test('works with .0', () => {
        const match = simulateOnMouseDragMatch('.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '.1'
        expect(actual).toBe(expected)
      })

      test('works with .01', () => {
        const match = simulateOnMouseDragMatch('.01')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveTensDecimalEvent
        )
        const expected = '.11'
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

      test('works with .1', () => {
        const match = simulateOnMouseDragMatch('.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '.11'
        expect(actual).toBe(expected)
      })

      test('works with .11', () => {
        const match = simulateOnMouseDragMatch('.11')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '.12'
        expect(actual).toBe(expected)
      })

      test('works with 10', () => {
        const match = simulateOnMouseDragMatch('10')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '10.01'
        expect(actual).toBe(expected)
      })

      test('works with 10.02', () => {
        const match = simulateOnMouseDragMatch('10.02')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          positiveHundredsDecimalEvent
        )
        const expected = '10.03'
        expect(actual).toBe(expected)
      })
    })
  })

  // NEGATIVE DIRECTION

  describe('negative direction', () => {
    describe('ones event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-1.0'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '0'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-0.5'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-0.34'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-0.625'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-0.9'
        expect(actual).toBe(expected)
      })

      test('works with .0', () => {
        const match = simulateOnMouseDragMatch('.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-1.0'
        expect(actual).toBe(expected)
      })

      test('works with 1.0', () => {
        const match = simulateOnMouseDragMatch('1.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '0.0'
        expect(actual).toBe(expected)
      })

      test('works with 1.66', () => {
        const match = simulateOnMouseDragMatch('1.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '0.66'
        expect(actual).toBe(expected)
      })

      test('works with 0.0000001', () => {
        const match = simulateOnMouseDragMatch('0.0000001')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-0.9999999'
        expect(actual).toBe(expected)
      })

      test('works with 9', () => {
        const match = simulateOnMouseDragMatch('9')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '8'
        expect(actual).toBe(expected)
      })

      test('works with 100', () => {
        const match = simulateOnMouseDragMatch('100')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '99'
        expect(actual).toBe(expected)
      })

      test('works with .123', () => {
        const match = simulateOnMouseDragMatch('.123')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeOnesEvent)
        const expected = '-0.877'
        expect(actual).toBe(expected)
      })
    })
    describe('tens event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-10.0'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-9'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-9.5'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-9.34'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-9.625'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-9.9'
        expect(actual).toBe(expected)
      })

      test('works with 90', () => {
        const match = simulateOnMouseDragMatch('90')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '80'
        expect(actual).toBe(expected)
      })

      test('works with .0', () => {
        const match = simulateOnMouseDragMatch('.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-10.0'
        expect(actual).toBe(expected)
      })

      test('works with .1', () => {
        const match = simulateOnMouseDragMatch('.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(matchedText, negativeTensEvent)
        const expected = '-9.9'
        expect(actual).toBe(expected)
      })
    })
    describe('tens decimal event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '-0.1'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '0.9'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '0.4'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '0.56'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '0.275'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '0.0'
        expect(actual).toBe(expected)
      })

      test('works with .1', () => {
        const match = simulateOnMouseDragMatch('.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '.0'
        expect(actual).toBe(expected)
      })

      test('works with 10', () => {
        const match = simulateOnMouseDragMatch('10')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '9.9'
        expect(actual).toBe(expected)
      })

      test('works with .0', () => {
        const match = simulateOnMouseDragMatch('.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '-.1'
        expect(actual).toBe(expected)
      })

      test('works with .01', () => {
        const match = simulateOnMouseDragMatch('.01')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeTensDecimalEvent
        )
        const expected = '-.09'
        expect(actual).toBe(expected)
      })
    })
    describe('hundreds decimal event', () => {
      test('works with 0.0', () => {
        const match = simulateOnMouseDragMatch('0.0')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '-0.01'
        expect(actual).toBe(expected)
      })

      test('works with 1', () => {
        const match = simulateOnMouseDragMatch('1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '0.99'
        expect(actual).toBe(expected)
      })

      test('works with 0.5', () => {
        const match = simulateOnMouseDragMatch('0.5')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '0.49'
        expect(actual).toBe(expected)
      })

      test('works with 0.66', () => {
        const match = simulateOnMouseDragMatch('0.66')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '0.65'
        expect(actual).toBe(expected)
      })

      test('works with 0.375', () => {
        const match = simulateOnMouseDragMatch('0.375')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '0.365'
        expect(actual).toBe(expected)
      })

      test('works with 0.1', () => {
        const match = simulateOnMouseDragMatch('0.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '0.09'
        expect(actual).toBe(expected)
      })

      test('works with .1', () => {
        const match = simulateOnMouseDragMatch('.1')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '.09'
        expect(actual).toBe(expected)
      })

      test('works with .11', () => {
        const match = simulateOnMouseDragMatch('.11')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '.1'
        expect(actual).toBe(expected)
      })

      test('works with 10', () => {
        const match = simulateOnMouseDragMatch('10')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '9.99'
        expect(actual).toBe(expected)
      })

      test('works with 10.02', () => {
        const match = simulateOnMouseDragMatch('10.02')
        const matchedText = match ? match[0] : ''
        const actual = onDragNumberCalculation(
          matchedText,
          negativeHundredsDecimalEvent
        )
        const expected = '10.01'
        expect(actual).toBe(expected)
      })
    })
  })
})
