/**
 * The type vocabulary the generated stdlib shapes are written in.
 *
 * `StdLibCommands.ts` describes each argument's type as a string —
 * `number(Length)`, `Plane | Face`, `[Sketch | Segment; 1+]` — and 83 distinct
 * ones appear across the 201 commands. Parsing them is what lets an input be
 * *derived*: which widget an argument gets, whether it takes one value or a
 * list, and whether a resolver can supply it at all.
 *
 * A small grammar, and worth writing as one rather than matching substrings:
 *
 *   type    := union
 *   union   := member ('|' member)*
 *   member  := array | number | name
 *   array   := '[' type (';' arity)? ']'
 *   arity   := digits '+'? | digits
 *   number  := 'number' ('(' unit ')')?
 *   name    := identifier
 */

export interface KclArity {
  min: number
  /** Null for "no upper bound", which is what a trailing `+` means. */
  max: number | null
}

export type KclType =
  /** `Sketch`, `Plane`, `bool`, `string`, `TagDecl`, `any`… */
  | { kind: 'named'; name: string }
  /** `number(Length)`, `number(Angle)`, or a bare `number` / `number(_)`. */
  | { kind: 'number'; unit: string | null }
  | { kind: 'array'; element: KclType; arity: KclArity }
  | { kind: 'union'; members: readonly KclType[] }

/** `[T]` with no arity given: any number of elements, including none. */
const ANY_LENGTH: KclArity = { min: 0, max: null }

/**
 * Split on a separator, ignoring any inside brackets.
 *
 * `[Sketch | [Segment; 1+]; 2+]` is one member of its enclosing union, not
 * three, so depth has to be tracked rather than the string simply split.
 */
function splitTop(input: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let at = 0; at < input.length; at += 1) {
    const character = input[at]
    if (character === '[') depth += 1
    else if (character === ']') depth -= 1
    else if (character === separator && depth === 0) {
      parts.push(input.slice(start, at))
      start = at + 1
    }
  }

  parts.push(input.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

function parseArity(input: string): KclArity {
  const trimmed = input.trim()
  const open = trimmed.endsWith('+')
  const count = Number.parseInt(open ? trimmed.slice(0, -1) : trimmed, 10)

  if (Number.isNaN(count)) return ANY_LENGTH
  return { min: count, max: open ? null : count }
}

const NUMBER = /^number(?:\((?<unit>[^)]*)\))?$/

/**
 * Parse one type string.
 *
 * Total: an unrecognised shape becomes a `named` type carrying whatever it said.
 * A resolver then simply does not claim it, which is the right failure — a new
 * KCL type should make one argument unfillable, not make the app throw while
 * building a form.
 */
export function parseKclType(input: string): KclType {
  const trimmed = input.trim()

  const members = splitTop(trimmed, '|')
  if (members.length > 1) {
    return { kind: 'union', members: members.map(parseKclType) }
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1)
    const parts = splitTop(inner, ';')
    return {
      kind: 'array',
      element: parseKclType(parts[0] ?? 'any'),
      arity: parts.length > 1 ? parseArity(parts[1]) : ANY_LENGTH,
    }
  }

  const numeric = NUMBER.exec(trimmed)
  if (numeric) {
    const unit = numeric.groups?.unit?.trim()
    // `number(_)` is "a number, unit unknown", which is the same answer as a
    // bare `number` as far as anything asking for input is concerned.
    return {
      kind: 'number',
      unit: unit && unit !== '_' ? unit : null,
    }
  }

  return { kind: 'named', name: trimmed }
}

/** Every named type mentioned anywhere inside, unions and arrays included. */
export function namedTypesIn(type: KclType): readonly string[] {
  switch (type.kind) {
    case 'named':
      return [type.name]
    case 'number':
      return []
    case 'array':
      return namedTypesIn(type.element)
    case 'union':
      return type.members.flatMap(namedTypesIn)
  }
}

/** Whether a value of this named type would satisfy the argument. */
export function acceptsNamed(type: KclType, name: string): boolean {
  return namedTypesIn(type).includes(name)
}

/** The arity if this is a list, or null if a single value is wanted. */
export function arityOf(type: KclType): KclArity | null {
  if (type.kind === 'array') return type.arity
  if (type.kind === 'union') {
    for (const member of type.members) {
      const arity = arityOf(member)
      if (arity) return arity
    }
  }
  return null
}
