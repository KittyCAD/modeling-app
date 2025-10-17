import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { isFaceArtifact } from '@src/lang/modifyAst/faces'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { valueOrVariable } from '@src/lang/queryAst'
import type { ArtifactGraph, Expr, PathToNode, Program } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'

/**
 * Adds flatness GD&T annotation(s) to the AST.
 * Creates one gdt::flatness call for each selected face.
 * Always adds annotations at the end of the AST body.
 *
 * @param ast - The AST to modify
 * @param artifactGraph - The artifact graph for face lookups
 * @param faces - Selected faces to annotate (only face selections will be used)
 * @param tolerance - The flatness tolerance value (required)
 * @param precision - Number of decimal places to display (optional)
 * @param framePosition - Position of the feature control frame [x, y] (optional)
 * @param framePlane - Plane for displaying the frame (XY, XZ, YZ) (optional)
 * @param fontPointSize - Font point size for annotation text (optional)
 * @param fontScale - Scale factor for annotation text (optional)
 * @param nodeToEdit - Path to node to edit (for edit mode)
 * @returns Modified AST and path to the last created node, or an Error
 */
export function addFlatnessGdt({
  ast,
  artifactGraph,
  faces,
  tolerance,
  precision,
  framePosition,
  framePlane,
  fontPointSize,
  fontScale,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  faces: Selections
  tolerance: KclCommandValue
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the AST to avoid mutating the original
  let modifiedAst = structuredClone(ast)

  // Filter to only include face selections
  const faceSelections = faces.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
  )

  if (faceSelections.length === 0) {
    return new Error(
      'No valid face selections found. Please select faces (caps, walls, or edge cuts).'
    )
  }

  // Get face expressions from the selection
  // GDT annotations require tags for unambiguous face references (no body context)
  // We use modifyAstWithTagsForSelection directly to make the tagging explicit
  const facesExprs: Expr[] = []
  for (const faceSelection of faceSelections) {
    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      faceSelection,
      artifactGraph
    )
    if (err(tagResult)) {
      console.warn('Failed to add tag for face selection', tagResult)
      continue
    }

    // Update the AST with the tagged version
    modifiedAst = tagResult.modifiedAst

    // Create expression from the first tag (faces have one tag)
    facesExprs.push(createLocalName(tagResult.tags[0]))
  }

  if (facesExprs.length === 0) {
    return new Error(
      'No valid face expressions could be generated from selection'
    )
  }

  // Deduplicate face expressions based on their string representation
  const uniqueFacesExprs = deduplicateFaceExprs(facesExprs)

  if (uniqueFacesExprs.length === 0) {
    return new Error('No unique faces found after deduplication')
  }

  // Insert variables for labeled arguments only once (before creating any calls)
  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, nodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, nodeToEdit)
  }
  // Only insert framePosition variable if we used valueOrVariable (not for arrays)
  if (
    framePosition &&
    !('value' in framePosition && isArray(framePosition.value)) &&
    'variableName' in framePosition &&
    framePosition.variableName
  ) {
    insertVariableAndOffsetPathToNode(framePosition, modifiedAst, nodeToEdit)
  }
  // Only insert framePlane variable if we used valueOrVariable (not for strings)
  if (
    framePlane &&
    typeof framePlane !== 'string' &&
    'variableName' in framePlane &&
    framePlane.variableName
  ) {
    insertVariableAndOffsetPathToNode(framePlane, modifiedAst, nodeToEdit)
  }
  if (
    fontPointSize &&
    'variableName' in fontPointSize &&
    fontPointSize.variableName
  ) {
    insertVariableAndOffsetPathToNode(fontPointSize, modifiedAst, nodeToEdit)
  }
  if (fontScale && 'variableName' in fontScale && fontScale.variableName) {
    insertVariableAndOffsetPathToNode(fontScale, modifiedAst, nodeToEdit)
  }

  // Create one gdt::flatness call for each unique face
  let lastPathToNode: PathToNode | undefined

  for (const faceExpr of uniqueFacesExprs) {
    const facesArray = createArrayExpression([faceExpr])

    // Handle framePlane parameter - can be a named plane (XY, XZ, YZ) or variable
    let framePlaneExpr
    if (framePlane) {
      if (typeof framePlane === 'string') {
        // Named plane like 'XY', 'XZ', 'YZ'
        framePlaneExpr = createLocalName(framePlane)
      } else {
        // Variable reference
        framePlaneExpr = valueOrVariable(framePlane)
      }
    }

    // Handle framePosition parameter - should be Point2d [x, y]
    let framePositionExpr
    if (framePosition) {
      if ('value' in framePosition && isArray(framePosition.value)) {
        // Direct array value [x, y]
        const arrayElements = []
        for (const val of framePosition.value) {
          if (
            typeof val === 'number' ||
            typeof val === 'string' ||
            typeof val === 'boolean'
          ) {
            arrayElements.push(createLiteral(val))
          } else {
            return new Error('Invalid framePosition value type')
          }
        }
        framePositionExpr = createArrayExpression(arrayElements)
      } else {
        // Variable reference or other format
        framePositionExpr = valueOrVariable(framePosition)
      }
    }

    // Build labeled arguments
    const labeledArgs = [
      createLabeledArg('faces', facesArray),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    // Add optional labeled arguments if provided
    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }
    if (framePositionExpr !== undefined) {
      labeledArgs.push(createLabeledArg('framePosition', framePositionExpr))
    }
    if (framePlaneExpr !== undefined) {
      labeledArgs.push(createLabeledArg('framePlane', framePlaneExpr))
    }
    if (fontPointSize !== undefined) {
      labeledArgs.push(
        createLabeledArg('fontPointSize', valueOrVariable(fontPointSize))
      )
    }
    if (fontScale !== undefined) {
      labeledArgs.push(
        createLabeledArg('fontScale', valueOrVariable(fontScale))
      )
    }

    // Create the gdt::flatness call
    // Using null for unlabeled args since all args are labeled
    const call = createCallExpressionStdLibKw(
      'gdt::flatness',
      null,
      labeledArgs
    )

    // Insert the function call into the AST at the appropriate location
    // Using undefined for variableIfNewDecl so it creates an expression statement
    // This ensures GDT annotations are always added at the end
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call,
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined, // GDT annotations don't pipe
      variableIfNewDecl: undefined, // Creates expression statement at the end
    })
    if (err(pathToNode)) {
      return pathToNode
    }

    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error('Failed to create any gdt::flatness calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

/**
 * Deduplicates face expressions based on their string representation.
 * This prevents creating multiple annotations for the same face.
 */
function deduplicateFaceExprs(facesExprs: Expr[]): Expr[] {
  const seen = new Set<string>()
  const unique: Expr[] = []

  for (const expr of facesExprs) {
    // Create a stable string representation for comparison
    const key = exprToKey(expr)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(expr)
    }
  }

  return unique
}

/**
 * Converts an expression to a stable string key for deduplication.
 */
function exprToKey(expr: Expr): string {
  if (expr.type === 'Literal') {
    return `literal:${JSON.stringify(expr.value)}`
  }
  if (expr.type === 'Name') {
    return `name:${expr.name}`
  }
  // For other complex expressions, use JSON stringify
  // This is safe because we're only using it for comparison, not type checking
  return JSON.stringify(expr)
}
