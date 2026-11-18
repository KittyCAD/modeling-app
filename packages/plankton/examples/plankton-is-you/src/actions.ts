import type { Action, Outcome, Point } from './game'

export const builtInActions: readonly Action[] = [
  {
    id: 'control',
    label: 'Player control',
    description: 'Move with player input.',
    controls: true,
  },
  {
    id: 'block',
    label: 'Block movement',
    description: 'Prevent entities from entering this cell.',
    blocks: true,
  },
  {
    id: 'win',
    label: 'Win on contact',
    description: 'A controlled entity touching this entity wins.',
    wins: true,
  },
  {
    id: 'destroy',
    label: 'Destroy self',
    description: 'Remove this entity at the end of each turn.',
    afterTurn: (subject, turn) => turn.destroy(subject.id),
  },
]
export const builtInOutcomes: readonly Outcome[] = [
  {
    id: 'no-you',
    label: 'Lose when YOU is disconnected',
    description: 'No entity has an active player-control action.',
    evaluate: ({ controlled }) =>
      controlled.length === 0 ? 'lost' : undefined,
  },
  {
    id: 'touch-win',
    label: 'Win when YOU touches WIN',
    description: 'Includes a controlled entity that is itself WIN.',
    evaluate: ({ controlled, winning }) =>
      controlled.some((t) => winning.some((w) => w.x === t.x && w.y === t.y))
        ? 'won'
        : undefined,
  },
]

/** Runtime recipes compose turn capabilities into ordinary Action contributions. */
export type ActionRecipe = {
  id: string
  label: string
  operation: 'step-forward' | 'destroy-self'
  blocked: 'wait' | 'reverse'
}
export function compileAction(recipe: ActionRecipe): Action {
  return {
    id: recipe.id,
    label: recipe.label,
    description:
      recipe.operation === 'destroy-self'
        ? 'Destroy this entity at turn end.'
        : `Step forward each turn; ${recipe.blocked === 'reverse' ? 'reverse and retry' : 'wait'} if blocked.`,
    afterTurn(subject, turn) {
      if (recipe.operation === 'destroy-self') {
        turn.destroy(subject.id)
        return
      }
      const direction = subject.facing ?? { x: 1, y: 0 }
      if (!turn.move(subject.id, direction) && recipe.blocked === 'reverse') {
        const reverse: Point = {
          x: direction.x === 0 ? 0 : -direction.x,
          y: direction.y === 0 ? 0 : -direction.y,
        }
        turn.face(subject.id, reverse)
        turn.move(subject.id, reverse)
      }
    },
  }
}
