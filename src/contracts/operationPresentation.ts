import { appendValueSpec, defineContract } from '@kittycad/registry'

/**
 * A titled section of arguments.
 *
 * Only a dialog that shows every argument at once has anything to group, which
 * is why grouping lives here and not on the argument: a sequential prompt asks
 * one question and has no use for a heading above it.
 */
export interface FieldGroup {
  id: string
  title: string
  description?: string
  /** Whether the section can be folded away. */
  collapsible?: boolean
  /** Whether it starts open. Only meaningful when collapsible. */
  defaultOpen?: boolean
}

/**
 * How one argument is offered, where there is a choice about it.
 *
 * Every field is a fact about presentation and nothing else. In particular
 * there is no way to say an argument is *not asked for*: whether an answer is
 * needed is a fact about the operation, it lives on the derived input, and a
 * surface that could override it would be a surface the other surfaces cannot
 * trust. The prototype this is drawn from discovered that the hard way — its
 * `required` and `hidden` ended up conditioned on which UI was rendering, which
 * left the argument schema unable to answer "is this needed?" without first
 * knowing who was asking.
 */
export interface FieldPresentation {
  /** Which `FieldGroup` this belongs in. Ungrouped fields come first. */
  group?: string
  /** Lower sorts earlier within the group. */
  order?: number
  /**
   * How a choice is offered.
   *
   * A filtered list is right when the options are many and unknown; a select or
   * a segmented control is right when they are few and worth seeing at once.
   * The prompt stays `choice` either way — this picks the control, not the
   * interaction.
   */
  control?: 'list' | 'select' | 'segmented'
  /** A different label than the argument's own name. */
  label?: string
  /** For a field whose group heading already says what it is. */
  hideLabel?: boolean
  /** Shown in place of a value while a selection field is empty. */
  emptyLabel?: string
  /** One line under the field, for what the label cannot fit. */
  hint?: string
}

/**
 * How one operation's arguments are laid out.
 *
 * Contributed separately from the operation, and keyed by its id, because
 * presentation and semantics have different owners and change for different
 * reasons: an operation is derived from a stdlib shape and should not have to
 * be edited to move a field into "More options". Contributing it also means a
 * surface that does not exist yet — a dialog over the scene, a properties
 * panel — can be given a layout without touching the operation, and an agent
 * calling the same operation never loads any of this.
 */
export interface OperationPresentation {
  operationId: string
  groups?: readonly FieldGroup[]
  /** Keyed by the argument's name, as the derived input calls it. */
  fields?: Readonly<Record<string, FieldPresentation>>
}

export const operationPresentationContract = defineContract({
  operationPresentationValueSpec: appendValueSpec<OperationPresentation>(
    'modeling.operationPresentation'
  ),
})

export const { operationPresentationValueSpec } = operationPresentationContract
