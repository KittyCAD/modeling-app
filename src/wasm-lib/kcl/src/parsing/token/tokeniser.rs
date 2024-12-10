use fnv::FnvHashMap;
use lazy_static::lazy_static;
use winnow::{
    ascii::{digit1, multispace1},
    combinator::{alt, opt, peek, preceded, repeat},
    error::{ContextError, ParseError},
    prelude::*,
    stream::{Location, Stream},
    token::{any, none_of, one_of, take_till, take_until},
    Located, Stateful,
};

use crate::{
    parsing::token::{Token, TokenType},
    source_range::ModuleId,
};

lazy_static! {
    pub(crate) static ref RESERVED_WORDS: FnvHashMap<&'static str, TokenType> = {
        let mut set = FnvHashMap::default();
        set.insert("if", TokenType::Keyword);
        set.insert("else", TokenType::Keyword);
        set.insert("for", TokenType::Keyword);
        set.insert("while", TokenType::Keyword);
        set.insert("return", TokenType::Keyword);
        set.insert("break", TokenType::Keyword);
        set.insert("continue", TokenType::Keyword);
        set.insert("fn", TokenType::Keyword);
        set.insert("let", TokenType::Keyword);
        set.insert("mut", TokenType::Keyword);
        set.insert("as", TokenType::Keyword);
        set.insert("loop", TokenType::Keyword);
        set.insert("true", TokenType::Keyword);
        set.insert("false", TokenType::Keyword);
        set.insert("nil", TokenType::Keyword);
        // This isn't a type because brackets are used for the type.
        set.insert("array", TokenType::Keyword);
        set.insert("and", TokenType::Keyword);
        set.insert("or", TokenType::Keyword);
        set.insert("not", TokenType::Keyword);
        set.insert("var", TokenType::Keyword);
        set.insert("const", TokenType::Keyword);
        // "import" is special because of import().
        set.insert("export", TokenType::Keyword);
        set.insert("type", TokenType::Keyword);
        set.insert("interface", TokenType::Keyword);
        set.insert("new", TokenType::Keyword);
        set.insert("self", TokenType::Keyword);
        set.insert("record", TokenType::Keyword);
        set.insert("struct", TokenType::Keyword);
        set.insert("object", TokenType::Keyword);
        set.insert("_", TokenType::Keyword);

        set.insert("string", TokenType::Type);
        set.insert("number", TokenType::Type);
        set.insert("bool", TokenType::Type);
        set.insert("sketch", TokenType::Type);
        set.insert("sketch_surface", TokenType::Type);
        set.insert("solid", TokenType::Type);

        set
    };
}

pub fn lex(i: &str, module_id: ModuleId) -> Result<Vec<Token>, ParseError<Input<'_>, ContextError>> {
    let state = State::new(module_id);
    let input = Input {
        input: Located::new(i),
        state,
    };
    repeat(0.., token).parse(input)
}

pub type Input<'a> = Stateful<Located<&'a str>, State>;

#[derive(Debug, Clone)]
pub struct State {
    pub module_id: ModuleId,
}

impl State {
    fn new(module_id: ModuleId) -> Self {
        Self { module_id }
    }
}

pub fn token(i: &mut Input<'_>) -> PResult<Token> {
    match winnow::combinator::dispatch! {peek(any);
        '"' | '\'' => string,
        '/' => alt((line_comment, block_comment, operator)),
        '{' | '(' | '[' => brace_start,
        '}' | ')' | ']' => brace_end,
        ',' => comma,
        '?' => question_mark,
        '@' => at,
        '0'..='9' => number,
        ':' => colon,
        '.' => alt((number, double_period, period)),
        '#' => hash,
        '$' => dollar,
        '!' => alt((operator, bang)),
        ' ' | '\t' | '\n' => whitespace,
        _ => alt((operator, keyword_type_or_word))
    }
    .parse_next(i)
    {
        Ok(token) => Ok(token),
        Err(x) => {
            // TODO: Handle non ascii cases
            if i.len() == 0 || !i.is_ascii() {
                return Err(x);
            }

            Ok(Token::from_range(
                i.location()..i.location() + 1,
                i.state.module_id,
                TokenType::Unknown,
                i.next_slice(1).to_string(),
            ))
        }
    }
}

fn block_comment(i: &mut Input<'_>) -> PResult<Token> {
    let inner = ("/*", take_until(0.., "*/"), "*/").take();
    let (value, range) = inner.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::BlockComment,
        value.to_string(),
    ))
}

fn line_comment(i: &mut Input<'_>) -> PResult<Token> {
    let inner = (r#"//"#, take_till(0.., ['\n', '\r'])).take();
    let (value, range) = inner.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::LineComment,
        value.to_string(),
    ))
}

fn number(i: &mut Input<'_>) -> PResult<Token> {
    let number_parser = alt((
        // Digits before the decimal point.
        (digit1, opt(('.', digit1))).map(|_| ()),
        // No digits before the decimal point.
        ('.', digit1).map(|_| ()),
    ));
    let (value, range) = number_parser.take().with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Number,
        value.to_string(),
    ))
}

fn whitespace(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = multispace1.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Whitespace,
        value.to_string(),
    ))
}

fn inner_word(i: &mut Input<'_>) -> PResult<()> {
    one_of(('a'..='z', 'A'..='Z', '_')).parse_next(i)?;
    repeat::<_, _, (), _, _>(0.., one_of(('a'..='z', 'A'..='Z', '0'..='9', '_'))).parse_next(i)?;
    Ok(())
}

fn word(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = inner_word.take().with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Word,
        value.to_string(),
    ))
}

fn operator(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = alt((
        ">=", "<=", "==", "=>", "!=", "|>", "*", "+", "-", "/", "%", "=", "<", ">", r"\", "|", "^",
    ))
    .with_span()
    .parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Operator,
        value.to_string(),
    ))
}

fn brace_start(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = alt(('{', '(', '[')).with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Brace,
        value.to_string(),
    ))
}

fn brace_end(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = alt(('}', ')', ']')).with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Brace,
        value.to_string(),
    ))
}

fn comma(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = ','.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Comma,
        value.to_string(),
    ))
}

fn hash(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = '#'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Hash,
        value.to_string(),
    ))
}

fn bang(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = '!'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Bang,
        value.to_string(),
    ))
}

fn dollar(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = '$'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Dollar,
        value.to_string(),
    ))
}

fn question_mark(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = '?'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::QuestionMark,
        value.to_string(),
    ))
}

fn at(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = '@'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::At,
        value.to_string(),
    ))
}

fn colon(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = ':'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Colon,
        value.to_string(),
    ))
}

fn period(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = '.'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Period,
        value.to_string(),
    ))
}

fn double_period(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = "..".with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::DoublePeriod,
        value.to_string(),
    ))
}

/// Zero or more of either:
/// 1. Any character except " or \
/// 2. Any character preceded by \
fn inner_double_quote(i: &mut Input<'_>) -> PResult<()> {
    repeat(0.., alt((none_of(('"', '\\')), preceded('\\', winnow::token::any)))).parse_next(i)
}

/// Zero or more of either:
/// 1. Any character except ' or \
/// 2. Any character preceded by \
fn inner_single_quote(i: &mut Input<'_>) -> PResult<()> {
    repeat(0.., alt((none_of(('\'', '\\')), preceded('\\', winnow::token::any)))).parse_next(i)
}

fn string(i: &mut Input<'_>) -> PResult<Token> {
    let single_quoted_string = ('\'', inner_single_quote.take(), '\'');
    let double_quoted_string = ('"', inner_double_quote.take(), '"');
    let either_quoted_string = alt((single_quoted_string.take(), double_quoted_string.take()));
    let (value, range): (&str, _) = either_quoted_string.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::String,
        value.to_string(),
    ))
}

fn import_keyword(i: &mut Input<'_>) -> PResult<Token> {
    let (value, range) = "import".with_span().parse_next(i)?;
    let token_type = peek(alt((' '.map(|_| TokenType::Keyword), '('.map(|_| TokenType::Word)))).parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        token_type,
        value.to_owned(),
    ))
}

fn unambiguous_keyword_type_or_word(i: &mut Input<'_>) -> PResult<Token> {
    let mut w = word.parse_next(i)?;
    if let Some(token_type) = RESERVED_WORDS.get(w.value.as_str()) {
        w.token_type = *token_type;
    }
    Ok(w)
}

fn keyword_type_or_word(i: &mut Input<'_>) -> PResult<Token> {
    alt((import_keyword, unambiguous_keyword_type_or_word)).parse_next(i)
}

#[cfg(test)]
mod tests {
    use winnow::Located;

    use super::*;
    fn assert_parse_err<'i, P, O, E>(mut p: P, s: &'i str)
    where
        O: std::fmt::Debug,
        P: Parser<Input<'i>, O, E>,
    {
        let state = State::new(ModuleId::default());
        let mut input = Input {
            input: Located::new(s),
            state,
        };
        assert!(p.parse_next(&mut input).is_err(), "parsed {s} but should have failed");
    }

    fn assert_parse_ok<'i, P, O, E>(mut p: P, s: &'i str)
    where
        E: std::fmt::Debug,
        O: std::fmt::Debug,
        P: Parser<Input<'i>, O, E>,
    {
        let state = State::new(ModuleId::default());
        let mut input = Input {
            input: Located::new(s),
            state,
        };
        let res = p.parse_next(&mut input);
        assert!(res.is_ok(), "failed to parse {s}, got {}", res.unwrap_err());
    }

    #[test]
    fn test_number() {
        for valid in [
            "1", "1 abc", "1.1", "1.1 abv", "1.1 abv", "1", ".1", "5?", "5 + 6", "5 + a", "5.5", "1abc",
        ] {
            assert_parse_ok(number, valid);
        }

        for invalid in ["a", "?", "?5"] {
            assert_parse_err(number, invalid);
        }

        let module_id = ModuleId::from_usize(1);
        let input = Input {
            input: Located::new("0.0000000000"),
            state: State::new(module_id),
        };

        assert_eq!(number.parse(input).unwrap().value, "0.0000000000");
    }

    #[test]
    fn test_word() {
        for valid in ["a", "a ", "a5", "a5a"] {
            assert_parse_ok(word, valid);
        }

        for invalid in ["5", "5a", "5a5"] {
            assert_parse_err(word, invalid);
        }
    }

    #[test]
    fn test_operator() {
        for valid in [
            "+", "+ ", "-", "<=", "<= ", ">=", ">= ", "> ", "< ", "| ", "|> ", "^ ", "% ", "+* ",
        ] {
            assert_parse_ok(operator, valid);
        }

        for invalid in ["5 + 5", "a", "a+", "a+5", "5a+5", ", newVar", ","] {
            assert_parse_err(operator, invalid);
        }
    }

    #[test]
    fn test_string() {
        for valid in [
            "\"\"",
            "\"a\"",
            "\"a\" ",
            "\"a\"5",
            "'a'5",
            "\"with escaped \\\" backslash\"",
            "\'with escaped \\\' backslash\'",
            "'c'",
        ] {
            assert_parse_ok(string, valid);
        }

        for invalid in ["\"", "\"a", "a\"", " \"a\"", "5\"a\"", "a + 'str'"] {
            assert_parse_err(string, invalid);
        }
    }

    fn assert_tokens(expected: Vec<Token>, actual: Vec<Token>) {
        assert_eq!(
            expected.len(),
            actual.len(),
            "\nexpected {} tokens, actually got {}",
            expected.len(),
            actual.len()
        );

        let n = expected.len();
        for i in 0..n {
            assert_eq!(
                expected[i], actual[i],
                "token #{i} (of {n}) does not match.\nExpected:\n{:#?}\nActual:\n{:#?}",
                expected[i], actual[i],
            )
        }
    }

    #[test]
    fn test_program0() {
        let program = "const a=5";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Keyword,
                value: "const".to_string(),
                start: 0,
                end: 5,
                module_id,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 5,
                end: 6,
                module_id,
            },
            Token {
                token_type: TokenType::Word,
                value: "a".to_string(),
                start: 6,
                end: 7,
                module_id,
            },
            Token {
                token_type: TokenType::Operator,
                value: "=".to_string(),
                start: 7,
                end: 8,
                module_id,
            },
            Token {
                token_type: TokenType::Number,
                value: "5".to_string(),
                start: 8,
                end: 9,
                module_id,
            },
        ];
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_program1() {
        let program = "54 + 22500 + 6";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Number,
                value: "54".to_string(),
                start: 0,
                end: 2,
                module_id,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 2,
                end: 3,
                module_id,
            },
            Token {
                token_type: TokenType::Operator,
                value: "+".to_string(),
                start: 3,
                end: 4,
                module_id,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 4,
                end: 5,
                module_id,
            },
            Token {
                token_type: TokenType::Number,
                value: "22500".to_string(),
                start: 5,
                end: 10,
                module_id,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 10,
                end: 11,
                module_id,
            },
            Token {
                token_type: TokenType::Operator,
                value: "+".to_string(),
                start: 11,
                end: 12,
                module_id,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 12,
                end: 13,
                module_id,
            },
            Token {
                token_type: TokenType::Number,
                value: "6".to_string(),
                start: 13,
                end: 14,
                module_id,
            },
        ];
        assert_tokens(expected, actual);
    }
    #[test]
    fn test_program2() {
        let program = r#"const part001 = startSketchAt([0.0000000000, 5.0000000000])
    |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [part001, 0.0]
let blah = 1
const foo = false
let baz = {a: 1, part001: "thing"}

fn ghi = (part001) => {
  return part001
}

show(part001)"#;
        let module_id = ModuleId::from_usize(1);

        use TokenType::*;

        let expected = vec![
            Token {
                token_type: Keyword,
                start: 0,
                end: 5,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 5,
                end: 6,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 6,
                end: 13,
                module_id,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 13,
                end: 14,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 14,
                end: 15,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 15,
                end: 16,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 16,
                end: 29,
                module_id,
                value: "startSketchAt".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 29,
                end: 30,
                module_id,
                value: "(".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 30,
                end: 31,
                module_id,
                value: "[".to_owned(),
            },
            Token {
                token_type: Number,
                start: 31,
                end: 43,
                module_id,
                value: "0.0000000000".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 43,
                end: 44,
                module_id,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 44,
                end: 45,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 45,
                end: 57,
                module_id,
                value: "5.0000000000".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 57,
                end: 58,
                module_id,
                value: "]".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 58,
                end: 59,
                module_id,
                value: ")".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 59,
                end: 64,
                module_id,
                value: "\n    ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 64,
                end: 66,
                module_id,
                value: "|>".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 66,
                end: 67,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 67,
                end: 71,
                module_id,
                value: "line".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 71,
                end: 72,
                module_id,
                value: "(".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 72,
                end: 73,
                module_id,
                value: "[".to_owned(),
            },
            Token {
                token_type: Number,
                start: 73,
                end: 85,
                module_id,
                value: "0.4900857016".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 85,
                end: 86,
                module_id,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 86,
                end: 87,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 87,
                end: 88,
                module_id,
                value: "-".to_owned(),
            },
            Token {
                token_type: Number,
                start: 88,
                end: 100,
                module_id,
                value: "0.0240763666".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 100,
                end: 101,
                module_id,
                value: "]".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 101,
                end: 102,
                module_id,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 102,
                end: 103,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 103,
                end: 104,
                module_id,
                value: "%".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 104,
                end: 105,
                module_id,
                value: ")".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 105,
                end: 107,
                module_id,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 107,
                end: 112,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 112,
                end: 113,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 113,
                end: 120,
                module_id,
                value: "part002".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 120,
                end: 121,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 121,
                end: 122,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 122,
                end: 123,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 123,
                end: 132,
                module_id,
                value: "\"part002\"".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 132,
                end: 133,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 133,
                end: 138,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 138,
                end: 139,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 139,
                end: 145,
                module_id,
                value: "things".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 145,
                end: 146,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 146,
                end: 147,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 147,
                end: 148,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 148,
                end: 149,
                module_id,
                value: "[".to_owned(),
            },
            Token {
                token_type: Word,
                start: 149,
                end: 156,
                module_id,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 156,
                end: 157,
                module_id,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 157,
                end: 158,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 158,
                end: 161,
                module_id,
                value: "0.0".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 161,
                end: 162,
                module_id,
                value: "]".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 162,
                end: 163,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 163,
                end: 166,
                module_id,
                value: "let".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 166,
                end: 167,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 167,
                end: 171,
                module_id,
                value: "blah".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 171,
                end: 172,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 172,
                end: 173,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 173,
                end: 174,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 174,
                end: 175,
                module_id,
                value: "1".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 175,
                end: 176,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 176,
                end: 181,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 181,
                end: 182,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 182,
                end: 185,
                module_id,
                value: "foo".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 185,
                end: 186,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 186,
                end: 187,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 187,
                end: 188,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 188,
                end: 193,
                module_id,
                value: "false".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 193,
                end: 194,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 194,
                end: 197,
                module_id,
                value: "let".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 197,
                end: 198,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 198,
                end: 201,
                module_id,
                value: "baz".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 201,
                end: 202,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 202,
                end: 203,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 203,
                end: 204,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 204,
                end: 205,
                module_id,
                value: "{".to_owned(),
            },
            Token {
                token_type: Word,
                start: 205,
                end: 206,
                module_id,
                value: "a".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 206,
                end: 207,
                module_id,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 207,
                end: 208,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 208,
                end: 209,
                module_id,
                value: "1".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 209,
                end: 210,
                module_id,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 210,
                end: 211,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 211,
                end: 218,
                module_id,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 218,
                end: 219,
                module_id,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 219,
                end: 220,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 220,
                end: 227,
                module_id,
                value: "\"thing\"".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 227,
                end: 228,
                module_id,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 228,
                end: 230,
                module_id,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 230,
                end: 232,
                module_id,
                value: "fn".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 232,
                end: 233,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 233,
                end: 236,
                module_id,
                value: "ghi".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 236,
                end: 237,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 237,
                end: 238,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 238,
                end: 239,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 239,
                end: 240,
                module_id,
                value: "(".to_owned(),
            },
            Token {
                token_type: Word,
                start: 240,
                end: 247,
                module_id,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 247,
                end: 248,
                module_id,
                value: ")".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 248,
                end: 249,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 249,
                end: 251,
                module_id,
                value: "=>".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 251,
                end: 252,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 252,
                end: 253,
                module_id,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 253,
                end: 256,
                module_id,
                value: "\n  ".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 256,
                end: 262,
                module_id,
                value: "return".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 262,
                end: 263,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 263,
                end: 270,
                module_id,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 270,
                end: 271,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 271,
                end: 272,
                module_id,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 272,
                end: 274,
                module_id,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Word,
                start: 274,
                end: 278,
                module_id,
                value: "show".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 278,
                end: 279,
                module_id,
                value: "(".to_owned(),
            },
            Token {
                token_type: Word,
                start: 279,
                end: 286,
                module_id,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 286,
                end: 287,
                module_id,
                value: ")".to_owned(),
            },
        ];
        let actual = lex(program, module_id).unwrap();
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_program3() {
        let program = r#"
// this is a comment
const yo = { a: { b: { c: '123' } } }

const key = 'c'
const things = "things"

// this is also a comment"#;
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();
        use TokenType::*;
        let expected = vec![
            Token {
                token_type: Whitespace,
                start: 0,
                end: 1,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: LineComment,
                start: 1,
                end: 21,
                module_id,
                value: "// this is a comment".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 21,
                end: 22,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 22,
                end: 27,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 27,
                end: 28,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 28,
                end: 30,
                module_id,
                value: "yo".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 30,
                end: 31,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 31,
                end: 32,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 32,
                end: 33,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 33,
                end: 34,
                module_id,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 34,
                end: 35,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 35,
                end: 36,
                module_id,
                value: "a".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 36,
                end: 37,
                module_id,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 37,
                end: 38,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 38,
                end: 39,
                module_id,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 39,
                end: 40,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 40,
                end: 41,
                module_id,
                value: "b".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 41,
                end: 42,
                module_id,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 42,
                end: 43,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 43,
                end: 44,
                module_id,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 44,
                end: 45,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 45,
                end: 46,
                module_id,
                value: "c".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 46,
                end: 47,
                module_id,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 47,
                end: 48,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 48,
                end: 53,
                module_id,
                value: "'123'".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 53,
                end: 54,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 54,
                end: 55,
                module_id,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 55,
                end: 56,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 56,
                end: 57,
                module_id,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 57,
                end: 58,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 58,
                end: 59,
                module_id,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 59,
                end: 61,
                module_id,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 61,
                end: 66,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 66,
                end: 67,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 67,
                end: 70,
                module_id,
                value: "key".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 70,
                end: 71,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 71,
                end: 72,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 72,
                end: 73,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 73,
                end: 76,
                module_id,
                value: "'c'".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 76,
                end: 77,
                module_id,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 77,
                end: 82,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 82,
                end: 83,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 83,
                end: 89,
                module_id,
                value: "things".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 89,
                end: 90,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 90,
                end: 91,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 91,
                end: 92,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 92,
                end: 100,
                module_id,
                value: "\"things\"".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 100,
                end: 102,
                module_id,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: LineComment,
                start: 102,
                end: 127,
                module_id,
                value: "// this is also a comment".to_owned(),
            },
        ];
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_program4() {
        let program = "const myArray = [0..10]";
        let module_id = ModuleId::from_usize(1);
        use TokenType::*;
        let expected = vec![
            Token {
                token_type: Keyword,
                start: 0,
                end: 5,
                module_id,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 5,
                end: 6,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 6,
                end: 13,
                module_id,
                value: "myArray".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 13,
                end: 14,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 14,
                end: 15,
                module_id,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 15,
                end: 16,
                module_id,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 16,
                end: 17,
                module_id,
                value: "[".to_owned(),
            },
            Token {
                token_type: Number,
                start: 17,
                end: 18,
                module_id,
                value: "0".to_owned(),
            },
            Token {
                token_type: DoublePeriod,
                start: 18,
                end: 20,
                module_id,
                value: "..".to_owned(),
            },
            Token {
                token_type: Number,
                start: 20,
                end: 22,
                module_id,
                value: "10".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 22,
                end: 23,
                module_id,
                value: "]".to_owned(),
            },
        ];
        let actual = lex(program, module_id).unwrap();
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_kitt() {
        let program = include_str!("../../../../tests/executor/inputs/kittycad_svg.kcl");
        let actual = lex(program, ModuleId::default()).unwrap();
        assert_eq!(actual.len(), 5103);
    }
    #[test]
    fn test_pipes_on_pipes() {
        let program = include_str!("../../../../tests/executor/inputs/pipes_on_pipes.kcl");
        let actual = lex(program, ModuleId::default()).unwrap();
        assert_eq!(actual.len(), 17841);
    }
    #[test]
    fn test_lexer_negative_word() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("-legX", module_id).unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Operator,
                value: "-".to_string(),
                start: 0,
                end: 1,
                module_id,
            },
            Token {
                token_type: TokenType::Word,
                value: "legX".to_string(),
                start: 1,
                end: 5,
                module_id,
            },
        ];
        assert_tokens(expected, actual);
    }

    #[test]
    fn not_eq() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("!=", module_id).unwrap();
        let expected = vec![Token {
            token_type: TokenType::Operator,
            value: "!=".to_owned(),
            start: 0,
            end: 2,
            module_id,
        }];
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_unrecognized_token() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("12 ; 8", module_id).unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Number,
                value: "12".to_string(),
                start: 0,
                end: 2,
                module_id,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 2,
                end: 3,
                module_id,
            },
            Token {
                token_type: TokenType::Unknown,
                value: ";".to_string(),
                start: 3,
                end: 4,
                module_id,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 4,
                end: 5,
                module_id,
            },
            Token {
                token_type: TokenType::Number,
                value: "8".to_string(),
                start: 5,
                end: 6,
                module_id,
            },
        ];

        assert_tokens(expected, actual);
    }

    #[test]
    fn import_keyword() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("import foo", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Keyword,
            value: "import".to_owned(),
            start: 0,
            end: 6,
            module_id,
        };
        assert_eq!(actual[0], expected);
    }

    #[test]
    fn import_function() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("import(3)", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Word,
            value: "import".to_owned(),
            start: 0,
            end: 6,
            module_id,
        };
        assert_eq!(actual[0], expected);
    }
}
