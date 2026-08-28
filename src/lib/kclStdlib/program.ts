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
