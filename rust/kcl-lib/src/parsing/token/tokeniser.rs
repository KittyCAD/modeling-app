use fnv::FnvHashMap;
use lazy_static::lazy_static;
use winnow::{
    LocatingSlice, Stateful,
    ascii::{digit1, multispace1},
    combinator::{alt, opt, peek, preceded, repeat},
    error::{ContextError, ParseError},
    prelude::*,
    stream::{Location, Stream},
    token::{any, none_of, take_till, take_until, take_while},
};

use super::TokenStream;
use crate::{
    ModuleId,
    parsing::token::{Token, TokenType},
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
        set.insert("and", TokenType::Keyword);
        set.insert("or", TokenType::Keyword);
        set.insert("not", TokenType::Keyword);
        set.insert("var", TokenType::Keyword);
        set.insert("const", TokenType::Keyword);
        set.insert("import", TokenType::Keyword);
        set.insert("export", TokenType::Keyword);
        set.insert("type", TokenType::Keyword);
        set.insert("interface", TokenType::Keyword);
        set.insert("new", TokenType::Keyword);
        set.insert("self", TokenType::Keyword);
        set.insert("record", TokenType::Keyword);
        set.insert("struct", TokenType::Keyword);
        set.insert("object", TokenType::Keyword);

        set
    };
}

pub(super) fn lex(i: &str, module_id: ModuleId) -> Result<TokenStream, ParseError<Input<'_>, ContextError>> {
    let state = State::new(module_id);
    let input = Input {
        input: LocatingSlice::new(i),
        state,
    };
    Ok(TokenStream::new(repeat(0.., token).parse(input)?))
}

pub(super) type Input<'a> = Stateful<LocatingSlice<&'a str>, State>;

#[derive(Debug, Clone)]
pub(super) struct State {
    pub module_id: ModuleId,
}

impl State {
    fn new(module_id: ModuleId) -> Self {
        Self { module_id }
    }
}

pub(super) fn token(i: &mut Input<'_>) -> ModalResult<Token> {
    match winnow::combinator::dispatch! {peek(any);
        '"' | '\'' => string,
        '/' => alt((line_comment, block_comment, operator)),
        '{' | '(' | '[' => brace_start,
        '}' | ')' | ']' => brace_end,
        ',' => comma,
        '?' => question_mark,
        '@' => at,
        '0'..='9' => number,
        ';' => semi_colon,
        ':' => alt((double_colon, colon)),
        '.' => alt((number, double_period_less_than, double_period, period)),
        '#' => hash,
        '$' => dollar,
        '!' => alt((operator, bang)),
        ' ' | '\t' | '\n' | '\r' => whitespace,
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

            let start = i.current_token_start();
            Ok(Token::from_range(
                start..start + 1,
                i.state.module_id,
                TokenType::Unknown,
                i.next_slice(1).to_string(),
            ))
        }
    }
}

fn block_comment(i: &mut Input<'_>) -> ModalResult<Token> {
    let inner = ("/*", take_until(0.., "*/"), "*/").take();
    let (value, range) = inner.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::BlockComment,
        value.to_string(),
    ))
}

fn line_comment(i: &mut Input<'_>) -> ModalResult<Token> {
    let inner = (r#"//"#, take_till(0.., ['\n', '\r'])).take();
    let (value, range) = inner.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::LineComment,
        value.to_string(),
    ))
}

fn number(i: &mut Input<'_>) -> ModalResult<Token> {
    let number_parser = alt((
        // Digits before the decimal point.
        (digit1, opt(('.', digit1)), opt('_'), opt(alt(super::NUM_SUFFIXES))).map(|_| ()),
        // No digits before the decimal point.
        ('.', digit1, opt('_'), opt(alt(super::NUM_SUFFIXES))).map(|_| ()),
    ));
    let (value, range) = number_parser.take().with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Number,
        value.to_string(),
    ))
}

fn whitespace(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = multispace1.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Whitespace,
        value.to_string(),
    ))
}

fn inner_word(i: &mut Input<'_>) -> ModalResult<()> {
    take_while(1.., |c: char| c.is_alphabetic() || c == '_').parse_next(i)?;
    take_while(0.., |c: char| c.is_alphabetic() || c.is_ascii_digit() || c == '_').parse_next(i)?;
    Ok(())
}

fn word(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = inner_word.take().with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Word,
        value.to_string(),
    ))
}

fn operator(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = alt((
        ">=", "<=", "==", "=>", "!=", "|>", "*", "+", "-", "/", "%", "=", "<", ">", r"\", "^", "||", "&&", "|", "&",
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

fn brace_start(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = alt(('{', '(', '[')).with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Brace,
        value.to_string(),
    ))
}

fn brace_end(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = alt(('}', ')', ']')).with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Brace,
        value.to_string(),
    ))
}

fn comma(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = ','.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Comma,
        value.to_string(),
    ))
}

fn hash(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = '#'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Hash,
        value.to_string(),
    ))
}

fn bang(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = '!'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Bang,
        value.to_string(),
    ))
}

fn dollar(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = '$'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Dollar,
        value.to_string(),
    ))
}

fn question_mark(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = '?'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::QuestionMark,
        value.to_string(),
    ))
}

fn at(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = '@'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::At,
        value.to_string(),
    ))
}

fn colon(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = ':'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Colon,
        value.to_string(),
    ))
}

fn semi_colon(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = ';'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::SemiColon,
        value.to_string(),
    ))
}

fn double_colon(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = "::".with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::DoubleColon,
        value.to_string(),
    ))
}
fn period(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = '.'.with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::Period,
        value.to_string(),
    ))
}

fn double_period(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = "..".with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::DoublePeriod,
        value.to_string(),
    ))
}

fn double_period_less_than(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = "..<".with_span().parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        TokenType::DoublePeriodLessThan,
        value.to_string(),
    ))
}

/// Zero or more of either:
/// 1. Any character except " or \
/// 2. Any character preceded by \
fn inner_double_quote(i: &mut Input<'_>) -> ModalResult<()> {
    repeat(0.., alt((none_of(('"', '\\')), preceded('\\', winnow::token::any)))).parse_next(i)
}

/// Zero or more of either:
/// 1. Any character except ' or \
/// 2. Any character preceded by \
fn inner_single_quote(i: &mut Input<'_>) -> ModalResult<()> {
    repeat(0.., alt((none_of(('\'', '\\')), preceded('\\', winnow::token::any)))).parse_next(i)
}

fn string(i: &mut Input<'_>) -> ModalResult<Token> {
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

fn import_keyword(i: &mut Input<'_>) -> ModalResult<Token> {
    let (value, range) = "import".with_span().parse_next(i)?;
    let token_type = peek(alt((' '.map(|_| TokenType::Keyword), '('.map(|_| TokenType::Word)))).parse_next(i)?;
    Ok(Token::from_range(
        range,
        i.state.module_id,
        token_type,
        value.to_owned(),
    ))
}

fn unambiguous_keyword_type_or_word(i: &mut Input<'_>) -> ModalResult<Token> {
    let mut w = word.parse_next(i)?;
    if let Some(token_type) = RESERVED_WORDS.get(w.value.as_str()) {
        w.token_type = *token_type;
    }
    Ok(w)
}

fn keyword_type_or_word(i: &mut Input<'_>) -> ModalResult<Token> {
    alt((import_keyword, unambiguous_keyword_type_or_word)).parse_next(i)
}

#[cfg(test)]
mod tests {
    use winnow::LocatingSlice;

    use super::*;
    use crate::parsing::token::TokenSlice;

    fn assert_parse_err<'i, P, O, E>(mut p: P, s: &'i str)
    where
        O: std::fmt::Debug,
        P: Parser<Input<'i>, O, E>,
    {
        let state = State::new(ModuleId::default());
        let mut input = Input {
            input: LocatingSlice::new(s),
            state,
        };
        assert!(p.parse_next(&mut input).is_err(), "parsed {s} but should have failed");
    }

    // Returns the token and whether any more input is remaining to tokenize.
    fn assert_parse_ok<'i, P, O, E>(mut p: P, s: &'i str) -> (O, bool)
    where
        E: std::fmt::Debug + std::fmt::Display,
        O: std::fmt::Debug,
        P: Parser<Input<'i>, O, E>,
    {
        let state = State::new(ModuleId::default());
        let mut input = Input {
            input: LocatingSlice::new(s),
            state,
        };
        let res = p.parse_next(&mut input);
        assert!(res.is_ok(), "failed to parse {s}, got {}", res.unwrap_err());
        (res.unwrap(), !input.is_empty())
    }

    #[test]
    fn test_number() {
        for (valid, expected) in [
            ("1", false),
            ("1 abc", true),
            ("1.1", false),
            ("1.1 abv", true),
            ("1.1 abv", true),
            ("1", false),
            (".1", false),
            ("5!", true),
            ("5 + 6", true),
            ("5 + a", true),
            ("5.5", false),
            ("1abc", true),
        ] {
            let (_, remaining) = assert_parse_ok(number, valid);
            assert_eq!(expected, remaining, "`{valid}` expected another token to be {expected}");
        }

        for invalid in ["a", "!", "!5"] {
            assert_parse_err(number, invalid);
        }

        let module_id = ModuleId::from_usize(1);
        let input = Input {
            input: LocatingSlice::new("0.0000000000"),
            state: State::new(module_id),
        };

        assert_eq!(number.parse(input).unwrap().value, "0.0000000000");
    }

    #[test]
    fn test_number_suffix() {
        for (valid, expected_val, expected_next) in [
            ("1_", 1.0, false),
            ("1_mm", 1.0, false),
            ("1_yd", 1.0, false),
            ("1m", 1.0, false),
            ("1inch", 1.0, false),
            ("1toot", 1.0, true),
            ("1.4inch t", 1.4, true),
        ] {
            let (t, remaining) = assert_parse_ok(number, valid);
            assert_eq!(expected_next, remaining);
            assert_eq!(
                Some(expected_val),
                t.numeric_value(),
                "{valid} has incorrect numeric value, expected {expected_val} {t:?}"
            );
        }
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
            "+", "+ ", "-", "<=", "<= ", ">=", ">= ", "> ", "< ", "|> ", "^ ", "% ", "+* ", "| ", "& ",
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

    #[track_caller]
    fn assert_tokens(expected: &[(TokenType, usize, usize)], actual: TokenSlice) {
        let mut e = 0;
        let mut issues = vec![];
        for a in actual {
            if expected[e].0 != a.token_type {
                if a.token_type == TokenType::Whitespace {
                    continue;
                }
                issues.push(format!(
                    "Type mismatch: expected `{}`, found `{}` (`{a:?}`), at index {e}",
                    expected[e].0, a.token_type
                ));
            }

            if expected[e].1 != a.start || expected[e].2 != a.end {
                issues.push(format!(
                    "Source range mismatch: expected {}-{}, found {}-{} (`{a:?}`), at index {e}",
                    expected[e].1, expected[e].2, a.start, a.end
                ));
            }

            e += 1;
        }
        if e < expected.len() {
            issues.push(format!("Expected `{}` tokens, found `{e}`", expected.len()));
        }
        assert!(issues.is_empty(), "{}", issues.join("\n"));
    }

    #[test]
    fn test_program0() {
        let program = "const a=5";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();

        use TokenType::*;
        assert_tokens(
            &[(Keyword, 0, 5), (Word, 6, 7), (Operator, 7, 8), (Number, 8, 9)],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_program1() {
        let program = "54 + 22500 + 6";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();

        use TokenType::*;
        assert_tokens(
            &[
                (Number, 0, 2),
                (Operator, 3, 4),
                (Number, 5, 10),
                (Operator, 11, 12),
                (Number, 13, 14),
            ],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_program2() {
        let program = r#"const part001 = startSketchOn(XY)
    |> startProfileAt([0.0000000000, 5.0000000000], %)
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
        let actual = lex(program, module_id).unwrap();
        insta::assert_debug_snapshot!(actual.tokens);
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
        assert_tokens(
            &[
                (Whitespace, 0, 1),
                (LineComment, 1, 21),
                (Whitespace, 21, 22),
                (Keyword, 22, 27),
                (Whitespace, 27, 28),
                (Word, 28, 30),
                (Whitespace, 30, 31),
                (Operator, 31, 32),
                (Whitespace, 32, 33),
                (Brace, 33, 34),
                (Whitespace, 34, 35),
                (Word, 35, 36),
                (Colon, 36, 37),
                (Whitespace, 37, 38),
                (Brace, 38, 39),
                (Whitespace, 39, 40),
                (Word, 40, 41),
                (Colon, 41, 42),
                (Whitespace, 42, 43),
                (Brace, 43, 44),
                (Whitespace, 44, 45),
                (Word, 45, 46),
                (Colon, 46, 47),
                (Whitespace, 47, 48),
                (String, 48, 53),
                (Whitespace, 53, 54),
                (Brace, 54, 55),
                (Whitespace, 55, 56),
                (Brace, 56, 57),
                (Whitespace, 57, 58),
                (Brace, 58, 59),
                (Whitespace, 59, 61),
                (Keyword, 61, 66),
                (Whitespace, 66, 67),
                (Word, 67, 70),
                (Whitespace, 70, 71),
                (Operator, 71, 72),
                (Whitespace, 72, 73),
                (String, 73, 76),
                (Whitespace, 76, 77),
                (Keyword, 77, 82),
                (Whitespace, 82, 83),
                (Word, 83, 89),
                (Whitespace, 89, 90),
                (Operator, 90, 91),
                (Whitespace, 91, 92),
                (String, 92, 100),
                (Whitespace, 100, 102),
                (LineComment, 102, 127),
            ],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_program4() {
        let program = "const myArray = [0..10]";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();

        use TokenType::*;
        assert_tokens(
            &[
                (Keyword, 0, 5),
                (Word, 6, 13),
                (Operator, 14, 15),
                (Brace, 16, 17),
                (Number, 17, 18),
                (DoublePeriod, 18, 20),
                (Number, 20, 22),
                (Brace, 22, 23),
            ],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_lexer_negative_word() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("-legX", module_id).unwrap();

        use TokenType::*;
        assert_tokens(&[(Operator, 0, 1), (Word, 1, 5)], actual.as_slice());
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
        assert_eq!(actual.tokens, expected);
    }

    #[test]
    fn test_unrecognized_token() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("12 ~ 8", module_id).unwrap();

        use TokenType::*;
        assert_tokens(&[(Number, 0, 2), (Unknown, 3, 4), (Number, 5, 6)], actual.as_slice());
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
        assert_eq!(actual.tokens[0], expected);
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
        assert_eq!(actual.tokens[0], expected);
    }

    #[test]
    fn test_is_code_token() {
        let module_id = ModuleId::default();
        let actual = lex("foo (4/* comment */ +,2,\"sdfsdf\") // comment", module_id).unwrap();
        let non_code = [1, 4, 5, 12, 13];
        for i in 0..14 {
            if non_code.contains(&i) {
                assert!(
                    !actual.tokens[i].is_code_token(),
                    "failed test {i}: {:?}",
                    &actual.tokens[i],
                );
            } else {
                assert!(
                    actual.tokens[i].is_code_token(),
                    "failed test {i}: {:?}",
                    &actual.tokens[i],
                );
            }
        }
    }
    #[test]
    fn test_boolean_literal() {
        let module_id = ModuleId::default();
        let actual = lex("true", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Keyword,
            value: "true".to_owned(),
            start: 0,
            end: 4,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }

    #[test]
    fn test_word_starting_with_keyword() {
        let module_id = ModuleId::default();
        let actual = lex("truee", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Word,
            value: "truee".to_owned(),
            start: 0,
            end: 5,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }

    #[test]
    fn non_english_identifiers() {
        let module_id = ModuleId::default();
        let actual = lex("亞當", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Word,
            value: "亞當".to_owned(),
            start: 0,
            end: 6,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }
}
