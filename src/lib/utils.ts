
import { Range } from '../useStore'

export const isOverlapping = (a: Range, b: Range) => {
    const startingRange = a[0] < b[0] ? a : b
    const secondRange = a[0] < b[0] ? b : a
    return startingRange[1] >= secondRange[0]
}