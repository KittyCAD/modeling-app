//! Lexical keyword definitions shared by KCL source consumers.

use crate::syntax_kind::SyntaxKind;

macro_rules! define_keywords {
    ($($text:literal => $kind:ident),* $(,)?) => {
        /// Spellings classified as keyword tokens by the lexer.
        pub const KEYWORDS: &[&str] = &[$($text),*];

        /// Returns the keyword syntax kind for an exact spelling.
        pub fn keyword_kind(text: &str) -> Option<SyntaxKind> {
            match text {
                $($text => Some(SyntaxKind::$kind),)*
                _ => None,
            }
        }
    };
}

define_keywords! {
    "if" => IfKw,
    "else" => ElseKw,
    "for" => ForKw,
    "while" => WhileKw,
    "return" => ReturnKw,
    "break" => BreakKw,
    "continue" => ContinueKw,
    "fn" => FnKw,
    "let" => LetKw,
    "mut" => MutKw,
    "as" => AsKw,
    "loop" => LoopKw,
    "true" => TrueKw,
    "false" => FalseKw,
    "nil" => NilKw,
    "and" => AndKw,
    "or" => OrKw,
    "not" => NotKw,
    "var" => VarKw,
    "const" => ConstKw,
    "import" => ImportKw,
    "use" => UseKw,
    "export" => ExportKw,
    "type" => TypeKw,
    "interface" => InterfaceKw,
    "new" => NewKw,
    "self" => SelfKw,
    "record" => RecordKw,
    "struct" => StructKw,
    "object" => ObjectKw,
}
