import { Token } from "./tokeniser";

type syntaxType =
  | "Program"
  | "ExpressionStatement"
  | "BinaryExpression"
  | "NumberLiteral"
  | "StringLiteral"
  | "CallExpression"
  | "Identifier"
  | "BlockStatement"
  | "IfStatement"
  | "WhileStatement"
  | "FunctionDeclaration"
  | "ReturnStatement"
  | "VariableDeclaration"
  | "VariableDeclarator"
  | "AssignmentExpression"
  | "UnaryExpression"
  | "MemberExpression"
  | "ArrayExpression"
  | "ObjectExpression"
  | "Property"
  | "LogicalExpression"
  | "ConditionalExpression"
  | "ForStatement"
  | "ForInStatement"
  | "ForOfStatement"
  | "BreakStatement"
  | "ContinueStatement"
  | "SwitchStatement"
  | "SwitchCase"
  | "ThrowStatement"
  | "TryStatement"
  | "CatchClause"
  | "ClassDeclaration"
  | "ClassBody"
  | "MethodDefinition"
  | "NewExpression"
  | "ThisExpression"
  | "UpdateExpression"
  | "ArrowFunctionExpression"
  | "YieldExpression"
  | "AwaitExpression"
  | "ImportDeclaration"
  | "ImportSpecifier"
  | "ImportDefaultSpecifier"
  | "ImportNamespaceSpecifier"
  | "ExportNamedDeclaration"
  | "ExportDefaultDeclaration"
  | "ExportAllDeclaration"
  | "ExportSpecifier"
  | "TaggedTemplateExpression"
  | "TemplateLiteral"
  | "TemplateElement"
  | "SpreadElement"
  | "RestElement"
  | "SequenceExpression"
  | "DebuggerStatement"
  | "LabeledStatement"
  | "DoWhileStatement"
  | "WithStatement"
  | "EmptyStatement"
  | "Literal"
  | "ArrayPattern"
  | "ObjectPattern"
  | "AssignmentPattern"
  | "MetaProperty"
  | "Super"
  | "Import"
  | "RegExpLiteral"
  | "BooleanLiteral"
  | "NullLiteral"
  | "TypeAnnotation";

export interface Program {
  type: syntaxType;
  start: number;
  end: number;
  body: Body[];
}
interface GeneralStatement {
  type: syntaxType;
  start: number;
  end: number;
}

interface ExpressionStatement extends GeneralStatement {
  type: "ExpressionStatement";
  expression: BinaryExpression;
}

function makeExpressionStatement(
  tokens: Token[],
  index: number
): ExpressionStatement {
  const currentToken = tokens[index];
  // if (nextToken.type === "operator") {
  // }
  const { expression } = makeBinaryExpression(tokens, index);
  return {
    type: "ExpressionStatement",
    start: currentToken.start,
    end: expression.end,
    expression,
  };
}

interface VariableDeclaration extends GeneralStatement {
  type: "VariableDeclaration";
  declarations: VariableDeclarator[];
  kind: "const" | "unknown"; //| "solid" | "surface" | "face"
}

function makeVariableDeclaration(
  tokens: Token[],
  index: number
): { declaration: VariableDeclaration; lastIndex: number } {
  const currentToken = tokens[index];
  const declarationStartToken = nextMeaningfulToken(tokens, index);
  const { declarations, lastIndex } = makeVariableDeclarators(
    tokens,
    declarationStartToken.index
  );
  return {
    declaration: {
      type: "VariableDeclaration",
      start: currentToken.start,
      end: declarations[declarations.length - 1].end,
      kind: currentToken.value === "const" ? "const" : "unknown",
      declarations,
    },
    lastIndex,
  };
}

interface VariableDeclarator extends GeneralStatement {
  type: "VariableDeclarator";
  id: Identifier;
  init: Literal | Identifier | BinaryExpression;
}

function makeVariableDeclarators(
  tokens: Token[],
  index: number,
  previousDeclarators: VariableDeclarator[] = []
): {
  declarations: VariableDeclarator[];
  lastIndex: number;
} {
  const currentToken = tokens[index];
  const assignmentToken = nextMeaningfulToken(tokens, index);
  const contentsStartToken = nextMeaningfulToken(tokens, assignmentToken.index);
  const nextAfterInit = nextMeaningfulToken(tokens, contentsStartToken.index);
  let init: VariableDeclarator["init"];
  let lastIndex = contentsStartToken.index;
  if (nextAfterInit.token?.type === "operator") {
    const binExp = makeBinaryExpression(tokens, contentsStartToken.index);
    init = binExp.expression;
    lastIndex = binExp.lastIndex;
  } else {
    init = makeLiteral(tokens, contentsStartToken.index);
  }
  const currentDeclarator: VariableDeclarator = {
    type: "VariableDeclarator",
    start: currentToken.start,
    end: tokens[lastIndex].end,
    id: makeIdentifier(tokens, index),
    init,
  };
  return {
    declarations: [...previousDeclarators, currentDeclarator],
    lastIndex,
  };
}

type BinaryPart = Literal | Identifier;
// | BinaryExpression
// | CallExpression
// | MemberExpression
// | ArrayExpression
// | ObjectExpression
// | UnaryExpression
// | LogicalExpression
// | ConditionalExpression

interface Literal extends GeneralStatement {
  type: "Literal";
  value: string | number | boolean | null;
  raw: string;
}

interface Identifier extends GeneralStatement {
  type: "Identifier";
  name: string;
}

function makeIdentifier(token: Token[], index: number): Identifier {
  const currentToken = token[index];
  return {
    type: "Identifier",
    start: currentToken.start,
    end: currentToken.end,
    name: currentToken.value,
  };
}

function makeLiteral(tokens: Token[], index: number): Literal {
  const token = tokens[index];
  const value = token.type === "number" ? Number(token.value) : token.value;
  return {
    type: "Literal",
    start: token.start,
    end: token.end,
    value,
    raw: token.value,
  };
}

interface BinaryExpression extends GeneralStatement {
  type: "BinaryExpression";
  operator: string;
  left: BinaryPart;
  right: BinaryPart;
}

function makeBinaryExpression(
  tokens: Token[],
  index: number
): { expression: BinaryExpression; lastIndex: number } {
  const currentToken = tokens[index];
  let left: BinaryPart;
  if (currentToken.type === "word") {
    left = makeIdentifier(tokens, index);
  } else {
    left = makeLiteral(tokens, index);
  }
  const { token: operatorToken, index: operatorIndex } = nextMeaningfulToken(
    tokens,
    index
  );
  const rightToken = nextMeaningfulToken(tokens, operatorIndex);
  const right = makeLiteral(tokens, rightToken.index);
  return {
    expression: {
      type: "BinaryExpression",
      start: currentToken.start,
      end: right.end,
      left,
      operator: operatorToken.value,
      right,
    },
    lastIndex: rightToken.index,
  };
}

export type All = Program | ExpressionStatement[] | BinaryExpression | Literal;

function nextMeaningfulToken(
  tokens: Token[],
  index: number,
  offset: number = 1
): { token: Token; index: number } {
  const newIndex = index + offset;
  const token = tokens[newIndex];
  if (!token) {
    return { token, index: tokens.length };
  }
  if (token.type === "whitespace") {
    return nextMeaningfulToken(tokens, index, offset + 1);
  }
  return { token, index: newIndex };
}

type Body = ExpressionStatement | VariableDeclaration;

export const abstractSyntaxTree = (tokens: Token[]): Program => {
  const startTree = (
    tokens: Token[],
    tokenIndex: number = 0,
    previousBody: Body[] = []
  ): Body[] => {
    if (tokenIndex >= tokens.length) {
      return previousBody;
    }
    const token = tokens[tokenIndex];
    if (typeof token === "undefined") {
      console.log("probably should throw");
    }
    if (token.type === "word" && token.value === "const") {
      const { declaration, lastIndex } = makeVariableDeclaration(
        tokens,
        tokenIndex
      );
      const nextThing = nextMeaningfulToken(tokens, lastIndex);
      return startTree(tokens, nextThing.index, [...previousBody, declaration]);
    }
    if (
      (token.type === "number" || token.type === "word") &&
      nextMeaningfulToken(tokens, tokenIndex).token.type === "operator"
    ) {
      // return startTree(tokens, tokenIndex, [...previousBody, makeExpressionStatement(tokens, tokenIndex)]);
      return [...previousBody, makeExpressionStatement(tokens, tokenIndex)];
    }
    console.log(tokenIndex, tokens.length, token);
    throw new Error("Unexpected token");
  };
  const body = startTree(tokens);
  const program: Program = {
    type: "Program",
    start: 0,
    end: body[body.length - 1].end,
    body: body,
  };
  return program;
};
