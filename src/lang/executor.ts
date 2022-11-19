import { Program, BinaryPart, BinaryExpression } from "./abstractSyntaxTree";

interface ProgramMemory {
  root: { [key: string]: any };
  return?: any;
}

export const executor = (
  node: Program,
  programMemory: ProgramMemory = { root: {} }
): any => {
  const _programMemory: ProgramMemory = {
    root: {
      ...programMemory.root,
    },
    return: programMemory.return,
  };
  const { body } = node;
  body.forEach((statement) => {
    if (statement.type === "VariableDeclaration") {
      statement.declarations.forEach((declaration) => {
        const variableName = declaration.id.name;
        if (declaration.init.type === "Literal") {
          _programMemory.root[variableName] = declaration.init.value;
        } else if (declaration.init.type === "BinaryExpression") {
          _programMemory.root[variableName] = getBinaryExpressionResult(declaration.init, _programMemory);
        } else if (declaration.init.type === "FunctionExpression") {
          const fnInit = declaration.init;

          _programMemory.root[declaration.id.name] = (...args: any[]) => {
            const fnMemory: ProgramMemory = {
              root: {
                ..._programMemory.root,
              },
            };
            if (args.length > fnInit.params.length) {
              throw new Error(
                `Too many arguments passed to function ${declaration.id.name}`
              );
            } else if (args.length < fnInit.params.length) {
              throw new Error(
                `Too few arguments passed to function ${declaration.id.name}`
              );
            }
            fnInit.params.forEach((param, index) => {
              fnMemory.root[param.name] = args[index];
            });
            return executor(fnInit.body, fnMemory).return;
          };
        } else if (declaration.init.type === "CallExpression") {
          const fnName = declaration.init.callee.name;
          const fnArgs = declaration.init.arguments.map((arg) => {
            if (arg.type === "Literal") {
              return arg.value;
            } else if (arg.type === "Identifier") {
              return _programMemory.root[arg.name];
            }
          });
          _programMemory.root[variableName] = _programMemory.root[fnName](
            ...fnArgs
          );
        }
      });
    } else if (statement.type === "ExpressionStatement") {
      const expression = statement.expression;
      if (expression.type === "CallExpression") {
        const functionName = expression.callee.name;
        const args = expression.arguments.map((arg) => {
          if (arg.type === "Literal") {
            return arg.value;
          } else if (arg.type === "Identifier") {
            return _programMemory.root[arg.name];
          }
        });
        _programMemory.root[functionName](...args);
      }
    } else if (statement.type === "ReturnStatement") {
      if(statement.argument.type === "BinaryExpression") {
        const returnValue = getBinaryExpressionResult(statement.argument, _programMemory);
        _programMemory.return = returnValue;
      }
    }
  });
  return _programMemory;
};

function getBinaryExpressionResult(
  expression: BinaryExpression,
  programMemory: ProgramMemory
) {
  const getVal = (part: BinaryPart) => {
    if (part.type === "Literal") {
      return part.value;
    } else if (part.type === "Identifier") {
      return programMemory.root[part.name];
    }
  };
  const left = getVal(expression.left);
  const right = getVal(expression.right);
  return left + right;
}
