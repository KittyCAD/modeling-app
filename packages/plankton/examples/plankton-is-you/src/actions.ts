import type { Action, Point, Tile } from './game'

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
    id: 'push',
    label: 'Pushable',
    description:
      'Other movers push this entity one cell ahead, including through push chains.',
    pushable: true,
  },
  {
    id: 'win',
    label: 'Win on contact',
    description: 'A controlled entity touching this entity wins.',
    wins: true,
  },
  {
    id: 'lose',
    label: 'Lose on contact',
    description: 'Any controlled entity touching this entity loses the game.',
    loses: true,
  },
  {
    id: 'destroy',
    label: 'Destroy self',
    description: 'Remove this entity at the end of each turn.',
    afterTurn: (subject, turn) => turn.destroy(subject.id),
  },
]
export type Participant = 'self' | 'other'
export type PropertyCondition<Target extends Participant = Participant> = {
  target: Target
  property: string
  present: boolean
}
export type ContactEffect =
  | { kind: 'destroy'; target: Participant }
  | { kind: 'block' }
export type TurnEffect =
  | { kind: 'destroy'; target: 'self' }
  | { kind: 'step-forward'; blocked: 'wait' | 'reverse' }

/** Recipes distinguish events and their available targets before compiling extensions. */
export type ActionRecipe = { id: string; label: string } & (
  | {
      trigger: 'turn'
      conditions: readonly PropertyCondition<'self'>[]
      effects: readonly TurnEffect[]
    }
  | {
      trigger: 'contact'
      conditions: readonly PropertyCondition[]
      effects: readonly ContactEffect[]
    }
)
function targetTile(
  target: Participant,
  subject: Readonly<Tile>,
  other: Readonly<Tile>
) {
  return target === 'self' ? subject : other
}
export function compileAction(recipe: ActionRecipe): Action {
  if (recipe.trigger === 'contact')
    return {
      id: recipe.id,
      label: recipe.label,
      description:
        'On attempted contact, test property conditions and apply effects before movement is resolved.',
      onContact(subject, other, contact) {
        if (
          !recipe.conditions.every(
            (condition) =>
              contact.hasProperty(
                targetTile(condition.target, subject, other),
                condition.property
              ) === condition.present
          )
        )
          return
        for (const effect of recipe.effects) {
          if (effect.kind === 'block') contact.block()
          else contact.destroy(targetTile(effect.target, subject, other).id)
        }
      },
    }
  return {
    id: recipe.id,
    label: recipe.label,
    description: 'At turn end, test property conditions and apply effects.',
    afterTurn(subject, turn) {
      if (
        !recipe.conditions.every(
          (condition) =>
            turn.hasProperty(subject, condition.property) === condition.present
        )
      )
        return
      for (const effect of recipe.effects) {
        if (effect.kind === 'destroy') {
          turn.destroy(subject.id)
          return
        }
        const direction = subject.facing ?? { x: 1, y: 0 }
        if (!turn.move(subject.id, direction) && effect.blocked === 'reverse') {
          const reverse: Point = {
            x: direction.x === 0 ? 0 : -direction.x,
            y: direction.y === 0 ? 0 : -direction.y,
          }
          turn.face(subject.id, reverse)
          turn.move(subject.id, reverse)
        }
      }
    },
  }
}
