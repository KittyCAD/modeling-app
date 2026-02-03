/**
 * Common event types shared across all sketch solve tools.
 * Individual tools can extend these base types with tool-specific events.
 */
export type BaseToolEvent =
  | { type: 'unequip' }
  | { type: 'escape' }
  | {
      /**
       * Event for adding a point to the sketch.
       * @property data - The 2D coordinates of the point [x, y]
       * @property id - Optional point ID (used by line tool for chaining)
       * @property isDoubleClick - Optional flag indicating if this was a double-click.
       *   The behavior of the double click is to end the line segment chaining.
       */
      type: 'add point'
      data: [x: number, y: number]
      id?: number
      isDoubleClick?: boolean
    }
