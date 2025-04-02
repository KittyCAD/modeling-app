import type { MaxWidth } from '@src/lib/telemetry'
import {
  columnWidth,
  printDivider,
  printHeader,
  printRow,
} from '@src/lib/telemetry'

describe('Telemetry', () => {
  describe('columnWidth', () => {
    it('should return 0', () => {
      const actual = columnWidth([{ '': '' }], '')
      const expected = 0
      expect(actual).toBe(expected)
    })
    it('should return 10 from column length', () => {
      const actual = columnWidth([{ thisisten_: 'dog' }], 'thisisten_')
      const expected = 10
      expect(actual).toBe(expected)
    })
    it('should return 5 from the key length', () => {
      const actual = columnWidth([{ mph: 'five5' }], 'mph')
      const expected = 5
      expect(actual).toBe(expected)
    })
    it('should return 6 from multiple values', () => {
      const actual = columnWidth(
        [
          { mph: '555' },
          { mph: '33' },
          { mph: '789' },
          { mph: '1231' },
          { mph: '129532' },
        ],
        'mph'
      )
      const expected = 6
      expect(actual).toBe(expected)
    })
  })
  describe('printHeader', () => {
    it('should print a header based on MaxWidth interface with value lengths', () => {
      const widths: MaxWidth = {
        metricA: 7,
        metricB: 8,
        metricC: 9,
        metricD: 10,
      }
      const actual = printHeader(widths)
      const expected = '| metricA | metricB  | metricC   | metricD    |'
      expect(actual).toBe(expected)
    })
    it('should print a header based on MaxWidth interface with key lengths', () => {
      const widths: MaxWidth = {
        aa: 2,
        bb: 2,
        cc: 2,
        dd: 2,
      }
      const actual = printHeader(widths)
      const expected = '| aa | bb | cc | dd |'
      expect(actual).toBe(expected)
    })
  })
  describe('printDivider', () => {
    it('should print a divider based on MaxWidth interface with value lengths', () => {
      const widths: MaxWidth = {
        metricA: 7,
        metricB: 8,
        metricC: 9,
        metricD: 10,
      }
      const actual = printDivider(widths)
      const expected = '| ------- | -------- | --------- | ---------- |'
      expect(actual).toBe(expected)
    })

    it('should print a divider based on MaxWidth interface with key lengths', () => {
      const widths: MaxWidth = {
        aa: 2,
        bb: 2,
        cc: 2,
        dd: 2,
      }
      const actual = printDivider(widths)
      const expected = '| -- | -- | -- | -- |'
      expect(actual).toBe(expected)
    })
  })
  describe('printRow', () => {
    it('should print a row', () => {
      const widths: MaxWidth = {
        metricA: 7,
        metricB: 8,
        metricC: 9,
        metricD: 10,
      }
      const row = {
        metricA: 'aa',
        metricB: 'bb',
        metricC: 'cc',
        metricD: 'dd',
      }
      const actual = printRow(row, widths)
      const expected = '| aa      | bb       | cc        | dd         |'
      expect(actual).toBe(expected)
    })
  })
})
