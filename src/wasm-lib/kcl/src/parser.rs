use crate::{
    ast::types::{
        ArrayExpression, BinaryExpression, BodyItem, CallExpression, ExpressionStatement, FunctionExpression,
        Identifier, MemberExpression, NonCodeMeta, NonCodeNode, ObjectExpression, ObjectProperty, PipeExpression,
        Program, ReturnStatement, UnaryExpression, Value, VariableDeclaration, VariableDeclarator,
    },
    errors::{KclError, KclErrorDetails},
    token::Token,
};

mod math;
mod parser_impl;

pub const PIPE_SUBSTITUTION_OPERATOR: &str = "%";
pub const PIPE_OPERATOR: &str = "|>";

#[derive(Debug, PartialEq, Clone)]
struct TokenReturn {
    token: Option<Token>,
    index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct TokenReturnWithNonCode {
    token: Option<Token>,
    index: usize,
    non_code_node: Option<NonCodeNode>,
}

#[derive(Debug, PartialEq, Clone)]
pub struct MemberExpressionReturn {
    pub expression: MemberExpression,
    pub last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ValueReturn {
    value: Value,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ArrayElementsReturn {
    elements: Vec<Value>,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ArrayReturn {
    expression: ArrayExpression,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct PipeBodyReturn {
    body: Vec<Value>,
    last_index: usize,
    non_code_meta: NonCodeMeta,
}

#[derive(Debug, PartialEq, Clone)]
struct BinaryExpressionReturn {
    expression: BinaryExpression,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ArgumentsReturn {
    arguments: Vec<Value>,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
pub struct CallExpressionResult {
    pub expression: CallExpression,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct PipeExpressionResult {
    expression: PipeExpression,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct VariableDeclaratorsReturn {
    declarations: Vec<VariableDeclarator>,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct VariableDeclarationResult {
    declaration: VariableDeclaration,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
pub struct ParamsResult {
    pub params: Vec<Identifier>,
    pub last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
pub struct UnaryExpressionResult {
    pub expression: UnaryExpression,
    pub last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ExpressionStatementResult {
    expression: ExpressionStatement,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ObjectPropertiesResult {
    properties: Vec<ObjectProperty>,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ObjectExpressionResult {
    expression: ObjectExpression,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct ReturnStatementResult {
    statement: ReturnStatement,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct BodyResult {
    body: Vec<BodyItem>,
    last_index: usize,
    non_code_meta: NonCodeMeta,
}

#[derive(Debug, PartialEq, Clone)]
struct BlockStatementResult {
    block: Program,
    last_index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct FunctionExpressionResult {
    expression: FunctionExpression,
    last_index: usize,
}

pub struct Parser {
    pub tokens: Vec<Token>,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens }
    }

    pub fn get_token(&self, index: usize) -> Result<&Token, KclError> {
        if self.tokens.is_empty() {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![],
                message: "file is empty".to_string(),
            }));
        }

        let Some(token) = self.tokens.get(index) else {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![self.tokens.last().unwrap().into()],
                message: "unexpected end".to_string(),
            }));
        };
        Ok(token)
    }

    /// Use the new Winnow parser.
    pub fn ast(&self) -> Result<Program, KclError> {
        parser_impl::run_parser(&mut self.tokens.as_slice())
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::{
        ast::types::{BinaryOperator, BinaryPart, Literal, VariableKind},
        token::TokenType,
    };

    #[test]
    fn test_math_parse() {
        let tokens = crate::token::lexer(r#"5 + "a""#);
        let actual = Parser::new(tokens).ast().unwrap().body;
        let expr = BinaryExpression {
            start: 0,
            end: 7,
            operator: BinaryOperator::Add,
            left: BinaryPart::Literal(Box::new(Literal {
                start: 0,
                end: 1,
                value: serde_json::Value::Number(serde_json::Number::from(5)),
                raw: "5".to_owned(),
            })),
            right: BinaryPart::Literal(Box::new(Literal {
                start: 4,
                end: 7,
                value: serde_json::Value::String("a".to_owned()),
                raw: r#""a""#.to_owned(),
            })),
        };
        let expected = vec![BodyItem::ExpressionStatement(ExpressionStatement {
            start: 0,
            end: 7,
            expression: Value::BinaryExpression(Box::new(expr)),
        })];
        assert_eq!(expected, actual);
    }

    #[test]
    fn test_is_code_token() {
        let tokens = [
            Token {
                token_type: TokenType::Word,
                start: 0,
                end: 3,
                value: "log".to_string(),
            },
            Token {
                token_type: TokenType::Brace,
                start: 3,
                end: 4,
                value: "(".to_string(),
            },
            Token {
                token_type: TokenType::Number,
                start: 4,
                end: 5,
                value: "5".to_string(),
            },
            Token {
                token_type: TokenType::Comma,
                start: 5,
                end: 6,
                value: ",".to_string(),
            },
            Token {
                token_type: TokenType::String,
                start: 7,
                end: 14,
                value: "\"hello\"".to_string(),
            },
            Token {
                token_type: TokenType::Word,
                start: 16,
                end: 27,
                value: "aIdentifier".to_string(),
            },
            Token {
                token_type: TokenType::Brace,
                start: 27,
                end: 28,
                value: ")".to_string(),
            },
        ];
        for (i, token) in tokens.iter().enumerate() {
            assert!(token.is_code_token(), "failed test {i}: {token:?}")
        }
    }

    #[test]
    fn test_is_not_code_token() {
        let tokens = [
            Token {
                token_type: TokenType::Whitespace,
                start: 6,
                end: 7,
                value: " ".to_string(),
            },
            Token {
                token_type: TokenType::BlockComment,
                start: 28,
                end: 30,
                value: "/* abte */".to_string(),
            },
            Token {
                token_type: TokenType::LineComment,
                start: 30,
                end: 33,
                value: "// yoyo a line".to_string(),
            },
        ];
        for (i, token) in tokens.iter().enumerate() {
            assert!(!token.is_code_token(), "failed test {i}: {token:?}")
        }
    }

    #[test]
    fn test_abstract_syntax_tree() {
        let code = "5 +6";
        let parser = Parser::new(crate::token::lexer(code));
        let result = parser.ast().unwrap();
        let expected_result = Program {
            start: 0,
            end: 4,
            body: vec![BodyItem::ExpressionStatement(ExpressionStatement {
                start: 0,
                end: 4,
                expression: Value::BinaryExpression(Box::new(BinaryExpression {
                    start: 0,
                    end: 4,
                    left: BinaryPart::Literal(Box::new(Literal {
                        start: 0,
                        end: 1,
                        value: serde_json::Value::Number(serde_json::Number::from(5)),
                        raw: "5".to_string(),
                    })),
                    operator: BinaryOperator::Add,
                    right: BinaryPart::Literal(Box::new(Literal {
                        start: 3,
                        end: 4,
                        value: serde_json::Value::Number(serde_json::Number::from(6)),
                        raw: "6".to_string(),
                    })),
                })),
            })],
            non_code_meta: NonCodeMeta::default(),
        };

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_empty_file() {
        let some_program_string = r#""#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("file is empty"));
    }

    #[test]
    fn test_parse_half_pipe_small() {
        let tokens = crate::token::lexer(
            "const secondExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |",
        );
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("Unexpected token"));
    }

    #[test]
    fn test_parse_member_expression_double_nested_braces() {
        let tokens = crate::token::lexer(r#"const prop = yo["one"][two]"#);
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_period_number_first() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = 1 - obj.a"#,
        );
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_first() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = 1 - obj["a"]"#,
        );
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_second() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = obj["a"] - 1"#,
        );
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_first() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = [1 - obj["a"], 0]"#,
        );
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = [obj["a"] - 1, 0]"#,
        );
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second_missing_space() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = [obj["a"] -1, 0]"#,
        );
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_half_pipe() {
        let tokens = crate::token::lexer(
            "const height = 10

const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, 8], %)
  |> line([20, 0], %)
  |> line([0, -8], %)
  |> close(%)
  |> extrude(2, %)

show(firstExtrude)

const secondExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |",
        );
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("Unexpected token"));
    }

    #[test]
    fn test_parse_greater_bang() {
        let tokens = crate::token::lexer(">!");
        let parser = Parser::new(tokens);
        let err = parser.ast().unwrap_err();
        // TODO: Better errors when program cannot tokenize.
        // https://github.com/KittyCAD/modeling-app/issues/696
        assert!(err.to_string().contains("file is empty"));
    }

    #[test]
    fn test_parse_z_percent_parens() {
        let tokens = crate::token::lexer("z%)");
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("Unexpected token"));
    }

    #[test]
    fn test_parse_parens_unicode() {
        let tokens = crate::token::lexer("(ޜ");
        let parser = Parser::new(tokens);
        let result = parser.ast();
        // TODO: Better errors when program cannot tokenize.
        // https://github.com/KittyCAD/modeling-app/issues/696
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_negative_in_array_binary_expression() {
        let tokens = crate::token::lexer(
            r#"const leg1 = 5
const thickness = 0.56

const bracket = [-leg2 + thickness, 0]
"#,
        );
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_nested_open_brackets() {
        let tokens = crate::token::lexer(
            r#"
z(-[["#,
        );
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_weird_new_line_function() {
        let tokens = crate::token::lexer(
            r#"z
 (--#"#,
        );
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        // TODO: Better errors when program cannot tokenize.
        // https://github.com/KittyCAD/modeling-app/issues/696
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [], message: "file is empty" }"#
        );
    }

    #[test]
    fn test_parse_weird_lots_of_fancy_brackets() {
        let tokens = crate::token::lexer(r#"zz({{{{{{{{)iegAng{{{{{{{##"#);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        // TODO: Better errors when program cannot tokenize.
        // https://github.com/KittyCAD/modeling-app/issues/696
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [], message: "file is empty" }"#
        );
    }

    #[test]
    fn test_parse_weird_close_before_open() {
        let tokens = crate::token::lexer(
            r#"fn)n
e
["#,
        );
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("expected whitespace, found ')' which is brace"));
    }

    #[test]
    fn test_parse_weird_close_before_nada() {
        let tokens = crate::token::lexer(r#"fn)n-"#);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("expected whitespace, found ')' which is brace"));
    }

    #[test]
    fn test_parse_weird_lots_of_slashes() {
        let tokens = crate::token::lexer(
            r#"J///////////o//+///////////P++++*++++++P///////˟
++4"#,
        );
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("Unexpected token"));
    }

    #[test]
    fn test_parse_expand_array() {
        let code = "const myArray = [0..10]";
        let parser = Parser::new(crate::token::lexer(code));
        let result = parser.ast().unwrap();
        let expected_result = Program {
            start: 0,
            end: 23,
            body: vec![BodyItem::VariableDeclaration(VariableDeclaration {
                start: 0,
                end: 23,
                declarations: vec![VariableDeclarator {
                    start: 6,
                    end: 23,
                    id: Identifier {
                        start: 6,
                        end: 13,
                        name: "myArray".to_string(),
                    },
                    init: Value::ArrayExpression(Box::new(ArrayExpression {
                        start: 16,
                        end: 23,
                        elements: vec![
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 0.into(),
                                raw: "0".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 1.into(),
                                raw: "1".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 2.into(),
                                raw: "2".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 3.into(),
                                raw: "3".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 4.into(),
                                raw: "4".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 5.into(),
                                raw: "5".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 6.into(),
                                raw: "6".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 7.into(),
                                raw: "7".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 8.into(),
                                raw: "8".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 9.into(),
                                raw: "9".to_string(),
                            })),
                            Value::Literal(Box::new(Literal {
                                start: 17,
                                end: 18,
                                value: 10.into(),
                                raw: "10".to_string(),
                            })),
                        ],
                    })),
                }],
                kind: VariableKind::Const,
            })],
            non_code_meta: NonCodeMeta::default(),
        };

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_error_keyword_in_variable() {
        let some_program_string = r#"const let = "thing""#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([6, 9])], message: "Cannot assign a variable to a reserved keyword: let" }"#
        );
    }

    #[test]
    fn test_error_keyword_in_fn_name() {
        let some_program_string = r#"fn let = () {}"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([3, 6])], message: "Cannot assign a variable to a reserved keyword: let" }"#
        );
    }

    #[test]
    fn test_error_stdlib_in_fn_name() {
        let some_program_string = r#"fn cos = () => {
            return 1
        }"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([3, 6])], message: "Cannot assign a variable to a reserved keyword: cos" }"#
        );
    }

    #[test]
    fn test_error_keyword_in_fn_args() {
        let some_program_string = r#"fn thing = (let) => {
    return 1
}"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([12, 15])], message: "Cannot assign a variable to a reserved keyword: let" }"#
        );
    }

    #[test]
    fn test_error_stdlib_in_fn_args() {
        let some_program_string = r#"fn thing = (cos) => {
    return 1
}"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([12, 15])], message: "Cannot assign a variable to a reserved keyword: cos" }"#
        );
    }

    #[test]
    fn zero_param_function() {
        let program = r#"
        fn firstPrimeNumber = () => {
            return 2
        }
        firstPrimeNumber()
        "#;
        let tokens = crate::token::lexer(program);
        let parser = Parser::new(tokens);
        let _ast = parser.ast().unwrap();
    }

    #[test]
    fn test_keyword_ok_in_fn_args_return() {
        let some_program_string = r#"fn thing = (param) => {
    return true
}

thing(false)
"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_error_define_function_as_var() {
        for name in ["var", "let", "const"] {
            let some_program_string = format!(
                r#"{} thing = (param) => {{
    return true
}}

thing(false)
"#,
                name
            );
            let tokens = crate::token::lexer(&some_program_string);
            let parser = Parser::new(tokens);
            let result = parser.ast();
            assert!(result.is_err());
            assert_eq!(
                result.err().unwrap().to_string(),
                format!(
                    r#"syntax: KclErrorDetails {{ source_ranges: [SourceRange([0, {}])], message: "Expected a `fn` variable kind, found: `{}`" }}"#,
                    name.len(),
                    name
                )
            );
        }
    }

    #[test]
    fn test_error_define_var_as_function() {
        let some_program_string = r#"fn thing = "thing""#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        // TODO: https://github.com/KittyCAD/modeling-app/issues/784
        // Improve this error message.
        // It should say that the compiler is expecting a function expression on the RHS.
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([11, 18])], message: "Unexpected token" }"#
        );
    }

    #[test]
    fn test_member_expression_sketch_group() {
        let some_program_string = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
  |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const b1 = cube([0,0], 10)
const b2 = cube([3,3], 4)

const pt1 = b1[0]
const pt2 = b2[0]

show(b1)
show(b2)"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_math_with_stdlib() {
        let some_program_string = r#"const d2r = pi() / 2
let other_thing = 2 * cos(3)"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_negative_arguments() {
        let some_program_string = r#"fn box = (p, h, l, w) => {
 const myBox = startSketchOn('XY')
    |> startProfileAt(p, %)
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}
let myBox = box([0,0], -3, -16, -10)
show(myBox)"#;
        let tokens = crate::token::lexer(some_program_string);
        let parser = Parser::new(tokens);
        parser.ast().unwrap();
    }
}
