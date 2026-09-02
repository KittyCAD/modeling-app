[
  "fn"
  "import"
  "export"
  "from"
  "as"
  "var"
] @keyword

"return" @keyword.return

[
  "if"
  "else"
] @keyword.conditional

(identifier) @variable

(type_name
  (identifier) @type)

(fn_definition
  (identifier) @function)

(fn_call
  callee: (identifier) @function)

(labeledArg
  label: (identifier) @variable.parameter)

(param
  (identifier) @variable.parameter)

(member_expr
  property: (identifier) @property)

(binary_operator) @operator
(prefix_operator) @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

"," @punctuation.delimiter

(boolean) @boolean
(string) @string
(escape_sequence) @string.escape
(number) @number
(shebang) @keyword.directive
(comment) @comment
