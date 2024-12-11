// This file is fake until we get the real types in #4746

import { SourceRange } from 'lang/wasm'

/**
 * An argument to a CAD modeling operation.
 */
export type OpArg = {
  /**
   * The KCL code expression for the argument.  This is used in the UI so
   * that the user can edit the expression.
   */
  sourceRange: SourceRange
}

/**
 * A CAD modeling operation for display in the feature tree, AKA operations
 * timeline.
 */
export type Operation =
  | {
      type: 'StdLibCall'
      /**
       * The unlabeled argument to the function.
       */
      unlabeledArg: OpArg | null
      /**
       * The labeled keyword arguments to the function.
       */
      labeledArgs: { [key in string]?: OpArg }
      /**
       * The source range of the operation in the source code.
       */
      sourceRange: SourceRange
      /**
       * The standard library function being called.  We serialize to its name.
       */
      name: string
    }
  | {
      type: 'UserDefinedFunctionCall'
      /**
       * The name of the user-defined function being called.  Anonymous
       * functions have no name.
       */
      name: string | null
      /**
       * The location of the function being called so that there's enough
       * info to go to its definition.
       */
      functionSourceRange: SourceRange
      /**
       * The unlabeled argument to the function.
       */
      unlabeledArg: OpArg | null
      /**
       * The labeled keyword arguments to the function.
       */
      labeledArgs: { [key in string]?: OpArg }
      /**
       * The source range of the operation in the source code.
       */
      sourceRange: SourceRange
    }
  | { type: 'UserDefinedFunctionReturn' }
