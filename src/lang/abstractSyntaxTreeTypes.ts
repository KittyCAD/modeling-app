export type SyntaxType =
  | 'Program'
  | 'ExpressionStatement'
  | 'BinaryExpression'
  | 'CallExpression'
  | 'Identifier'
  | 'BlockStatement'
  | 'ReturnStatement'
  | 'VariableDeclaration'
  | 'VariableDeclarator'
  | 'MemberExpression'
  | 'ArrayExpression'
  | 'ObjectExpression'
  | 'ObjectProperty'
  | 'FunctionExpression'
  | 'PipeExpression'
  | 'PipeSubstitution'
  | 'Literal'
  | 'NoneCodeNode'
  | 'UnaryExpression'

export interface Program {
  type: SyntaxType
  start: number
  end: number
  body: BodyItem[]
  nonCodeMeta: NoneCodeMeta
}
interface GeneralStatement {
  type: SyntaxType
  start: number
  end: number
}

export type BodyItem =
  | ExpressionStatement
  | VariableDeclaration
  | ReturnStatement

export type Value =
  | Literal
  | Identifier
  | BinaryExpression
  | FunctionExpression
  | CallExpression
  | PipeExpression
  | PipeSubstitution
  | ArrayExpression
  | ObjectExpression
  | MemberExpression
  | UnaryExpression

export type BinaryPart =
  | Literal
  | Identifier
  | BinaryExpression
  | CallExpression
  | UnaryExpression

export interface NoneCodeNode extends GeneralStatement {
  type: 'NoneCodeNode'
  value: string
}

export interface NoneCodeMeta {
  // Stores the whitespace/comments that go after the statement who's index we're using here
  [statementIndex: number]: NoneCodeNode
  // Which is why we also need `start` for and whitespace at the start of the file/block
  start?: NoneCodeNode
}

export interface ExpressionStatement extends GeneralStatement {
  type: 'ExpressionStatement'
  expression: Value
}

export interface CallExpression extends GeneralStatement {
  type: 'CallExpression'
  callee: Identifier
  arguments: Value[]
  optional: boolean
}

export interface VariableDeclaration extends GeneralStatement {
  type: 'VariableDeclaration'
  declarations: VariableDeclarator[]
  kind: 'const' | 'unknown' | 'fn' //| "solid" | "surface" | "face"
}

export interface VariableDeclarator extends GeneralStatement {
  type: 'VariableDeclarator'
  id: Identifier
  init: Value
}

export interface Literal extends GeneralStatement {
  type: 'Literal'
  value: string | number | boolean | null
  raw: string
}

export interface Identifier extends GeneralStatement {
  type: 'Identifier'
  name: string
}

export interface PipeSubstitution extends GeneralStatement {
  type: 'PipeSubstitution'
}

export interface ArrayExpression extends GeneralStatement {
  type: 'ArrayExpression'
  elements: Value[]
}

export interface ObjectExpression extends GeneralStatement {
  type: 'ObjectExpression'
  properties: ObjectProperty[]
}

export interface ObjectProperty extends GeneralStatement {
  type: 'ObjectProperty'
  key: Identifier
  value: Value
}

export interface MemberExpression extends GeneralStatement {
  type: 'MemberExpression'
  object: MemberExpression | Identifier
  property: Identifier | Literal
  computed: boolean
}

export interface ObjectKeyInfo {
  key: Identifier | Literal
  index: number
  computed: boolean
}

export interface BinaryExpression extends GeneralStatement {
  type: 'BinaryExpression'
  operator: string
  left: BinaryPart
  right: BinaryPart
}

export interface UnaryExpression extends GeneralStatement {
  type: 'UnaryExpression'
  operator: '-' | '!'
  argument: BinaryPart
}

export interface PipeExpression extends GeneralStatement {
  type: 'PipeExpression'
  body: Value[]
  nonCodeMeta: NoneCodeMeta
}

export interface FunctionExpression extends GeneralStatement {
  type: 'FunctionExpression'
  id: Identifier | null
  params: Identifier[]
  body: BlockStatement
}

export interface BlockStatement extends GeneralStatement {
  type: 'BlockStatement'
  body: BodyItem[]
  nonCodeMeta: NoneCodeMeta
}

export interface ReturnStatement extends GeneralStatement {
  type: 'ReturnStatement'
  argument: Value
}

export type All = Program | ExpressionStatement[] | BinaryExpression | Literal
