import type { Definition, PropertyDefinition, Puzzle, Tile } from './game'

export const initialDefinitions: readonly Definition[] = [
  {
    kind: 'entity',
    id: 'PLNK',
    color: '#c5ed91',
    sprite: [
      '00100100',
      '00111100',
      '01111110',
      '11011011',
      '11111111',
      '01111110',
      '00111100',
      '01000010',
    ],
  },
  {
    kind: 'entity',
    id: 'FLAG',
    color: '#f6cf75',
    sprite: [
      '01000000',
      '01111110',
      '01111100',
      '01111000',
      '01000000',
      '01000000',
      '01000000',
      '11110000',
    ],
  },
  {
    kind: 'entity',
    id: 'BUSH',
    color: '#7eae9a',
    sprite: [
      '00011000',
      '01111100',
      '11111110',
      '11111111',
      '01111110',
      '11111111',
      '01111110',
      '00100100',
    ],
  },
  { kind: 'grammar', id: 'IS' },
  { kind: 'property', id: 'YOU', color: '#c5ed91', action: 'control' },
  { kind: 'property', id: 'WIN', color: '#f6cf75', action: 'win' },
  { kind: 'property', id: 'LOSE', color: '#ee927d', action: 'lose' },
  { kind: 'word', id: 'NONE', color: '#ded9cf' },
  { kind: 'word', id: 'TOUCH', color: '#9cc6bd' },
  { kind: 'property', id: 'STOP', color: '#7eae9a', action: 'block' },
]
const word = (type: string, x: number, y: number): Tile => ({
  id: `word-${x}-${y}`,
  kind: 'word',
  type,
  x,
  y,
})
export const bushPuzzle: Puzzle = {
  id: 'through-the-hedge',
  title: 'Through the hedge',
  description: 'A wall of bushes. A missing word. Invent a way through.',
  bounds: { width: 12, height: 10 },
  definitions: initialDefinitions,
  placements: [
    ...['PLNK', 'IS', 'YOU'].map((type, x) => word(type, x + 1, 1)),
    ...['FLAG', 'IS', 'WIN'].map((type, x) => word(type, x + 8, 4)),
    ...['BUSH', 'IS', 'STOP'].map((type, x) => word(type, x + 8, 1)),
    word('BUSH', 1, 8),
    word('IS', 2, 8),
    ...[
      ...Array.from({ length: 5 }, (_, x) => ({ x, y: 2 })),
      { x: 4, y: 0 },
      { x: 4, y: 1 },
    ].map(
      ({ x, y }): Tile => ({
        id: `enclosure-${x}-${y}`,
        kind: 'entity',
        type: 'BUSH',
        x,
        y,
      })
    ),
    { id: 'player', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
    { id: 'goal', kind: 'entity', type: 'FLAG', x: 10, y: 5 },
    ...Array.from(
      { length: 10 },
      (_, y): Tile => ({
        id: `hedge-${y}`,
        kind: 'entity',
        type: 'BUSH',
        x: 7,
        y,
      })
    ),
  ],
}

/** A property connects its word to an action supplied by an independent extension. */
export type PropertyRecipe = {
  id: string
  color: string
  action: string
}
export function compileProperty(recipe: PropertyRecipe): PropertyDefinition {
  return { kind: 'property', ...recipe }
}
