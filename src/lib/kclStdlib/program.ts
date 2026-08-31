import type { Expr } from '@rust/kcl-lib/bindings/Expr'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { stdLibCommand } from '@src/lib/kclStdlib/shapes'

/**
 * Reading a KCL program well enough to fill in an operation's arguments.
 *
 * Nothing here mutates anything. An operation's edit is text appended at an
 * offset, so the AST is used to *understand* the program — what is bound, what
 * each binding produces, what names are taken — and never to rewrite it.
 *
 * That is a deliberate choice over parse-mutate-recast. Recasting rewrites the
 * whole file, so a one-line insertion would arrive as a diff touching every line
 * the formatter disagrees with, and the user's own formatting would lose an
 * argument it never entered.
 */

export interface ProgramBinding {
  /** The name the value is bound to: `profile001`. */
  name: string
  /** The stdlib call or block that produced it, for the label. */
  via: string
  /** Where the whole statement sits, so an insert can go after it. */
  from: number
  to: number
}

/**
 * The stdlib call a value came from.
 *
 * A pipeline's value is whatever its last stage returned, so the search walks to
 * the end. A `sketch { … }` block is the V2 syntax and produces a sketch without
 * calling anything, so it answers for itself.
 */
function producedBy(expression: Expr): string | null {
  switch (expression.type) {
    case 'CallExpressionKw':
      return expression.callee.name.name

    case 'PipeExpression': {
      for (const stage of [...expression.body].reverse()) {
        const found = producedBy(stage)
        if (found) return found
      }
      return null
    }

    case 'SketchBlock':
      return 'sketch'

    case 'LabelledExpression':
    case 'AscribedExpression':
      return producedBy(expression.expr)

    default:
      return null
  }
}

/** What a stdlib call returns, or `Sketch` for a `sketch` block. */
function returnTypeOf(via: string): string | null {
  if (via === 'sketch') return 'Sketch'
  return stdLibCommand(via)?.returnType ?? null
}

/**
 * Top-level bindings whose value is of a named KCL type.
 *
 * Derived from the same generated shapes the inputs come from: a binding
 * produces a `Sketch` because the function it called says it returns one. So a
 * new sketch-producing stdlib function becomes selectable here with no change,
 * and this never holds a list of function names.
 */
export function bindingsProducing(
  program: Program,
  typeName: string
): readonly ProgramBinding[] {
  const found: ProgramBinding[] = []

  for (const item of program.body) {
    if (item.type !== 'VariableDeclaration') continue

    const via = producedBy(item.declaration.init)
    if (!via) continue

    const returns = returnTypeOf(via)
    if (!returns?.includes(typeName)) continue

    found.push({
      name: item.declaration.id.name,
      via,
      from: item.start,
      to: item.end,
    })
  }

  return found
}

/**
 * The top-level binding whose statement contains an offset.
 *
 * This is what turns a selection into something a KCL call can refer to: the
 * artifact graph says which *source range* drew the thing you clicked, and the
 * name of the statement containing that range is how the rest of the program
 * names it.
 *
 * Top level only, deliberately. A segment inside a sketch block is named too —
 * `line1 = line(...)` — but referring to it from outside the block is a
 * different question, and answering the easy one wrongly would be worse than not
 * answering it.
 */
export function bindingContaining(
  program: Program,
  offset: number
): ProgramBinding | null {
  for (const item of program.body) {
    if (item.type !== 'VariableDeclaration') continue
    if (offset < item.start || offset > item.end) continue

    return {
      name: item.declaration.id.name,
      via: producedBy(item.declaration.init) ?? 'unknown',
      from: item.start,
      to: item.end,
    }
  }

  return null
}

/**
 * What names the thing at an offset, in parts.
 *
 * `{ outer: 'profile001' }` for a top-level binding, and
 * `{ outer: 'triangle', inner: 'line1' }` for a segment inside a sketch block.
 *
 * Two levels only, because that is how deep the language goes here: a sketch
 * block holds segments, and nothing holds a sketch block but the program.
 *
 * Kept in parts because callers need them separately as well as joined. A
 * region's segments are written `triangle.line1`, but a face made by sweeping
 * that segment is written through the region's own tags — `region001.tags.line1`
 * — which needs the segment's name without the block's.
 */
export interface ProgramReference {
  outer: string
  /** The binding inside a sketch block, when the offset is in one. */
  inner?: string
}

export function referencePartsAt(
  program: Program,
  offset: number
): ProgramReference | null {
  const outer = program.body.find(
    (item) =>
      item.type === 'VariableDeclaration' &&
      offset >= item.start &&
      offset <= item.end
  )
  if (!outer || outer.type !== 'VariableDeclaration') return null

  const name = outer.declaration.id.name
  const init = outer.declaration.init
  if (init.type !== 'SketchBlock') return { outer: name }

  for (const item of init.body.items) {
    if (item.type !== 'VariableDeclaration') continue
    if (offset < item.start || offset > item.end) continue
    return { outer: name, inner: item.declaration.id.name }
  }

  // Inside the block but not inside any of its bindings — a constraint, or the
  // block's own arguments. The block itself is the honest answer.
  return { outer: name }
}

/**
 * The KCL expression that names whatever is at an offset.
 *
 * `profile001` for a top-level binding, and `triangle.line1` for a segment
 * inside a sketch block — which is how V2 refers to segments from outside the
 * block, and what `region(segments = [triangle.line1, triangle.line2])` is made
 * of.
 */
export function referenceAt(program: Program, offset: number): string | null {
  const parts = referencePartsAt(program, offset)
  if (!parts) return null
  return parts.inner ? `${parts.outer}.${parts.inner}` : parts.outer
}

/**
 * The region a binding is, if the binding containing an offset is one.
 *
 * `region001` for an offset anywhere inside `region001 = region(segments = […])`,
 * and null for anything else. A region's own segments carry the range of that
 * call, so this is how a segment says which region it belongs to — asked of the
 * segment rather than worked out from how the sweep was written, which is what
 * kcl-lib's client does and is right: it holds whatever the sweep's argument
 * looks like.
 */
export function regionNameAt(program: Program, offset: number): string | null {
  const binding = bindingContaining(program, offset)
  if (!binding) return null

  const declaration = program.body.find(
    (item) =>
      item.type === 'VariableDeclaration' &&
      item.declaration.id.name === binding.name
  )
  if (!declaration || declaration.type !== 'VariableDeclaration') return null

  const call = declaration.declaration.init
  if (call.type !== 'CallExpressionKw') return null

  return call.callee.name.name === 'region' ? binding.name : null
}

/** A `sketch { … }` block, and what it is bound to. */
export interface SketchBlockRange {
  /** The name the block is bound to: `triangle`. */
  name: string
  from: number
  to: number
}

/**
 * The sketch block an offset falls inside, if any.
 *
 * What makes sketching a *place* rather than a state somebody has to remember
 * being in: a cursor or a selection is either inside a `sketch { … }` block or it
 * is not, and the file says which. Nothing has to record that a sketch was
 * entered, so nothing can disagree about whether it was left.
 *
 * The whole statement counts, not just the block's braces — a cursor on
 * `triangle = sketch(XY) {` is in the sketch by any useful definition.
 *
 * Top level only, like everything else here. A sketch block nested inside a
 * function definition is a real thing to support and a different question: what
 * "the sketch you are in" means when the function has three callers is not
 * answered by the offset.
 */
export function sketchBlockAt(
  program: Program,
  offset: number
): SketchBlockRange | null {
  for (const item of program.body) {
    if (item.type !== 'VariableDeclaration') continue
    if (item.declaration.init.type !== 'SketchBlock') continue
    if (offset < item.start || offset > item.end) continue

    return {
      name: item.declaration.id.name,
      from: item.start,
      to: item.end,
    }
  }

  return null
}

/**
 * The segments a region names, as they are written.
 *
 * Sliced out of the source rather than rebuilt from the AST, because the point is
 * to show somebody the text that is already in their file: `s.l1`, not a
 * re-rendering of a member expression that might differ in some detail.
 *
 * For suggesting a reference the app cannot derive. A region is bounded by every
 * segment that closes it and names only the ones it needed to, so this is a list
 * of candidates and never an answer.
 */
export function regionSegmentSources(
  program: Program,
  source: string,
  regionName: string
): readonly string[] {
  const declaration = program.body.find(
    (item) =>
      item.type === 'VariableDeclaration' &&
      item.declaration.id.name === regionName
  )
  if (!declaration || declaration.type !== 'VariableDeclaration') return []

  const call = declaration.declaration.init
  if (call.type !== 'CallExpressionKw') return []

  const segments = call.arguments.find(
    (argument) => argument.label?.name === 'segments'
  )?.arg
  if (!segments || segments.type !== 'ArrayExpression') return []

  return segments.elements
    .map((element) => source.slice(element.start, element.end).trim())
    .filter(Boolean)
}

/** Every name bound at the top level, for choosing one that is free. */
export function boundNames(program: Program): ReadonlySet<string> {
  const names = new Set<string>()
  for (const item of program.body) {
    if (item.type === 'VariableDeclaration') {
      names.add(item.declaration.id.name)
    }
  }
  return names
}

/**
 * `extrude001`, `extrude002`… whichever is free.
 *
 * Numbered from one and zero-padded to three, which is what the existing app
 * generates and what every KCL example in the docs looks like — a project whose
 * names come from two different generators reads as two different projects.
 */
export function freeName(program: Program, stem: string): string {
  const taken = boundNames(program)

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${stem}${String(index).padStart(3, '0')}`
    if (!taken.has(candidate)) return candidate
  }

  // A thousand of anything means the naming scheme is not the problem.
  return `${stem}${Date.now()}`
}

/**
 * The file's default length unit, from its `@settings` annotation.
 *
 * What it is for is writing numbers back. A sketch tool that writes `10mm` into
 * a file whose author works in inches is correct and reads as though the app has
 * a different idea of the drawing than they do, so the unit written is the unit
 * the file already declares.
 *
 * Null when the file says nothing, which is the common case and means the
 * project default applies — and a number written with no suffix then means the
 * right thing without this having to guess what that default is.
 */
export function defaultLengthUnitOf(program: Program): string | null {
  for (const attribute of program.innerAttrs ?? []) {
    if (attribute.name?.name !== 'settings') continue

    for (const property of attribute.properties ?? []) {
      if (property.key.name !== 'defaultLengthUnit') continue
      // The value is a bare name — `mm`, `in` — so it parses as a name rather
      // than as a string literal.
      if (property.value.type === 'Name') {
        return property.value.name?.name ?? null
      }
    }
  }

  return null
}
