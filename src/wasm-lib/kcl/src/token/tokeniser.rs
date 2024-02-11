use winnow::{
    ascii::{digit1, multispace1},
    combinator::{alt, opt, peek, preceded, repeat, terminated},
    error::{ContextError, ParseError},
    prelude::*,
    stream::{Location, Stream},
    token::{any, none_of, one_of, take_till, take_until},
    Located,
};

use crate::token::{Token, TokenType};

pub fn lexer(i: &str) -> Result<Vec<Token>, ParseError<Located<&str>, ContextError>> {
    repeat(0.., token).parse(Located::new(i))
}

pub fn token(i: &mut Located<&str>) -> PResult<Token> {
    match winnow::combinator::dispatch! {peek(any);
        '"' | '\'' => string,
        '/' => alt((line_comment, block_comment, operator)),
        '{' | '(' | '[' => brace_start,
        '}' | ')' | ']' => brace_end,
        ',' => comma,
        '?' => question_mark,
        '0'..='9' => number,
        ':' => colon,
        '.' => alt((number, double_period, period)),
        ' ' | '\t' | '\n' => whitespace,
        _ => alt((operator, keyword, word))
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
                TokenType::Unknown,
                i.next_slice(1).to_string(),
            ))
        }
    }
}

fn block_comment(i: &mut Located<&str>) -> PResult<Token> {
    let inner = ("/*", take_until(0, "*/"), "*/").recognize();
    let (value, range) = inner.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::BlockComment, value.to_string()))
}

fn line_comment(i: &mut Located<&str>) -> PResult<Token> {
    let inner = (r#"//"#, take_till(1, ['\n', '\r'])).recognize();
    let (value, range) = inner.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::LineComment, value.to_string()))
}

fn number(i: &mut Located<&str>) -> PResult<Token> {
    let number_parser = alt((
        // Digits before the decimal point.
        (digit1, opt(('.', digit1))).map(|_| ()),
        // No digits before the decimal point.
        ('.', digit1).map(|_| ()),
    ));
    let (value, range) = number_parser.recognize().with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Number, value.to_string()))
}

fn whitespace(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = multispace1.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Whitespace, value.to_string()))
}

fn inner_word(i: &mut Located<&str>) -> PResult<()> {
    one_of(('a'..='z', 'A'..='Z', '_')).parse_next(i)?;
    repeat(0.., one_of(('a'..='z', 'A'..='Z', '0'..='9', '_'))).parse_next(i)?;
    Ok(())
}

fn word(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = inner_word.recognize().with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Word, value.to_string()))
}

fn operator(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = alt((
        ">=", "<=", "==", "=>", "!= ", "|>", "*", "+", "-", "/", "%", "=", "<", ">", r"\", "|", "^",
    ))
    .with_span()
    .parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Operator, value.to_string()))
}

fn brace_start(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = alt(('{', '(', '[')).with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Brace, value.to_string()))
}

fn brace_end(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = alt(('}', ')', ']')).with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Brace, value.to_string()))
}

fn comma(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = ','.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Comma, value.to_string()))
}

fn question_mark(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = '?'.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::QuestionMark, value.to_string()))
}

fn colon(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = ':'.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Colon, value.to_string()))
}

fn period(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = '.'.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Period, value.to_string()))
}

fn double_period(i: &mut Located<&str>) -> PResult<Token> {
    let (value, range) = "..".with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::DoublePeriod, value.to_string()))
}

/// Zero or more of either:
/// 1. Any character except " or \
/// 2. Any character preceded by \
fn inner_double_quote(i: &mut Located<&str>) -> PResult<()> {
    repeat(0.., alt((none_of(('"', '\\')), preceded('\\', winnow::token::any)))).parse_next(i)
}

/// Zero or more of either:
/// 1. Any character except ' or \
/// 2. Any character preceded by \
fn inner_single_quote(i: &mut Located<&str>) -> PResult<()> {
    repeat(0.., alt((none_of(('\'', '\\')), preceded('\\', winnow::token::any)))).parse_next(i)
}

fn string(i: &mut Located<&str>) -> PResult<Token> {
    let single_quoted_string = ('\'', inner_single_quote.recognize(), '\'');
    let double_quoted_string = ('"', inner_double_quote.recognize(), '"');
    let either_quoted_string = alt((single_quoted_string.recognize(), double_quoted_string.recognize()));
    let (value, range): (&str, _) = either_quoted_string.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::String, value.to_string()))
}

fn keyword(i: &mut Located<&str>) -> PResult<Token> {
    // These are the keywords themselves.
    let keyword_candidates = alt((
        "if", "else", "for", "while", "return", "break", "continue", "fn", "let", "mut", "loop", "true", "false",
        "nil", "and", "or", "not", "var", "const",
    ));
    // Look ahead. If any of these characters follow the keyword, then it's not a keyword, it's just
    // the start of a normal word.
    let keyword = terminated(
        keyword_candidates,
        peek(none_of(('a'..='z', 'A'..='Z', '-', '_', '0'..='9'))),
    );
    let (value, range) = keyword.with_span().parse_next(i)?;
    Ok(Token::from_range(range, TokenType::Keyword, value.to_owned()))
}

#[cfg(test)]
mod tests {
    use winnow::Located;

    use super::*;
    fn assert_parse_err<'i, P, O, E>(mut p: P, s: &'i str)
    where
        O: std::fmt::Debug,
        P: Parser<Located<&'i str>, O, E>,
    {
        assert!(
            p.parse_next(&mut Located::new(s)).is_err(),
            "parsed {s} but should have failed"
        );
    }

    fn assert_parse_ok<'i, P, O, E>(mut p: P, s: &'i str)
    where
        E: std::fmt::Debug,
        O: std::fmt::Debug,
        P: Parser<Located<&'i str>, O, E>,
    {
        let res = p.parse_next(&mut Located::new(s));
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

        assert_eq!(
            number.parse(Located::new("0.0000000000")).unwrap().value,
            "0.0000000000"
        );
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
        let actual = lexer(program).unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Keyword,
                value: "const".to_string(),
                start: 0,
                end: 5,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 5,
                end: 6,
            },
            Token {
                token_type: TokenType::Word,
                value: "a".to_string(),
                start: 6,
                end: 7,
            },
            Token {
                token_type: TokenType::Operator,
                value: "=".to_string(),
                start: 7,
                end: 8,
            },
            Token {
                token_type: TokenType::Number,
                value: "5".to_string(),
                start: 8,
                end: 9,
            },
        ];
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_program1() {
        let program = "54 + 22500 + 6";
        let actual = lexer(program).unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Number,
                value: "54".to_string(),
                start: 0,
                end: 2,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 2,
                end: 3,
            },
            Token {
                token_type: TokenType::Operator,
                value: "+".to_string(),
                start: 3,
                end: 4,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 4,
                end: 5,
            },
            Token {
                token_type: TokenType::Number,
                value: "22500".to_string(),
                start: 5,
                end: 10,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 10,
                end: 11,
            },
            Token {
                token_type: TokenType::Operator,
                value: "+".to_string(),
                start: 11,
                end: 12,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 12,
                end: 13,
            },
            Token {
                token_type: TokenType::Number,
                value: "6".to_string(),
                start: 13,
                end: 14,
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

        use TokenType::*;

        let expected = vec![
            Token {
                token_type: Keyword,
                start: 0,
                end: 5,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 5,
                end: 6,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 6,
                end: 13,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 13,
                end: 14,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 14,
                end: 15,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 15,
                end: 16,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 16,
                end: 29,
                value: "startSketchAt".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 29,
                end: 30,
                value: "(".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 30,
                end: 31,
                value: "[".to_owned(),
            },
            Token {
                token_type: Number,
                start: 31,
                end: 43,
                value: "0.0000000000".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 43,
                end: 44,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 44,
                end: 45,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 45,
                end: 57,
                value: "5.0000000000".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 57,
                end: 58,
                value: "]".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 58,
                end: 59,
                value: ")".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 59,
                end: 64,
                value: "\n    ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 64,
                end: 66,
                value: "|>".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 66,
                end: 67,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 67,
                end: 71,
                value: "line".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 71,
                end: 72,
                value: "(".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 72,
                end: 73,
                value: "[".to_owned(),
            },
            Token {
                token_type: Number,
                start: 73,
                end: 85,
                value: "0.4900857016".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 85,
                end: 86,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 86,
                end: 87,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 87,
                end: 88,
                value: "-".to_owned(),
            },
            Token {
                token_type: Number,
                start: 88,
                end: 100,
                value: "0.0240763666".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 100,
                end: 101,
                value: "]".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 101,
                end: 102,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 102,
                end: 103,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 103,
                end: 104,
                value: "%".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 104,
                end: 105,
                value: ")".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 105,
                end: 107,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 107,
                end: 112,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 112,
                end: 113,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 113,
                end: 120,
                value: "part002".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 120,
                end: 121,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 121,
                end: 122,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 122,
                end: 123,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 123,
                end: 132,
                value: "\"part002\"".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 132,
                end: 133,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 133,
                end: 138,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 138,
                end: 139,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 139,
                end: 145,
                value: "things".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 145,
                end: 146,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 146,
                end: 147,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 147,
                end: 148,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 148,
                end: 149,
                value: "[".to_owned(),
            },
            Token {
                token_type: Word,
                start: 149,
                end: 156,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 156,
                end: 157,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 157,
                end: 158,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 158,
                end: 161,
                value: "0.0".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 161,
                end: 162,
                value: "]".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 162,
                end: 163,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 163,
                end: 166,
                value: "let".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 166,
                end: 167,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 167,
                end: 171,
                value: "blah".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 171,
                end: 172,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 172,
                end: 173,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 173,
                end: 174,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 174,
                end: 175,
                value: "1".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 175,
                end: 176,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 176,
                end: 181,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 181,
                end: 182,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 182,
                end: 185,
                value: "foo".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 185,
                end: 186,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 186,
                end: 187,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 187,
                end: 188,
                value: " ".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 188,
                end: 193,
                value: "false".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 193,
                end: 194,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 194,
                end: 197,
                value: "let".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 197,
                end: 198,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 198,
                end: 201,
                value: "baz".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 201,
                end: 202,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 202,
                end: 203,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 203,
                end: 204,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 204,
                end: 205,
                value: "{".to_owned(),
            },
            Token {
                token_type: Word,
                start: 205,
                end: 206,
                value: "a".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 206,
                end: 207,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 207,
                end: 208,
                value: " ".to_owned(),
            },
            Token {
                token_type: Number,
                start: 208,
                end: 209,
                value: "1".to_owned(),
            },
            Token {
                token_type: Comma,
                start: 209,
                end: 210,
                value: ",".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 210,
                end: 211,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 211,
                end: 218,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 218,
                end: 219,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 219,
                end: 220,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 220,
                end: 227,
                value: "\"thing\"".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 227,
                end: 228,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 228,
                end: 230,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 230,
                end: 232,
                value: "fn".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 232,
                end: 233,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 233,
                end: 236,
                value: "ghi".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 236,
                end: 237,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 237,
                end: 238,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 238,
                end: 239,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 239,
                end: 240,
                value: "(".to_owned(),
            },
            Token {
                token_type: Word,
                start: 240,
                end: 247,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 247,
                end: 248,
                value: ")".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 248,
                end: 249,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 249,
                end: 251,
                value: "=>".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 251,
                end: 252,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 252,
                end: 253,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 253,
                end: 256,
                value: "\n  ".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 256,
                end: 262,
                value: "return".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 262,
                end: 263,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 263,
                end: 270,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 270,
                end: 271,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 271,
                end: 272,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 272,
                end: 274,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Word,
                start: 274,
                end: 278,
                value: "show".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 278,
                end: 279,
                value: "(".to_owned(),
            },
            Token {
                token_type: Word,
                start: 279,
                end: 286,
                value: "part001".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 286,
                end: 287,
                value: ")".to_owned(),
            },
        ];
        let actual = lexer(program).unwrap();
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
        let actual = lexer(program).unwrap();
        use TokenType::*;
        let expected = vec![
            Token {
                token_type: Whitespace,
                start: 0,
                end: 1,
                value: "\n".to_owned(),
            },
            Token {
                token_type: LineComment,
                start: 1,
                end: 21,
                value: "// this is a comment".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 21,
                end: 22,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 22,
                end: 27,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 27,
                end: 28,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 28,
                end: 30,
                value: "yo".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 30,
                end: 31,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 31,
                end: 32,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 32,
                end: 33,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 33,
                end: 34,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 34,
                end: 35,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 35,
                end: 36,
                value: "a".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 36,
                end: 37,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 37,
                end: 38,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 38,
                end: 39,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 39,
                end: 40,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 40,
                end: 41,
                value: "b".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 41,
                end: 42,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 42,
                end: 43,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 43,
                end: 44,
                value: "{".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 44,
                end: 45,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 45,
                end: 46,
                value: "c".to_owned(),
            },
            Token {
                token_type: Colon,
                start: 46,
                end: 47,
                value: ":".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 47,
                end: 48,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 48,
                end: 53,
                value: "'123'".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 53,
                end: 54,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 54,
                end: 55,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 55,
                end: 56,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 56,
                end: 57,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 57,
                end: 58,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 58,
                end: 59,
                value: "}".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 59,
                end: 61,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 61,
                end: 66,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 66,
                end: 67,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 67,
                end: 70,
                value: "key".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 70,
                end: 71,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 71,
                end: 72,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 72,
                end: 73,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 73,
                end: 76,
                value: "'c'".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 76,
                end: 77,
                value: "\n".to_owned(),
            },
            Token {
                token_type: Keyword,
                start: 77,
                end: 82,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 82,
                end: 83,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 83,
                end: 89,
                value: "things".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 89,
                end: 90,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 90,
                end: 91,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 91,
                end: 92,
                value: " ".to_owned(),
            },
            Token {
                token_type: String,
                start: 92,
                end: 100,
                value: "\"things\"".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 100,
                end: 102,
                value: "\n\n".to_owned(),
            },
            Token {
                token_type: LineComment,
                start: 102,
                end: 127,
                value: "// this is also a comment".to_owned(),
            },
        ];
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_program4() {
        let program = "const myArray = [0..10]";
        use TokenType::*;
        let expected = vec![
            Token {
                token_type: Keyword,
                start: 0,
                end: 5,
                value: "const".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 5,
                end: 6,
                value: " ".to_owned(),
            },
            Token {
                token_type: Word,
                start: 6,
                end: 13,
                value: "myArray".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 13,
                end: 14,
                value: " ".to_owned(),
            },
            Token {
                token_type: Operator,
                start: 14,
                end: 15,
                value: "=".to_owned(),
            },
            Token {
                token_type: Whitespace,
                start: 15,
                end: 16,
                value: " ".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 16,
                end: 17,
                value: "[".to_owned(),
            },
            Token {
                token_type: Number,
                start: 17,
                end: 18,
                value: "0".to_owned(),
            },
            Token {
                token_type: DoublePeriod,
                start: 18,
                end: 20,
                value: "..".to_owned(),
            },
            Token {
                token_type: Number,
                start: 20,
                end: 22,
                value: "10".to_owned(),
            },
            Token {
                token_type: Brace,
                start: 22,
                end: 23,
                value: "]".to_owned(),
            },
        ];
        let actual = lexer(program).unwrap();
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_kitt() {
        let program = include_str!("../../../tests/executor/inputs/kittycad_svg.kcl");
        let actual = lexer(program).unwrap();
        assert_eq!(actual.len(), 5098);
    }
    #[test]
    fn test_pipes_on_pipes() {
        let program = include_str!("../../../tests/executor/inputs/pipes_on_pipes.kcl");
        let actual = lexer(program).unwrap();
        assert_eq!(actual.len(), 17846);
    }
    #[test]
    fn test_lexer_negative_word() {
        let actual = lexer("-legX").unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Operator,
                value: "-".to_string(),
                start: 0,
                end: 1,
            },
            Token {
                token_type: TokenType::Word,
                value: "legX".to_string(),
                start: 1,
                end: 5,
            },
        ];
        assert_tokens(expected, actual);
    }

    #[test]
    fn test_unrecognized_token() {
        let actual = lexer("12 ; 8").unwrap();
        let expected = vec![
            Token {
                token_type: TokenType::Number,
                value: "12".to_string(),
                start: 0,
                end: 2,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 2,
                end: 3,
            },
            Token {
                token_type: TokenType::Unknown,
                value: ";".to_string(),
                start: 3,
                end: 4,
            },
            Token {
                token_type: TokenType::Whitespace,
                value: " ".to_string(),
                start: 4,
                end: 5,
            },
            Token {
                token_type: TokenType::Number,
                value: "8".to_string(),
                start: 5,
                end: 6,
            },
        ];

        assert_tokens(expected, actual);
    }
}
