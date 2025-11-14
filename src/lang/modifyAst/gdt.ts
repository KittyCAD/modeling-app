import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  createPoint2dExpression,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { isFaceArtifact } from '@src/lang/modifyAst/faces'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { valueOrVariable } from '@src/lang/queryAst'
import type { ArtifactGraph, Expr, PathToNode, Program } from '@src/lang/wasm'
import { traverse } from '@src/lang/queryAst'
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
    let framePositionExpr: Node<Expr> | undefined
    if (framePosition) {
      const res = createPoint2dExpression(framePosition)
      if (err(res)) return res
      framePositionExpr = res
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
    const nonCodeMeta = undefined
    const modulePath = [createIdentifier('gdt')]
    const call = createCallExpressionStdLibKw(
      'flatness',
      null,
      labeledArgs,
      nonCodeMeta,
      modulePath
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
 * Adds datum GD&T annotation to the AST.
 * Creates a single gdt::datum call for a selected face.
 * Always adds annotation at the end of the AST body.
 *
 * @param ast - The AST to modify
 * @param artifactGraph - The artifact graph for face lookups
 * @param faces - Selected face to annotate (only first face selection will be used)
 * @param name - The datum identifier (e.g., 'A', 'B', 'C')
 * @param nodeToEdit - Path to node to edit (for edit mode)
 * @returns Modified AST and path to the created node, or an Error
 */
export function addDatumGdt({
  ast,
  artifactGraph,
  faces,
  name,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  faces: Selections
  name: string
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the AST to avoid mutating the original
  let modifiedAst = structuredClone(ast)

  // Filter to only include face selections
  const faceSelections = faces.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
  )

  // Validate datum name is a single character
  if (name.length !== 1) {
    return new Error('Datum name must be a single character')
  }

  // Datum requires exactly one face
  if (faceSelections.length === 0) {
    return new Error('No face selected for datum annotation')
  }
  if (faceSelections.length > 1) {
    return new Error(
      'Datum annotation requires exactly one face, but multiple faces were selected'
    )
  }

  const faceSelection = faceSelections[0]

  // Get face expression with tag
  const tagResult = modifyAstWithTagsForSelection(
    modifiedAst,
    faceSelection,
    artifactGraph
  )
  if (err(tagResult)) {
    return tagResult
  }

  // Update the AST with the tagged version
  modifiedAst = tagResult.modifiedAst

  // Create expression from the first tag
  const faceExpr = createLocalName(tagResult.tags[0])

  // Build labeled arguments
  const labeledArgs = [
    createLabeledArg('face', faceExpr),
    createLabeledArg('name', createLiteral(name)),
  ]

  // Create the gdt::datum call
  const nonCodeMeta = undefined
  const modulePath = [createIdentifier('gdt')]
  const call = createCallExpressionStdLibKw(
    'datum',
    null,
    labeledArgs,
    nonCodeMeta,
    modulePath
  )

  // Insert the function call into the AST at the appropriate location
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

  return {
    modifiedAst,
    pathToNode,
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
    // Name has a nested Identifier: expr.name.name is the actual string
    return `name:${expr.name.name}`
  }
  // Fallback for other expression types (though currently only Name is used)
  return JSON.stringify(expr)
}

/**
 * Scans the AST and returns all datum names currently in use
 * @param ast - The AST program node to scan for datum names
 * @returns Array of datum names that are currently in use
 */
export function getUsedDatumNames(ast: Node<Program>): string[] {
  const usedNames: string[] = []

  traverse(ast, {
    enter: (node) => {
      // Look for gdt::datum calls
      if (
        node.type === 'CallExpressionKw' &&
        node.callee.type === 'Name' &&
        node.callee.path.length === 1 &&
        node.callee.path[0]?.name === 'gdt' &&
        node.callee.name.name === 'datum'
      ) {
        // Extract the name argument
        const nameArg = node.arguments?.find(
          (arg) =>
            arg.label?.name === 'name' &&
            arg.arg.type === 'Literal' &&
            typeof arg.arg.value === 'string'
        )

        if (nameArg && nameArg.arg.type === 'Literal') {
          usedNames.push(nameArg.arg.value as string)
        }
      }
    },
  })

  return usedNames
}

/**
 * Returns the first available datum character (A, B, C, ..., Z)
 * @param ast - The AST program node to scan for existing datum names
 * @returns The next available datum character, or 'A' as fallback if all letters are used
 */
export function getNextAvailableDatumName(ast: Node<Program>): string {
  const usedNames = getUsedDatumNames(ast)
  const usedNamesSet = new Set(usedNames.map((name) => name.toUpperCase()))

  // Check A-Z
  for (let charCode = 65; charCode <= 90; charCode++) {
    const char = String.fromCharCode(charCode)
    if (!usedNamesSet.has(char)) {
      return char
    }
  }

  // Fallback if all A-Z are used (unlikely but safe)
  return 'A'
}
