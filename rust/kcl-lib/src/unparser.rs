use std::fmt::Write;

use crate::{
    KclError, ModuleId,
    parsing::{
        DeprecationKind, PIPE_OPERATOR,
        ast::types::{
            Annotation, ArrayExpression, ArrayRangeExpression, AscribedExpression, Associativity, BinaryExpression,
            BinaryOperator, BinaryPart, BodyItem, CallExpressionKw, CommentStyle, DefaultParamVal, Expr, FormatOptions,
            FunctionExpression, IfExpression, ImportSelector, ImportStatement, ItemVisibility, LabeledArg, Literal,
            LiteralValue, MemberExpression, Node, NonCodeNode, NonCodeValue, ObjectExpression, Parameter,
            PipeExpression, Program, TagDeclarator, TypeDeclaration, UnaryExpression, VariableDeclaration,
            VariableKind,
        },
        deprecation,
    },
};

#[allow(dead_code)]
pub fn fmt(input: &str) -> Result<String, KclError> {
    let program = crate::parsing::parse_str(input, ModuleId::default()).parse_errs_as_err()?;
    Ok(program.recast_top(&Default::default(), 0))
}

impl Program {
    pub fn recast_top(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let mut buf = String::with_capacity(1024);
        self.recast(&mut buf, options, indentation_level);
        buf
    }

    pub fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize) {
        let indentation = options.get_indentation(indentation_level);

        if let Some(sh) = self.shebang.as_ref() {
            write!(buf, "{}\n\n", sh.inner.content).no_fail();
        }

        if self
            .non_code_meta
            .start_nodes
            .iter()
            .any(|noncode| !matches!(noncode.value, NonCodeValue::NewLine))
        {
            for start in &self.non_code_meta.start_nodes {
                let noncode_recast = start.recast(options, indentation_level);
                buf.push_str(&noncode_recast);
            }
        }
        for attr in &self.inner_attrs {
            options.write_indentation(buf, indentation_level);
            attr.recast(buf, options, indentation_level);
        }
        if !self.inner_attrs.is_empty() {
            buf.push('\n');
        }

        let body_item_lines = self.body.iter().map(|body_item| {
            let mut result = String::with_capacity(256);
            for comment in body_item.get_comments() {
                if !comment.is_empty() {
                    result.push_str(&indentation);
                    result.push_str(comment);
                }
                if comment.is_empty() && !result.ends_with("\n") {
                    result.push('\n');
                }
                if !result.ends_with("\n\n") && result != "\n" {
                    result.push('\n');
                }
            }
            for attr in body_item.get_attrs() {
                attr.recast(&mut result, options, indentation_level);
            }
            match body_item {
                BodyItem::ImportStatement(stmt) => {
                    result.push_str(&stmt.recast(options, indentation_level));
                }
                BodyItem::ExpressionStatement(expression_statement) => {
                    expression_statement
                        .expression
                        .recast(&mut result, options, indentation_level, ExprContext::Other)
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    variable_declaration.recast(&mut result, options, indentation_level);
                }
                BodyItem::TypeDeclaration(ty_declaration) => ty_declaration.recast(&mut result),
                BodyItem::ReturnStatement(return_statement) => {
                    write!(&mut result, "{indentation}return ").no_fail();
                    let mut tmp_buf = String::with_capacity(256);
                    return_statement
                        .argument
                        .recast(&mut tmp_buf, options, indentation_level, ExprContext::Other);
                    write!(&mut result, "{}", tmp_buf.trim_start()).no_fail();
                }
            };
            result
        });
        for (index, recast_str) in body_item_lines.enumerate() {
            write!(buf, "{recast_str}").no_fail();

            // determine the value of the end string
            // basically if we are inside a nested function we want to end with a new line
            let needs_line_break = !(index == self.body.len() - 1 && indentation_level == 0);

            let custom_white_space_or_comment = self.non_code_meta.non_code_nodes.get(&index).map(|noncodes| {
                noncodes.iter().enumerate().map(|(i, custom_white_space_or_comment)| {
                    let formatted = custom_white_space_or_comment.recast(options, indentation_level);
                    if i == 0 && !formatted.trim().is_empty() {
                        if let NonCodeValue::BlockComment { .. } = custom_white_space_or_comment.value {
                            format!("\n{formatted}")
                        } else {
                            formatted
                        }
                    } else {
                        formatted
                    }
                })
            });

            if let Some(custom) = custom_white_space_or_comment {
                for to_write in custom {
                    write!(buf, "{to_write}").no_fail();
                }
            } else if needs_line_break {
                buf.push('\n')
            }
        }
        trim_end(buf);

        // Insert a final new line if the user wants it.
        if options.insert_final_newline && !buf.is_empty() {
            buf.push('\n');
        }
    }
}

impl NonCodeValue {
    fn should_cause_array_newline(&self) -> bool {
        match self {
            Self::InlineComment { .. } => false,
            Self::BlockComment { .. } | Self::NewLineBlockComment { .. } | Self::NewLine => true,
        }
    }
}

impl Node<NonCodeNode> {
    fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let indentation = options.get_indentation(indentation_level);
        match &self.value {
            NonCodeValue::InlineComment {
                value,
                style: CommentStyle::Line,
            } => format!(" // {value}\n"),
            NonCodeValue::InlineComment {
                value,
                style: CommentStyle::Block,
            } => format!(" /* {value} */"),
            NonCodeValue::BlockComment { value, style } => match style {
                CommentStyle::Block => format!("{indentation}/* {value} */"),
                CommentStyle::Line => {
                    if value.trim().is_empty() {
                        format!("{indentation}//\n")
                    } else {
                        format!("{}// {}\n", indentation, value.trim())
                    }
                }
            },
            NonCodeValue::NewLineBlockComment { value, style } => {
                let add_start_new_line = if self.start == 0 { "" } else { "\n\n" };
                match style {
                    CommentStyle::Block => format!("{add_start_new_line}{indentation}/* {value} */\n"),
                    CommentStyle::Line => {
                        if value.trim().is_empty() {
                            format!("{add_start_new_line}{indentation}//\n")
                        } else {
                            format!("{}{}// {}\n", add_start_new_line, indentation, value.trim())
                        }
                    }
                }
            }
            NonCodeValue::NewLine => "\n\n".to_string(),
        }
    }
}

impl Node<Annotation> {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize) {
        let indentation = options.get_indentation(indentation_level);
        let mut result = String::new();
        for comment in &self.pre_comments {
            if !comment.is_empty() {
                result.push_str(&indentation);
                result.push_str(comment);
            }
            if !result.ends_with("\n\n") && result != "\n" {
                result.push('\n');
            }
        }
        result.push('@');
        if let Some(name) = &self.name {
            result.push_str(&name.name);
        }
        if let Some(properties) = &self.properties {
            result.push('(');
            result.push_str(
                &properties
                    .iter()
                    .map(|prop| {
                        let mut temp = format!("{} = ", prop.key.name);
                        prop.value
                            .recast(&mut temp, options, indentation_level + 1, ExprContext::Other);
                        temp.trim().to_owned()
                    })
                    .collect::<Vec<String>>()
                    .join(", "),
            );
            result.push(')');
            result.push('\n');
        }

        buf.push_str(&result)
    }
}

impl ImportStatement {
    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let indentation = options.get_indentation(indentation_level);
        let vis = if self.visibility == ItemVisibility::Export {
            "export "
        } else {
            ""
        };
        let mut string = format!("{vis}{indentation}import ");
        match &self.selector {
            ImportSelector::List { items } => {
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        string.push_str(", ");
                    }
                    string.push_str(&item.name.name);
                    if let Some(alias) = &item.alias {
                        // If the alias is the same, don't output it.
                        if item.name.name != alias.name {
                            string.push_str(&format!(" as {}", alias.name));
                        }
                    }
                }
                string.push_str(" from ");
            }
            ImportSelector::Glob(_) => string.push_str("* from "),
            ImportSelector::None { .. } => {}
        }
        string.push_str(&format!("\"{}\"", self.path));

        if let ImportSelector::None { alias: Some(alias) } = &self.selector {
            string.push_str(" as ");
            string.push_str(&alias.name);
        }
        string
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum ExprContext {
    Pipe,
    Decl,
    Other,
}

impl Expr {
    pub(crate) fn recast(
        &self,
        buf: &mut String,
        options: &FormatOptions,
        indentation_level: usize,
        mut ctxt: ExprContext,
    ) {
        let is_decl = matches!(ctxt, ExprContext::Decl);
        if is_decl {
            // Just because this expression is being bound to a variable, doesn't mean that every child
            // expression is being bound. So, reset the expression context if necessary.
            // This will still preserve the "::Pipe" context though.
            ctxt = ExprContext::Other;
        }
        match &self {
            Expr::BinaryExpression(bin_exp) => bin_exp.recast(buf, options, indentation_level, ctxt),
            Expr::ArrayExpression(array_exp) => array_exp.recast(buf, options, indentation_level, ctxt),
            Expr::ArrayRangeExpression(range_exp) => range_exp.recast(buf, options, indentation_level, ctxt),
            Expr::ObjectExpression(obj_exp) => obj_exp.recast(buf, options, indentation_level, ctxt),
            Expr::MemberExpression(mem_exp) => mem_exp.recast(buf, options, indentation_level, ctxt),
            Expr::Literal(literal) => {
                literal.recast(buf);
            }
            Expr::FunctionExpression(func_exp) => {
                if !is_decl {
                    buf.push_str("fn");
                }
                func_exp.recast(buf, options, indentation_level);
            }
            Expr::CallExpressionKw(call_exp) => call_exp.recast(buf, options, indentation_level, ctxt),
            Expr::Name(name) => {
                let result = &name.inner.name.inner.name;
                match deprecation(result, DeprecationKind::Const) {
                    Some(suggestion) => buf.push_str(suggestion),
                    None => buf.push_str(result),
                }
            }
            Expr::TagDeclarator(tag) => tag.recast(buf),
            Expr::PipeExpression(pipe_exp) => pipe_exp.recast(buf, options, indentation_level, !is_decl),
            Expr::UnaryExpression(unary_exp) => unary_exp.recast(buf, options, indentation_level, ctxt),
            Expr::IfExpression(e) => e.recast(buf, options, indentation_level, ctxt),
            Expr::PipeSubstitution(_) => buf.push_str(crate::parsing::PIPE_SUBSTITUTION_OPERATOR),
            Expr::LabelledExpression(e) => {
                e.expr.recast(buf, options, indentation_level, ctxt);
                buf.push_str(" as ");
                buf.push_str(&e.label.name);
            }
            Expr::AscribedExpression(e) => e.recast(buf, options, indentation_level, ctxt),
            Expr::None(_) => {
                unimplemented!("there is no literal None, see https://github.com/KittyCAD/modeling-app/issues/1115")
            }
        }
    }
}

impl AscribedExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        if matches!(
            self.expr,
            Expr::BinaryExpression(..) | Expr::PipeExpression(..) | Expr::UnaryExpression(..)
        ) {
            buf.push('(');
            self.expr.recast(buf, options, indentation_level, ctxt);
            buf.push(')');
        } else {
            self.expr.recast(buf, options, indentation_level, ctxt);
        }
        buf.push_str(": ");
        write!(buf, "{}", self.ty).no_fail();
    }
}

impl BinaryPart {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        match &self {
            BinaryPart::Literal(literal) => {
                literal.recast(buf);
            }
            BinaryPart::Name(name) => match deprecation(&name.inner.name.inner.name, DeprecationKind::Const) {
                Some(suggestion) => write!(buf, "{suggestion}").no_fail(),
                None => write!(buf, "{name}").no_fail(),
            },
            BinaryPart::BinaryExpression(binary_expression) => {
                binary_expression.recast(buf, options, indentation_level, ctxt)
            }
            BinaryPart::CallExpressionKw(call_expression) => {
                call_expression.recast(buf, options, indentation_level, ExprContext::Other)
            }
            BinaryPart::UnaryExpression(unary_expression) => {
                unary_expression.recast(buf, options, indentation_level, ctxt)
            }
            BinaryPart::MemberExpression(member_expression) => {
                member_expression.recast(buf, options, indentation_level, ctxt)
            }
            BinaryPart::ArrayExpression(e) => e.recast(buf, options, indentation_level, ctxt),
            BinaryPart::ArrayRangeExpression(e) => e.recast(buf, options, indentation_level, ctxt),
            BinaryPart::ObjectExpression(e) => e.recast(buf, options, indentation_level, ctxt),
            BinaryPart::IfExpression(e) => e.recast(buf, options, indentation_level, ExprContext::Other),
            BinaryPart::AscribedExpression(e) => e.recast(buf, options, indentation_level, ExprContext::Other),
        }
    }
}

impl CallExpressionKw {
    fn recast_args(&self, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) -> Vec<String> {
        let mut arg_list = if let Some(first_arg) = &self.unlabeled {
            let mut first = String::with_capacity(256);
            first_arg.recast(&mut first, options, indentation_level, ctxt);
            vec![first.trim().to_owned()]
        } else {
            Vec::with_capacity(self.arguments.len())
        };
        arg_list.extend(self.arguments.iter().map(|arg| {
            let mut buf = String::with_capacity(256);
            arg.recast(&mut buf, options, indentation_level, ctxt);
            buf
        }));
        arg_list
    }
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        let smart_indent_level = if ctxt == ExprContext::Pipe {
            0
        } else {
            indentation_level
        };
        let name = &self.callee;

        if let Some(suggestion) = deprecation(&name.inner.name.inner.name, DeprecationKind::Function) {
            options.write_indentation(buf, smart_indent_level);
            return write!(buf, "{suggestion}").no_fail();
        }

        let arg_list = self.recast_args(options, indentation_level, ctxt);
        let has_lots_of_args = arg_list.len() >= 4;
        let args = arg_list.join(", ");
        let some_arg_is_already_multiline = arg_list.len() > 1 && arg_list.iter().any(|arg| arg.contains('\n'));
        let multiline = has_lots_of_args || some_arg_is_already_multiline;
        if multiline {
            let next_indent = indentation_level + 1;
            let inner_indentation = if ctxt == ExprContext::Pipe {
                options.get_indentation_offset_pipe(next_indent)
            } else {
                options.get_indentation(next_indent)
            };
            let arg_list = self.recast_args(options, next_indent, ctxt);
            let mut args = arg_list.join(&format!(",\n{inner_indentation}"));
            args.push(',');
            let args = args;
            let end_indent = if ctxt == ExprContext::Pipe {
                options.get_indentation_offset_pipe(indentation_level)
            } else {
                options.get_indentation(indentation_level)
            };
            options.write_indentation(buf, smart_indent_level);
            write!(buf, "{name}").no_fail();
            buf.push('(');
            buf.push('\n');
            write!(buf, "{inner_indentation}").no_fail();
            write!(buf, "{args}").no_fail();
            buf.push('\n');
            write!(buf, "{end_indent}").no_fail();
            buf.push(')');
        } else {
            options.write_indentation(buf, smart_indent_level);
            write!(buf, "{name}").no_fail();
            buf.push('(');
            write!(buf, "{args}").no_fail();
            buf.push(')');
        }
    }
}

impl LabeledArg {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        if let Some(l) = &self.label {
            buf.push_str(&l.name);
            buf.push_str(" = ");
        }
        self.arg.recast(buf, options, indentation_level, ctxt);
    }
}

impl VariableDeclaration {
    pub fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize) {
        options.write_indentation(buf, indentation_level);
        match self.visibility {
            ItemVisibility::Default => {}
            ItemVisibility::Export => buf.push_str("export "),
        };

        let (keyword, eq) = match self.kind {
            VariableKind::Fn => ("fn ", ""),
            VariableKind::Const => ("", " = "),
        };
        buf.push_str(keyword);
        buf.push_str(&self.declaration.id.name);
        buf.push_str(eq);

        // Unfortunately, allocate a temporary buffer here so that we can trim the start.
        // Otherwise, some expression kinds will write indentation at the start, because
        // they don't know they're inside a declaration.
        // TODO: Pass the ExprContext throughout every Expr kind, so that they can conditionally
        // emit whitespace in an ExprStmt and not when they're in a DeclarationStmt.
        let mut tmp_buf = String::new();
        self.declaration
            .init
            .recast(&mut tmp_buf, options, indentation_level, ExprContext::Decl);
        buf.push_str(tmp_buf.trim_start());
    }
}

impl TypeDeclaration {
    pub fn recast(&self, buf: &mut String) {
        match self.visibility {
            ItemVisibility::Default => {}
            ItemVisibility::Export => buf.push_str("export "),
        };
        buf.push_str("type ");
        buf.push_str(&self.name.name);

        if let Some(args) = &self.args {
            buf.push('(');
            for (i, a) in args.iter().enumerate() {
                buf.push_str(&a.name);
                if i < args.len() - 1 {
                    buf.push_str(", ");
                }
            }
            buf.push(')');
        }
        if let Some(alias) = &self.alias {
            buf.push_str(" = ");
            write!(buf, "{alias}").no_fail();
        }
    }
}

fn write<W: std::fmt::Write>(f: &mut W, s: impl std::fmt::Display) {
    f.write_fmt(format_args!("{s}"))
        .expect("writing to a string should always succeed")
}

fn write_dbg<W: std::fmt::Write>(f: &mut W, s: impl std::fmt::Debug) {
    f.write_fmt(format_args!("{s:?}"))
        .expect("writing to a string should always succeed")
}

impl Literal {
    fn recast(&self, buf: &mut String) {
        match self.value {
            LiteralValue::Number { value, suffix } => {
                if self.raw.contains('.') && value.fract() == 0.0 {
                    write_dbg(buf, value);
                    write(buf, suffix);
                } else {
                    write(buf, &self.raw);
                }
            }
            LiteralValue::String(ref s) => {
                if let Some(suggestion) = deprecation(s, DeprecationKind::String) {
                    return write!(buf, "{suggestion}").unwrap();
                }
                let quote = if self.raw.trim().starts_with('"') { '"' } else { '\'' };
                write(buf, quote);
                write(buf, s);
                write(buf, quote);
            }
            LiteralValue::Bool(_) => {
                write(buf, &self.raw);
            }
        }
    }
}

impl TagDeclarator {
    pub fn recast(&self, buf: &mut String) {
        // TagDeclarators are always prefixed with a dollar sign.
        write!(buf, "${}", self.name).no_fail()
    }
}

impl ArrayExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        // Reconstruct the order of items in the array.
        // An item can be an element (i.e. an expression for a KCL value),
        // or a non-code item (e.g. a comment)
        let num_items = self.elements.len() + self.non_code_meta.non_code_nodes_len();
        let mut elems = self.elements.iter();
        let mut found_line_comment = false;
        let mut format_items: Vec<_> = Vec::with_capacity(num_items);
        for i in 0..num_items {
            if let Some(noncode) = self.non_code_meta.non_code_nodes.get(&i) {
                format_items.extend(noncode.iter().map(|nc| {
                    found_line_comment |= nc.value.should_cause_array_newline();
                    nc.recast(options, 0)
                }));
            } else {
                let el = elems.next().unwrap();
                let mut s = String::with_capacity(256);
                el.recast(&mut s, options, 0, ExprContext::Other);
                s.push_str(", ");
                format_items.push(s);
            }
        }

        // Format these items into a one-line array.
        if let Some(item) = format_items.last_mut() {
            if let Some(norm) = item.strip_suffix(", ") {
                *item = norm.to_owned();
            }
        }
        let mut flat_recast = String::with_capacity(256);
        flat_recast.push('[');
        for fi in &format_items {
            flat_recast.push_str(fi)
        }
        flat_recast.push(']');

        // We might keep the one-line representation, if it's short enough.
        let max_array_length = 40;
        let multi_line = flat_recast.len() > max_array_length || found_line_comment;
        if !multi_line {
            buf.push_str(&flat_recast);
            return;
        }

        // Otherwise, we format a multi-line representation.
        buf.push_str("[\n");
        let inner_indentation = if ctxt == ExprContext::Pipe {
            options.get_indentation_offset_pipe(indentation_level + 1)
        } else {
            options.get_indentation(indentation_level + 1)
        };
        for format_item in format_items {
            buf.push_str(&inner_indentation);
            buf.push_str(if let Some(x) = format_item.strip_suffix(" ") {
                x
            } else {
                &format_item
            });
            if !format_item.ends_with('\n') {
                buf.push('\n')
            }
        }
        let end_indent = if ctxt == ExprContext::Pipe {
            options.get_indentation_offset_pipe(indentation_level)
        } else {
            options.get_indentation(indentation_level)
        };
        buf.push_str(&end_indent);
        buf.push(']');
    }
}

/// An expression is syntactically trivial: i.e., a literal, identifier, or similar.
fn expr_is_trivial(expr: &Expr) -> bool {
    matches!(
        expr,
        Expr::Literal(_) | Expr::Name(_) | Expr::TagDeclarator(_) | Expr::PipeSubstitution(_) | Expr::None(_)
    )
}

trait CannotActuallyFail {
    fn no_fail(self);
}

impl CannotActuallyFail for std::fmt::Result {
    fn no_fail(self) {
        self.expect("writing to a string cannot fail, there's no IO happening")
    }
}

impl ArrayRangeExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, _: usize, _: ExprContext) {
        buf.push('[');
        self.start_element.recast(buf, options, 0, ExprContext::Other);

        let range_op = if self.end_inclusive { ".." } else { "..<" };
        // Format these items into a one-line array. Put spaces around the `..` if either expression
        // is non-trivial. This is a bit arbitrary but people seem to like simple ranges to be formatted
        // tightly, but this is a misleading visual representation of the precedence if the range
        // components are compound expressions.
        let no_spaces = expr_is_trivial(&self.start_element) && expr_is_trivial(&self.end_element);
        if no_spaces {
            write!(buf, "{range_op}").no_fail()
        } else {
            write!(buf, " {range_op} ").no_fail()
        }
        self.end_element.recast(buf, options, 0, ExprContext::Other);
        buf.push(']');
        // Assume a range expression fits on one line.
    }
}

fn trim_end(buf: &mut String) {
    buf.truncate(buf.trim_end().len())
}

impl ObjectExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        if self
            .non_code_meta
            .non_code_nodes
            .values()
            .any(|nc| nc.iter().any(|nc| nc.value.should_cause_array_newline()))
        {
            return self.recast_multi_line(buf, options, indentation_level, ctxt);
        }
        let mut flat_recast_buf = String::new();
        flat_recast_buf.push_str("{ ");
        for (i, prop) in self.properties.iter().enumerate() {
            let obj_key = &prop.key.name;
            write!(flat_recast_buf, "{obj_key} = ").no_fail();
            prop.value
                .recast(&mut flat_recast_buf, options, indentation_level, ctxt);
            if i < self.properties.len() - 1 {
                flat_recast_buf.push_str(", ");
            }
        }
        flat_recast_buf.push_str(" }");
        let max_array_length = 40;
        let needs_multiple_lines = flat_recast_buf.len() > max_array_length;
        if !needs_multiple_lines {
            buf.push_str(&flat_recast_buf);
        } else {
            self.recast_multi_line(buf, options, indentation_level, ctxt);
        }
    }

    /// Recast, but always outputs the object with newlines between each property.
    fn recast_multi_line(
        &self,
        buf: &mut String,
        options: &FormatOptions,
        indentation_level: usize,
        ctxt: ExprContext,
    ) {
        let inner_indentation = if ctxt == ExprContext::Pipe {
            options.get_indentation_offset_pipe(indentation_level + 1)
        } else {
            options.get_indentation(indentation_level + 1)
        };
        let num_items = self.properties.len() + self.non_code_meta.non_code_nodes_len();
        let mut props = self.properties.iter();
        let format_items: Vec<_> = (0..num_items)
            .flat_map(|i| {
                if let Some(noncode) = self.non_code_meta.non_code_nodes.get(&i) {
                    noncode.iter().map(|nc| nc.recast(options, 0)).collect::<Vec<_>>()
                } else {
                    let prop = props.next().unwrap();
                    // Use a comma unless it's the last item
                    let comma = if i == num_items - 1 { "" } else { ",\n" };
                    let mut s = String::new();
                    prop.value.recast(&mut s, options, indentation_level + 1, ctxt);
                    // TODO: Get rid of this vector allocation
                    vec![format!("{} = {}{comma}", prop.key.name, s.trim())]
                }
            })
            .collect();
        let end_indent = if ctxt == ExprContext::Pipe {
            options.get_indentation_offset_pipe(indentation_level)
        } else {
            options.get_indentation(indentation_level)
        };
        write!(
            buf,
            "{{\n{inner_indentation}{}\n{end_indent}}}",
            format_items.join(&inner_indentation),
        )
        .no_fail();
    }
}

impl MemberExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        // The object
        self.object.recast(buf, options, indentation_level, ctxt);
        // The key
        if self.computed {
            buf.push('[');
            self.property.recast(buf, options, indentation_level, ctxt);
            buf.push(']');
        } else {
            buf.push('.');
            self.property.recast(buf, options, indentation_level, ctxt);
        };
    }
}

impl BinaryExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, _indentation_level: usize, ctxt: ExprContext) {
        let maybe_wrap_it = |a: String, doit: bool| -> String { if doit { format!("({a})") } else { a } };

        // It would be better to always preserve the user's parentheses but since we've dropped that
        // info from the AST, we bracket expressions as necessary.
        let should_wrap_left = match &self.left {
            BinaryPart::BinaryExpression(bin_exp) => {
                self.precedence() > bin_exp.precedence()
                    || ((self.precedence() == bin_exp.precedence())
                        && (!(self.operator.associative() && self.operator == bin_exp.operator)
                            && self.operator.associativity() == Associativity::Right))
            }
            _ => false,
        };

        let should_wrap_right = match &self.right {
            BinaryPart::BinaryExpression(bin_exp) => {
                self.precedence() > bin_exp.precedence()
                    // These two lines preserve previous reformatting behaviour.
                    || self.operator == BinaryOperator::Sub
                    || self.operator == BinaryOperator::Div
                    || ((self.precedence() == bin_exp.precedence())
                        && (!(self.operator.associative() && self.operator == bin_exp.operator)
                            && self.operator.associativity() == Associativity::Left))
            }
            _ => false,
        };

        let mut left = String::new();
        self.left.recast(&mut left, options, 0, ctxt);
        let mut right = String::new();
        self.right.recast(&mut right, options, 0, ctxt);
        write!(
            buf,
            "{} {} {}",
            maybe_wrap_it(left, should_wrap_left),
            self.operator,
            maybe_wrap_it(right, should_wrap_right)
        )
        .no_fail();
    }
}

impl UnaryExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, _indentation_level: usize, ctxt: ExprContext) {
        match self.argument {
            BinaryPart::Literal(_)
            | BinaryPart::Name(_)
            | BinaryPart::MemberExpression(_)
            | BinaryPart::ArrayExpression(_)
            | BinaryPart::ArrayRangeExpression(_)
            | BinaryPart::ObjectExpression(_)
            | BinaryPart::IfExpression(_)
            | BinaryPart::AscribedExpression(_)
            | BinaryPart::CallExpressionKw(_) => {
                write!(buf, "{}", self.operator).no_fail();
                self.argument.recast(buf, options, 0, ctxt)
            }
            BinaryPart::BinaryExpression(_) | BinaryPart::UnaryExpression(_) => {
                write!(buf, "{}", self.operator).no_fail();
                buf.push('(');
                self.argument.recast(buf, options, 0, ctxt);
                buf.push(')');
            }
        }
    }
}

impl IfExpression {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, ctxt: ExprContext) {
        // We can calculate how many lines this will take, so let's do it and avoid growing the vec.
        // Total lines = starting lines, else-if lines, ending lines.
        let n = 2 + (self.else_ifs.len() * 2) + 3;
        let mut lines = Vec::with_capacity(n);

        let cond = {
            let mut tmp_buf = String::new();
            self.cond.recast(&mut tmp_buf, options, indentation_level, ctxt);
            tmp_buf
        };
        lines.push((0, format!("if {cond} {{")));
        lines.push((1, {
            let mut tmp_buf = String::new();
            self.then_val.recast(&mut tmp_buf, options, indentation_level + 1);
            tmp_buf
        }));
        for else_if in &self.else_ifs {
            let cond = {
                let mut tmp_buf = String::new();
                else_if.cond.recast(&mut tmp_buf, options, indentation_level, ctxt);
                tmp_buf
            };
            lines.push((0, format!("}} else if {cond} {{")));
            lines.push((1, {
                let mut tmp_buf = String::new();
                else_if.then_val.recast(&mut tmp_buf, options, indentation_level + 1);
                tmp_buf
            }));
        }
        lines.push((0, "} else {".to_owned()));
        lines.push((1, {
            let mut tmp_buf = String::new();
            self.final_else.recast(&mut tmp_buf, options, indentation_level + 1);
            tmp_buf
        }));
        lines.push((0, "}".to_owned()));
        let out = lines
            .into_iter()
            .map(|(ind, line)| format!("{}{}", options.get_indentation(indentation_level + ind), line.trim()))
            .collect::<Vec<_>>()
            .join("\n");
        buf.push_str(&out);
    }
}

impl Node<PipeExpression> {
    fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize, preceding_indent: bool) {
        if preceding_indent {
            options.write_indentation(buf, indentation_level);
        }
        for (index, statement) in self.body.iter().enumerate() {
            statement.recast(buf, options, indentation_level + 1, ExprContext::Pipe);
            let non_code_meta = &self.non_code_meta;
            if let Some(non_code_meta_value) = non_code_meta.non_code_nodes.get(&index) {
                for val in non_code_meta_value {
                    // TODO: Remove allocation here by switching val.recast to accept buf.
                    let formatted = if val.end == self.end {
                        val.recast(options, indentation_level)
                            .trim_end_matches('\n')
                            .to_string()
                    } else {
                        val.recast(options, indentation_level + 1)
                            .trim_end_matches('\n')
                            .to_string()
                    };
                    if let NonCodeValue::BlockComment { .. } = val.value {
                        buf.push('\n');
                    }
                    buf.push_str(&formatted);
                }
            }

            if index != self.body.len() - 1 {
                buf.push('\n');
                options.write_indentation(buf, indentation_level + 1);
                buf.push_str(PIPE_OPERATOR);
                buf.push(' ');
            }
        }
    }
}

impl FunctionExpression {
    pub fn recast(&self, buf: &mut String, options: &FormatOptions, indentation_level: usize) {
        // We don't want to end with a new line inside nested functions.
        let mut new_options = options.clone();
        new_options.insert_final_newline = false;

        buf.push('(');
        for (i, param) in self.params.iter().enumerate() {
            param.recast(buf, options, indentation_level);
            if i < self.params.len() - 1 {
                buf.push_str(", ");
            }
        }
        buf.push(')');
        if let Some(return_type) = &self.return_type {
            write!(buf, ": {return_type}").no_fail();
        }
        writeln!(buf, " {{").no_fail();
        self.body.recast(buf, &new_options, indentation_level + 1);
        buf.push('\n');
        options.write_indentation(buf, indentation_level);
        buf.push('}');
    }
}

impl Parameter {
    pub fn recast(&self, buf: &mut String, _options: &FormatOptions, _indentation_level: usize) {
        if !self.labeled {
            buf.push('@');
        }
        buf.push_str(&self.identifier.name);
        if self.default_value.is_some() {
            buf.push('?');
        };
        if let Some(ty) = &self.type_ {
            buf.push_str(": ");
            write!(buf, "{ty}").no_fail();
        }
        if let Some(DefaultParamVal::Literal(ref literal)) = self.default_value {
            buf.push_str(" = ");
            literal.recast(buf);
        };
    }
}

/// Collect all the kcl (and other relevant) files in a directory, recursively.
#[cfg(not(target_arch = "wasm32"))]
#[async_recursion::async_recursion]
pub async fn walk_dir(dir: &std::path::PathBuf) -> Result<Vec<std::path::PathBuf>, anyhow::Error> {
    // Make sure we actually have a directory.
    if !dir.is_dir() {
        anyhow::bail!("`{}` is not a directory", dir.display());
    }

    let mut entries = tokio::fs::read_dir(dir).await?;

    let mut files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();

        if path.is_dir() {
            files.extend(walk_dir(&path).await?);
        } else if path
            .extension()
            .is_some_and(|ext| crate::RELEVANT_FILE_EXTENSIONS.contains(&ext.to_string_lossy().to_string()))
        {
            files.push(path);
        }
    }

    Ok(files)
}

/// Recast all the kcl files in a directory, recursively.
#[cfg(not(target_arch = "wasm32"))]
pub async fn recast_dir(dir: &std::path::Path, options: &crate::FormatOptions) -> Result<(), anyhow::Error> {
    let files = walk_dir(&dir.to_path_buf()).await.map_err(|err| {
        crate::KclError::new_internal(crate::errors::KclErrorDetails::new(
            format!("Failed to walk directory `{}`: {:?}", dir.display(), err),
            vec![crate::SourceRange::default()],
        ))
    })?;

    let futures = files
        .into_iter()
        .filter(|file| file.extension().is_some_and(|ext| ext == "kcl")) // We only care about kcl
        // files here.
        .map(|file| {
            let options = options.clone();
            tokio::spawn(async move {
                let contents = tokio::fs::read_to_string(&file)
                    .await
                    .map_err(|err| anyhow::anyhow!("Failed to read file `{}`: {:?}", file.display(), err))?;
                let (program, ces) = crate::Program::parse(&contents).map_err(|err| {
                    let report = crate::Report {
                        kcl_source: contents.to_string(),
                        error: err.clone(),
                        filename: file.to_string_lossy().to_string(),
                    };
                    let report = miette::Report::new(report);
                    anyhow::anyhow!("{:?}", report)
                })?;
                for ce in &ces {
                    if ce.severity != crate::errors::Severity::Warning {
                        let report = crate::Report {
                            kcl_source: contents.to_string(),
                            error: crate::KclError::new_semantic(ce.clone().into()),
                            filename: file.to_string_lossy().to_string(),
                        };
                        let report = miette::Report::new(report);
                        anyhow::bail!("{:?}", report);
                    }
                }
                let Some(program) = program else {
                    anyhow::bail!("Failed to parse file `{}`", file.display());
                };
                let recast = program.recast_with_options(&options);
                tokio::fs::write(&file, recast)
                    .await
                    .map_err(|err| anyhow::anyhow!("Failed to write file `{}`: {:?}", file.display(), err))?;

                Ok::<(), anyhow::Error>(())
            })
        })
        .collect::<Vec<_>>();

    // Join all futures and await their completion
    let results = futures::future::join_all(futures).await;

    // Check if any of the futures failed.
    let mut errors = Vec::new();
    for result in results {
        if let Err(err) = result? {
            errors.push(err);
        }
    }

    if !errors.is_empty() {
        anyhow::bail!("Failed to recast some files: {:?}", errors);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::{ModuleId, parsing::ast::types::FormatOptions};

    #[test]
    fn test_recast_annotations_without_body_items() {
        let input = r#"@settings(defaultLengthUnit = in)
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_annotations_in_function_body() {
        let input = r#"fn myFunc() {
  @meta(yes = true)

  x = 2
}
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_annotations_in_function_body_without_items() {
        let input = "\
fn myFunc() {
  @meta(yes = true)
}
";
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn recast_annotations_with_comments() {
        let input = r#"// Start comment

// Comment on attr
@settings(defaultLengthUnit = in)

// Comment on item
foo = 42

// Comment on another item
@(impl = kcl)
bar = 0
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn recast_annotations_with_block_comment() {
        let input = r#"/* Start comment

sdfsdfsdfs */
@settings(defaultLengthUnit = in)

foo = 42
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_if_else_if_same() {
        let input = r#"b = if false {
  3
} else if true {
  4
} else {
  5
}
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_if_same() {
        let input = r#"b = if false {
  3
} else {
  5
}
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_import() {
        let input = r#"import a from "a.kcl"
import a as aaa from "a.kcl"
import a, b from "a.kcl"
import a as aaa, b from "a.kcl"
import a, b as bbb from "a.kcl"
import a as aaa, b as bbb from "a.kcl"
import "a_b.kcl"
import "a-b.kcl" as b
import * from "a.kcl"
export import a as aaa from "a.kcl"
export import a, b from "a.kcl"
export import a as aaa, b from "a.kcl"
export import a, b as bbb from "a.kcl"
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_import_as_same_name() {
        let input = r#"import a as a from "a.kcl"
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        let expected = r#"import a from "a.kcl"
"#;
        assert_eq!(output, expected);
    }

    #[test]
    fn test_recast_export_fn() {
        let input = r#"export fn a() {
  return 0
}
"#;
        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_bug_fn_in_fn() {
        let some_program_string = r#"// Start point (top left)
zoo_x = -20
zoo_y = 7
// Scale
s = 1 // s = 1 -> height of Z is 13.4mm
// Depth
d = 1

fn rect(x, y, w, h) {
  startSketchOn(XY)
    |> startProfile(at = [x, y])
    |> xLine(length = w)
    |> yLine(length = h)
    |> xLine(length = -w)
    |> close()
    |> extrude(d)
}

fn quad(x1, y1, x2, y2, x3, y3, x4, y4) {
  startSketchOn(XY)
    |> startProfile(at = [x1, y1])
    |> line(endAbsolute = [x2, y2])
    |> line(endAbsolute = [x3, y3])
    |> line(endAbsolute = [x4, y4])
    |> close()
    |> extrude(d)
}

fn crosshair(x, y) {
  startSketchOn(XY)
    |> startProfile(at = [x, y])
    |> yLine(length = 1)
    |> yLine(length = -2)
    |> yLine(length = 1)
    |> xLine(length = 1)
    |> xLine(length = -2)
}

fn z(z_x, z_y) {
  z_end_w = s * 8.4
  z_end_h = s * 3
  z_corner = s * 2
  z_w = z_end_w + 2 * z_corner
  z_h = z_w * 1.08130081300813
  rect(
    z_x,
    a = z_y,
    b = z_end_w,
    c = -z_end_h,
  )
  rect(
    z_x + z_w,
    a = z_y,
    b = -z_corner,
    c = -z_corner,
  )
  rect(
    z_x + z_w,
    a = z_y - z_h,
    b = -z_end_w,
    c = z_end_h,
  )
  rect(
    z_x,
    a = z_y - z_h,
    b = z_corner,
    c = z_corner,
  )
}

fn o(c_x, c_y) {
  // Outer and inner radii
  o_r = s * 6.95
  i_r = 0.5652173913043478 * o_r

  // Angle offset for diagonal break
  a = 7

  // Start point for the top sketch
  o_x1 = c_x + o_r * cos((45 + a) / 360 * TAU)
  o_y1 = c_y + o_r * sin((45 + a) / 360 * TAU)

  // Start point for the bottom sketch
  o_x2 = c_x + o_r * cos((225 + a) / 360 * TAU)
  o_y2 = c_y + o_r * sin((225 + a) / 360 * TAU)

  // End point for the bottom startSketch
  o_x3 = c_x + o_r * cos((45 - a) / 360 * TAU)
  o_y3 = c_y + o_r * sin((45 - a) / 360 * TAU)

  // Where is the center?
  // crosshair(c_x, c_y)


  startSketchOn(XY)
    |> startProfile(at = [o_x1, o_y1])
    |> arc(radius = o_r, angle_start = 45 + a, angle_end = 225 - a)
    |> angledLine(angle = 45, length = o_r - i_r)
    |> arc(radius = i_r, angle_start = 225 - a, angle_end = 45 + a)
    |> close()
    |> extrude(d)

  startSketchOn(XY)
    |> startProfile(at = [o_x2, o_y2])
    |> arc(radius = o_r, angle_start = 225 + a, angle_end = 360 + 45 - a)
    |> angledLine(angle = 225, length = o_r - i_r)
    |> arc(radius = i_r, angle_start = 45 - a, angle_end = 225 + a - 360)
    |> close()
    |> extrude(d)
}

fn zoo(x0, y0) {
  z(x = x0, y = y0)
  o(x = x0 + s * 20, y = y0 - (s * 6.7))
  o(x = x0 + s * 35, y = y0 - (s * 6.7))
}

zoo(x = zoo_x, y = zoo_y)
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_nested_fns_indent() {
        let some_program_string = "\
x = 1
fn rect(x, y, w, h) {
  y = 2
  z = 3
  startSketchOn(XY)
    |> startProfile(at = [x, y])
    |> xLine(length = w)
    |> yLine(length = h)
    |> xLine(length = -w)
    |> close()
    |> extrude(d)
}
";
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_bug_extra_parens() {
        let some_program_string = r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads. 

// Define constants like ball diameter, inside diameter, overhange length, and thickness
sphereDia = 0.5
insideDia = 1
thickness = 0.25
overHangLength = .4

// Sketch and revolve the inside bearing piece
insideRevolve = startSketchOn(XZ)
  |> startProfile(at = [insideDia / 2, 0])
  |> line(end = [0, thickness + sphereDia / 2])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, -sphereDia])
  |> line(end = [overHangLength - thickness, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength, 0])
  |> close()
  |> revolve(axis = Y)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
sphere = startSketchOn(XZ)
  |> startProfile(at = [
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ])
  |> line(end = [sphereDia - 0.1, 0])
  |> arc(
       angle_start = 0,
       angle_end = -180,
       radius = sphereDia / 2 - 0.05
     )
  |> close()
  |> revolve(axis = X)
  |> patternCircular3d(
       axis = [0, 0, 1],
       center = [0, 0, 0],
       repetitions = 10,
       arcDegrees = 360,
       rotateDuplicates = true
     )

// Sketch and revolve the outside bearing
outsideRevolve = startSketchOn(XZ)
  |> startProfile(at = [
       insideDia / 2 + thickness + sphereDia,
       0
       ]
     )
  |> line(end = [0, sphereDia / 2])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -2 * thickness - sphereDia])
  |> line(end = [-overHangLength, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength - thickness, 0])
  |> close()
  |> revolve(axis = Y)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads.

// Define constants like ball diameter, inside diameter, overhange length, and thickness
sphereDia = 0.5
insideDia = 1
thickness = 0.25
overHangLength = .4

// Sketch and revolve the inside bearing piece
insideRevolve = startSketchOn(XZ)
  |> startProfile(at = [insideDia / 2, 0])
  |> line(end = [0, thickness + sphereDia / 2])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, -sphereDia])
  |> line(end = [overHangLength - thickness, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength, 0])
  |> close()
  |> revolve(axis = Y)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
sphere = startSketchOn(XZ)
  |> startProfile(at = [
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ])
  |> line(end = [sphereDia - 0.1, 0])
  |> arc(angle_start = 0, angle_end = -180, radius = sphereDia / 2 - 0.05)
  |> close()
  |> revolve(axis = X)
  |> patternCircular3d(
       axis = [0, 0, 1],
       center = [0, 0, 0],
       repetitions = 10,
       arcDegrees = 360,
       rotateDuplicates = true,
     )

// Sketch and revolve the outside bearing
outsideRevolve = startSketchOn(XZ)
  |> startProfile(at = [
       insideDia / 2 + thickness + sphereDia,
       0
     ])
  |> line(end = [0, sphereDia / 2])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -2 * thickness - sphereDia])
  |> line(end = [-overHangLength, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength - thickness, 0])
  |> close()
  |> revolve(axis = Y)
"#
        );
    }

    #[test]
    fn test_recast_fn_in_object() {
        let some_program_string = r#"bing = { yo = 55 }
myNestedVar = [{ prop = callExp(bing.yo) }]
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_fn_in_array() {
        let some_program_string = r#"bing = { yo = 55 }
myNestedVar = [callExp(bing.yo)]
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_ranges() {
        let some_program_string = r#"foo = [0..10]
ten = 10
bar = [0 + 1 .. ten]
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_space_in_fn_call() {
        let some_program_string = r#"fn thing (x) {
    return x + 1
}

thing ( 1 )
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn thing(x) {
  return x + 1
}

thing(1)
"#
        );
    }

    #[test]
    fn test_recast_typed_fn() {
        let some_program_string = r#"fn thing(x: string, y: [bool]): number {
  return x + 1
}
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_typed_consts() {
        let some_program_string = r#"a = 42: number
export b = 3.2: number(ft)
c = "dsfds": A | B | C
d = [1]: [number]
e = foo: [number; 3]
f = [1, 2, 3]: [number; 1+]
f = [1, 2, 3]: [number; 3+]
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_object_fn_in_array_weird_bracket() {
        let some_program_string = r#"bing = { yo = 55 }
myNestedVar = [
  {
  prop:   line(a = [bing.yo, 21], b = sketch001)
}
]
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"bing = { yo = 55 }
myNestedVar = [
  {
  prop = line(a = [bing.yo, 21], b = sketch001)
}
]
"#
        );
    }

    #[test]
    fn test_recast_empty_file() {
        let some_program_string = r#""#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(recasted, r#""#);
    }

    #[test]
    fn test_recast_empty_file_new_line() {
        let some_program_string = r#"
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(recasted, r#""#);
    }

    #[test]
    fn test_recast_shebang() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
"#;

        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
"#
        );
    }

    #[test]
    fn test_recast_shebang_new_lines() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
        


part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
"#;

        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
"#
        );
    }

    #[test]
    fn test_recast_shebang_with_comments() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
        
// Yo yo my comments.
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
"#;

        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

// Yo yo my comments.
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
"#
        );
    }

    #[test]
    fn test_recast_empty_function_body_with_comments() {
        let input = r#"fn myFunc() {
  // Yo yo my comments.
}
"#;

        let program = crate::parsing::top_level_parse(input).unwrap();
        let output = program.recast_top(&Default::default(), 0);
        assert_eq!(output, input);
    }

    #[test]
    fn test_recast_large_file() {
        let some_program_string = r#"@settings(units=mm)
// define nts
radius = 6.0
width = 144.0
length = 83.0
depth = 45.0
thk = 5
hole_diam = 5
// define a rectangular shape func
fn rectShape(pos, w, l) {
  rr = startSketchOn(XY)
    |> startProfile(at = [pos[0] - (w / 2), pos[1] - (l / 2)])
    |> line(endAbsolute = [pos[0] + w / 2, pos[1] - (l / 2)], tag = $edge1)
    |> line(endAbsolute = [pos[0] + w / 2, pos[1] + l / 2], tag = $edge2)
    |> line(endAbsolute = [pos[0] - (w / 2), pos[1] + l / 2], tag = $edge3)
    |> close($edge4)
  return rr
}
// build the body of the focusrite scarlett solo gen 4
// only used for visualization
scarlett_body = rectShape(pos = [0, 0], w = width, l = length)
  |> extrude(depth)
  |> fillet(
       radius = radius,
       tags = [
  edge2,
  edge4,
  getOppositeEdge(edge2),
  getOppositeEdge(edge4)
]
   )
  // build the bracket sketch around the body
fn bracketSketch(w, d, t) {
  s = startSketchOn({
         plane = {
  origin = { x = 0, y = length / 2 + thk, z = 0 },
  x_axis = { x = 1, y = 0, z = 0 },
  y_axis = { x = 0, y = 0, z = 1 },
  z_axis = { x = 0, y = 1, z = 0 }
}
       })
    |> startProfile(at = [-w / 2 - t, d + t])
    |> line(endAbsolute = [-w / 2 - t, -t], tag = $edge1)
    |> line(endAbsolute = [w / 2 + t, -t], tag = $edge2)
    |> line(endAbsolute = [w / 2 + t, d + t], tag = $edge3)
    |> line(endAbsolute = [w / 2, d + t], tag = $edge4)
    |> line(endAbsolute = [w / 2, 0], tag = $edge5)
    |> line(endAbsolute = [-w / 2, 0], tag = $edge6)
    |> line(endAbsolute = [-w / 2, d + t], tag = $edge7)
    |> close($edge8)
  return s
}
// build the body of the bracket
bracket_body = bracketSketch(w = width, d = depth, t = thk)
  |> extrude(length + 10)
  |> fillet(
       radius = radius,
       tags = [
  getNextAdjacentEdge(edge7),
  getNextAdjacentEdge(edge2),
  getNextAdjacentEdge(edge3),
  getNextAdjacentEdge(edge6)
]
     )
  // build the tabs of the mounting bracket (right side)
tabs_r = startSketchOn({
       plane = {
  origin = { x = 0, y = 0, z = depth + thk },
  x_axis = { x = 1, y = 0, z = 0 },
  y_axis = { x = 0, y = 1, z = 0 },
  z_axis = { x = 0, y = 0, z = 1 }
}
     })
  |> startProfile(at = [width / 2 + thk, length / 2 + thk])
  |> line(end = [10, -5])
  |> line(end = [0, -10])
  |> line(end = [-10, -5])
  |> close()
  |> subtract2d(tool = circle(
       center = [
         width / 2 + thk + hole_diam,
         length / 2 - hole_diam
       ],
       radius = hole_diam / 2
     ))
  |> extrude(-thk)
  |> patternLinear3d(
       axis = [0, -1, 0],
       repetitions = 1,
       distance = length - 10
     )
  // build the tabs of the mounting bracket (left side)
tabs_l = startSketchOn({
       plane = {
  origin = { x = 0, y = 0, z = depth + thk },
  x_axis = { x = 1, y = 0, z = 0 },
  y_axis = { x = 0, y = 1, z = 0 },
  z_axis = { x = 0, y = 0, z = 1 }
}
     })
  |> startProfile(at = [-width / 2 - thk, length / 2 + thk])
  |> line(end = [-10, -5])
  |> line(end = [0, -10])
  |> line(end = [10, -5])
  |> close()
  |> subtract2d(tool = circle(
       center = [
         -width / 2 - thk - hole_diam,
         length / 2 - hole_diam
       ],
       radius = hole_diam / 2
     ))
  |> extrude(-thk)
  |> patternLinear3d(axis = [0, -1, 0], repetitions = 1, distance = length - 10ft)
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(
            recasted,
            r#"@settings(units = mm)

// define nts
radius = 6.0
width = 144.0
length = 83.0
depth = 45.0
thk = 5
hole_diam = 5
// define a rectangular shape func
fn rectShape(pos, w, l) {
  rr = startSketchOn(XY)
    |> startProfile(at = [pos[0] - (w / 2), pos[1] - (l / 2)])
    |> line(endAbsolute = [pos[0] + w / 2, pos[1] - (l / 2)], tag = $edge1)
    |> line(endAbsolute = [pos[0] + w / 2, pos[1] + l / 2], tag = $edge2)
    |> line(endAbsolute = [pos[0] - (w / 2), pos[1] + l / 2], tag = $edge3)
    |> close($edge4)
  return rr
}
// build the body of the focusrite scarlett solo gen 4
// only used for visualization
scarlett_body = rectShape(pos = [0, 0], w = width, l = length)
  |> extrude(depth)
  |> fillet(
       radius = radius,
       tags = [
         edge2,
         edge4,
         getOppositeEdge(edge2),
         getOppositeEdge(edge4)
       ],
     )
// build the bracket sketch around the body
fn bracketSketch(w, d, t) {
  s = startSketchOn({
         plane = {
           origin = { x = 0, y = length / 2 + thk, z = 0 },
           x_axis = { x = 1, y = 0, z = 0 },
           y_axis = { x = 0, y = 0, z = 1 },
           z_axis = { x = 0, y = 1, z = 0 }
         }
       })
    |> startProfile(at = [-w / 2 - t, d + t])
    |> line(endAbsolute = [-w / 2 - t, -t], tag = $edge1)
    |> line(endAbsolute = [w / 2 + t, -t], tag = $edge2)
    |> line(endAbsolute = [w / 2 + t, d + t], tag = $edge3)
    |> line(endAbsolute = [w / 2, d + t], tag = $edge4)
    |> line(endAbsolute = [w / 2, 0], tag = $edge5)
    |> line(endAbsolute = [-w / 2, 0], tag = $edge6)
    |> line(endAbsolute = [-w / 2, d + t], tag = $edge7)
    |> close($edge8)
  return s
}
// build the body of the bracket
bracket_body = bracketSketch(w = width, d = depth, t = thk)
  |> extrude(length + 10)
  |> fillet(
       radius = radius,
       tags = [
         getNextAdjacentEdge(edge7),
         getNextAdjacentEdge(edge2),
         getNextAdjacentEdge(edge3),
         getNextAdjacentEdge(edge6)
       ],
     )
// build the tabs of the mounting bracket (right side)
tabs_r = startSketchOn({
       plane = {
         origin = { x = 0, y = 0, z = depth + thk },
         x_axis = { x = 1, y = 0, z = 0 },
         y_axis = { x = 0, y = 1, z = 0 },
         z_axis = { x = 0, y = 0, z = 1 }
       }
     })
  |> startProfile(at = [width / 2 + thk, length / 2 + thk])
  |> line(end = [10, -5])
  |> line(end = [0, -10])
  |> line(end = [-10, -5])
  |> close()
  |> subtract2d(tool = circle(
       center = [
         width / 2 + thk + hole_diam,
         length / 2 - hole_diam
       ],
       radius = hole_diam / 2,
     ))
  |> extrude(-thk)
  |> patternLinear3d(axis = [0, -1, 0], repetitions = 1, distance = length - 10)
// build the tabs of the mounting bracket (left side)
tabs_l = startSketchOn({
       plane = {
         origin = { x = 0, y = 0, z = depth + thk },
         x_axis = { x = 1, y = 0, z = 0 },
         y_axis = { x = 0, y = 1, z = 0 },
         z_axis = { x = 0, y = 0, z = 1 }
       }
     })
  |> startProfile(at = [-width / 2 - thk, length / 2 + thk])
  |> line(end = [-10, -5])
  |> line(end = [0, -10])
  |> line(end = [10, -5])
  |> close()
  |> subtract2d(tool = circle(
       center = [
         -width / 2 - thk - hole_diam,
         length / 2 - hole_diam
       ],
       radius = hole_diam / 2,
     ))
  |> extrude(-thk)
  |> patternLinear3d(axis = [0, -1, 0], repetitions = 1, distance = length - 10ft)
"#
        );
    }

    #[test]
    fn test_recast_nested_var_declaration_in_fn_body() {
        let some_program_string = r#"fn cube(pos, scale) {
   sg = startSketchOn(XY)
  |> startProfile(at = pos)
  |> line(end = [0, scale])
  |> line(end = [scale, 0])
  |> line(end = [0, -scale])
  |> close()
  |> extrude(scale)
}"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(scale)
}
"#
        );
    }

    #[test]
    fn test_as() {
        let some_program_string = r#"fn cube(pos, scale) {
  x = dfsfs + dfsfsd as y

  sg = startSketchOn(XY)
    |> startProfile(at = pos) as foo
    |> line([0, scale])
    |> line([scale, 0]) as bar
    |> line([0 as baz, -scale] as qux)
    |> close()
    |> extrude(length = scale)
}

cube(pos = 0, scale = 0) as cub
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string,);
    }

    #[test]
    fn test_recast_with_bad_indentation() {
        let some_program_string = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0, 5.0])
              |> line(end = [0.4900857016, -0.0240763666])
    |> line(end = [0.6804562304, 0.9087880491])"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0, 5.0])
  |> line(end = [0.4900857016, -0.0240763666])
  |> line(end = [0.6804562304, 0.9087880491])
"#
        );
    }

    #[test]
    fn test_recast_with_bad_indentation_and_inline_comment() {
        let some_program_string = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0, 5.0])
              |> line(end = [0.4900857016, -0.0240763666]) // hello world
    |> line(end = [0.6804562304, 0.9087880491])"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0, 5.0])
  |> line(end = [0.4900857016, -0.0240763666]) // hello world
  |> line(end = [0.6804562304, 0.9087880491])
"#
        );
    }
    #[test]
    fn test_recast_with_bad_indentation_and_line_comment() {
        let some_program_string = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0, 5.0])
              |> line(end = [0.4900857016, -0.0240763666])
        // hello world
    |> line(end = [0.6804562304, 0.9087880491])"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0, 5.0])
  |> line(end = [0.4900857016, -0.0240763666])
  // hello world
  |> line(end = [0.6804562304, 0.9087880491])
"#
        );
    }

    #[test]
    fn test_recast_comment_in_a_fn_block() {
        let some_program_string = r#"fn myFn() {
  // this is a comment
  yo = { a = { b = { c = '123' } } } /* block
  comment */

  key = 'c'
  // this is also a comment
    return things
}"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn myFn() {
  // this is a comment
  yo = { a = { b = { c = '123' } } } /* block
  comment */

  key = 'c'
  // this is also a comment
  return things
}
"#
        );
    }

    #[test]
    fn test_recast_comment_under_variable() {
        let some_program_string = r#"key = 'c'
// this is also a comment
thing = 'foo'
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"key = 'c'
// this is also a comment
thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment_start_file() {
        let some_program_string = r#"// hello world
// I am a comment
key = 'c'
// this is also a comment
// hello
thing = 'foo'
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// hello world
// I am a comment
key = 'c'
// this is also a comment
// hello
thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_empty_comment() {
        let some_program_string = r#"// hello world
//
// I am a comment
key = 'c'

//
// I am a comment
thing = 'c'

foo = 'bar' //
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// hello world
//
// I am a comment
key = 'c'

//
// I am a comment
thing = 'c'

foo = 'bar' //
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment_under_variable() {
        let some_program_string = r#"key = 'c'
// this is also a comment
// hello
thing = 'foo'
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"key = 'c'
// this is also a comment
// hello
thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_only_line_comments() {
        let code = r#"// comment at start
"#;
        let program = crate::parsing::top_level_parse(code).unwrap();

        assert_eq!(program.recast_top(&Default::default(), 0), code);
    }

    #[test]
    fn test_recast_comment_at_start() {
        let test_program = r#"
/* comment at start */

mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])"#;
        let program = crate::parsing::top_level_parse(test_program).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"/* comment at start */

mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
"#
        );
    }

    #[test]
    fn test_recast_lots_of_comments() {
        let some_program_string = r#"// comment at start
mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  // comment here
  |> line(endAbsolute = [0, 1], tag = $myTag)
  |> line(endAbsolute = [1, 1])
  /* and
  here
  */
  // a comment between pipe expression statements
  |> rx(90)
  // and another with just white space between others below
  |> ry(45)
  |> rx(45)
// one more for good measure"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// comment at start
mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  // comment here
  |> line(endAbsolute = [0, 1], tag = $myTag)
  |> line(endAbsolute = [1, 1])
  /* and
  here */
  // a comment between pipe expression statements
  |> rx(90)
  // and another with just white space between others below
  |> ry(45)
  |> rx(45)
// one more for good measure
"#
        );
    }

    #[test]
    fn test_recast_multiline_object() {
        let some_program_string = r#"x = {
  a = 1000000000,
  b = 2000000000,
  c = 3000000000,
  d = 4000000000,
  e = 5000000000
}"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_first_level_object() {
        let some_program_string = r#"three = 3

yo = {
  aStr = 'str',
  anum = 2,
  identifier = three,
  binExp = 4 + 5
}
yo = [
  1,
  "  2,",
  "three",
  4 + 5,
  "  hey oooooo really long long long"
]
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_new_line_before_comment() {
        let some_program_string = r#"
// this is a comment
yo = { a = { b = { c = '123' } } }

key = 'c'
things = "things"

// this is also a comment"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        let expected = some_program_string.trim();
        // Currently new parser removes an empty line
        let actual = recasted.trim();
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_recast_comment_tokens_inside_strings() {
        let some_program_string = r#"b = {
  end = 141,
  start = 125,
  type_ = "NonCodeNode",
  value = "
 // a comment
   "
}"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string.trim());
    }

    #[test]
    fn test_recast_array_new_line_in_pipe() {
        let some_program_string = r#"myVar = 3
myVar2 = 5
myVar3 = 6
myAng = 40
myAng2 = 134
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 3.82], tag = $seg01) // ln-should-get-tag
  |> angledLine(angle = -foo(x = seg01, y = myVar, z = %), length = myVar) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> angledLine(angle = -bar(x = seg01, y = myVar, z = %), length = myVar) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_array_new_line_in_pipe_custom() {
        let some_program_string = r#"myVar = 3
myVar2 = 5
myVar3 = 6
myAng = 40
myAng2 = 134
part001 = startSketchOn(XY)
   |> startProfile(at = [0, 0])
   |> line(end = [1, 3.82], tag = $seg01) // ln-should-get-tag
   |> angledLine(angle = -foo(x = seg01, y = myVar, z = %), length = myVar) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
   |> angledLine(angle = -bar(x = seg01, y = myVar, z = %), length = myVar) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(
            &FormatOptions {
                tab_size: 3,
                use_tabs: false,
                insert_final_newline: true,
            },
            0,
        );
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_after_rename_std() {
        let some_program_string = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0000000000, 5.0000000000])
    |> line(end = [0.4900857016, -0.0240763666])

part002 = "part002"
things = [part001, 0.0]
blah = 1
foo = false
baz = {a: 1, part001: "thing"}

fn ghi(part001) {
  return part001
}
"#;
        let mut program = crate::parsing::top_level_parse(some_program_string).unwrap();
        program.rename_symbol("mySuperCoolPart", 6);

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"mySuperCoolPart = startSketchOn(XY)
  |> startProfile(at = [0.0, 5.0])
  |> line(end = [0.4900857016, -0.0240763666])

part002 = "part002"
things = [mySuperCoolPart, 0.0]
blah = 1
foo = false
baz = { a = 1, part001 = "thing" }

fn ghi(part001) {
  return part001
}
"#
        );
    }

    #[test]
    fn test_recast_after_rename_fn_args() {
        let some_program_string = r#"fn ghi(x, y, z) {
  return x
}"#;
        let mut program = crate::parsing::top_level_parse(some_program_string).unwrap();
        program.rename_symbol("newName", 7);

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn ghi(newName, y, z) {
  return newName
}
"#
        );
    }

    #[test]
    fn test_recast_trailing_comma() {
        let some_program_string = r#"startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> arc({
    radius = 1,
    angle_start = 0,
    angle_end = 180,
  })"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> arc({
       radius = 1,
       angle_start = 0,
       angle_end = 180
     })
"#
        );
    }

    #[test]
    fn test_recast_negative_var() {
        let some_program_string = r#"w = 20
l = 8
h = 10

firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, -l])
  |> close()
  |> extrude(h)
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"w = 20
l = 8
h = 10

firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, -l])
  |> close()
  |> extrude(h)
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment() {
        let some_program_string = r#"w = 20
l = 8
h = 10

// This is my comment
// It has multiple lines
// And it's really long
firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, -l])
  |> close()
  |> extrude(h)
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"w = 20
l = 8
h = 10

// This is my comment
// It has multiple lines
// And it's really long
firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, -l])
  |> close()
  |> extrude(h)
"#
        );
    }

    #[test]
    fn test_recast_math_start_negative() {
        let some_program_string = r#"myVar = -5 + 6"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_math_negate_parens() {
        let some_program_string = r#"wallMountL = 3.82
thickness = 0.5

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, -(wallMountL - thickness)])
  |> line(end = [0, -(5 - thickness)])
  |> line(end = [0, -(5 - 1)])
  |> line(end = [0, -(-5 - 1)])"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_math_nested_parens() {
        let some_program_string = r#"distance = 5
p = 3: Plane
FOS = { a = 3, b = 42 }: Sketch
sigmaAllow = 8: number(mm)
width = 20
thickness = sqrt(distance * p * FOS * 6 / (sigmaAllow * width))"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn no_vardec_keyword() {
        let some_program_string = r#"distance = 5"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn recast_types() {
        let some_program_string = r#"type foo

// A comment
@(impl = primitive)
export type bar(unit, baz)
type baz = Foo | Bar
type UnionOfArrays = [Foo] | [Bar] | Foo | { a: T, b: Foo | Bar | [Baz] }
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let recasted = program.recast_top(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn recast_nested_fn() {
        let some_program_string = r#"fn f() {
  return fn() {
  return 1
}
}"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let recasted = program.recast_top(&Default::default(), 0);
        let expected = "\
fn f() {
  return fn() {
    return 1
  }
}";
        assert_eq!(recasted.trim(), expected);
    }

    #[test]
    fn recast_literal() {
        use winnow::Parser;
        for (i, (raw, expected, reason)) in [
            (
                "5.0",
                "5.0",
                "fractional numbers should stay fractional, i.e. don't reformat this to '5'",
            ),
            (
                "5",
                "5",
                "integers should stay integral, i.e. don't reformat this to '5.0'",
            ),
            (
                "5.0000000",
                "5.0",
                "if the number is f64 but not fractional, use its canonical format",
            ),
            ("5.1", "5.1", "straightforward case works"),
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::parsing::token::lex(raw, ModuleId::default()).unwrap();
            let literal = crate::parsing::parser::unsigned_number_literal
                .parse(tokens.as_slice())
                .unwrap();
            let mut actual = String::new();
            literal.recast(&mut actual);
            assert_eq!(actual, expected, "failed test {i}, which is testing that {reason}");
        }
    }

    #[test]
    fn recast_objects_no_comments() {
        let input = r#"
sketch002 = startSketchOn({
       plane: {
    origin: { x = 1, y = 2, z = 3 },
    x_axis = { x = 4, y = 5, z = 6 },
    y_axis = { x = 7, y = 8, z = 9 },
    z_axis = { x = 10, y = 11, z = 12 }
       }
  })
"#;
        let expected = r#"sketch002 = startSketchOn({
  plane = {
    origin = { x = 1, y = 2, z = 3 },
    x_axis = { x = 4, y = 5, z = 6 },
    y_axis = { x = 7, y = 8, z = 9 },
    z_axis = { x = 10, y = 11, z = 12 }
  }
})
"#;
        let ast = crate::parsing::top_level_parse(input).unwrap();
        let actual = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(actual, expected);
    }

    #[test]
    fn unparse_fn_unnamed() {
        let input = "\
squares_out = reduce(
  arr,
  n = 0: number,
  f = fn(@i, accum) {
    return 1
  },
)
";
        let ast = crate::parsing::top_level_parse(input).unwrap();
        let actual = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(actual, input);
    }

    #[test]
    fn unparse_fn_named() {
        let input = r#"fn f(x) {
  return 1
}
"#;
        let ast = crate::parsing::top_level_parse(input).unwrap();
        let actual = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(actual, input);
    }

    #[test]
    fn unparse_call_inside_function_single_line() {
        let input = r#"fn foo() {
  toDegrees(atan(0.5), foo = 1)
  return 0
}
"#;
        let ast = crate::parsing::top_level_parse(input).unwrap();
        let actual = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(actual, input);
    }

    #[test]
    fn recast_function_types() {
        let input = r#"foo = x: fn
foo = x: fn(number)
fn foo(x: fn(): number): fn {
  return 0
}
fn foo(x: fn(a, b: number(mm), c: d): number(Angle)): fn {
  return 0
}
type fn
type foo = fn
type foo = fn(a: string, b: { f: fn(): any })
type foo = fn([fn])
type foo = fn(fn, f: fn(number(_))): [fn([any]): string]
"#;
        let ast = crate::parsing::top_level_parse(input).unwrap();
        let actual = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(actual, input);
    }

    #[test]
    fn unparse_call_inside_function_args_multiple_lines() {
        let input = r#"fn foo() {
  toDegrees(
    atan(0.5),
    foo = 1,
    bar = 2,
    baz = 3,
    qux = 4,
  )
  return 0
}
"#;
        let ast = crate::parsing::top_level_parse(input).unwrap();
        let actual = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(actual, input);
    }

    #[test]
    fn unparse_call_inside_function_single_arg_multiple_lines() {
        let input = r#"fn foo() {
  toDegrees(
    [
      profile0,
      profile1,
      profile2,
      profile3,
      profile4,
      profile5
    ],
    key = 1,
  )
  return 0
}
"#;
        let ast = crate::parsing::top_level_parse(input).unwrap();
        let actual = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(actual, input);
    }

    #[test]
    fn recast_objects_with_comments() {
        use winnow::Parser;
        for (i, (input, expected, reason)) in [(
            "\
{
  a = 1,
  // b = 2,
  c = 3
}",
            "\
{
  a = 1,
  // b = 2,
  c = 3
}",
            "preserves comments",
        )]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
            crate::parsing::parser::print_tokens(tokens.as_slice());
            let expr = crate::parsing::parser::object.parse(tokens.as_slice()).unwrap();
            let mut actual = String::new();
            expr.recast(&mut actual, &FormatOptions::new(), 0, ExprContext::Other);
            assert_eq!(
                actual, expected,
                "failed test {i}, which is testing that recasting {reason}"
            );
        }
    }

    #[test]
    fn recast_array_with_comments() {
        use winnow::Parser;
        for (i, (input, expected, reason)) in [
            (
                "\
[
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
]",
                "\
[
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20
]",
                "preserves multi-line arrays",
            ),
            (
                "\
[
  1,
  // 2,
  3
]",
                "\
[
  1,
  // 2,
  3
]",
                "preserves comments",
            ),
            (
                "\
[
  1,
  2,
  // 3
]",
                "\
[
  1,
  2,
  // 3
]",
                "preserves comments at the end of the array",
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
            let expr = crate::parsing::parser::array_elem_by_elem
                .parse(tokens.as_slice())
                .unwrap();
            let mut actual = String::new();
            expr.recast(&mut actual, &FormatOptions::new(), 0, ExprContext::Other);
            assert_eq!(
                actual, expected,
                "failed test {i}, which is testing that recasting {reason}"
            );
        }
    }

    #[test]
    fn code_with_comment_and_extra_lines() {
        let code = r#"yo = 'c'

/* this is
a
comment */
yo = 'bing'
"#;
        let ast = crate::parsing::top_level_parse(code).unwrap();
        let recasted = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(recasted, code);
    }

    #[test]
    fn comments_in_a_fn_block() {
        let code = r#"fn myFn() {
  // this is a comment
  yo = { a = { b = { c = '123' } } }

  /* block
  comment */
  key = 'c'
  // this is also a comment
}
"#;
        let ast = crate::parsing::top_level_parse(code).unwrap();
        let recasted = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(recasted, code);
    }

    #[test]
    fn array_range_end_exclusive() {
        let code = "myArray = [0..<4]\n";
        let ast = crate::parsing::top_level_parse(code).unwrap();
        let recasted = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(recasted, code);
    }

    #[test]
    fn paren_precedence() {
        let code = r#"x = 1 - 2 - 3
x = (1 - 2) - 3
x = 1 - (2 - 3)
x = 1 + 2 + 3
x = (1 + 2) + 3
x = 1 + (2 + 3)
x = 2 * (y % 2)
x = (2 * y) % 2
x = 2 % (y * 2)
x = (2 % y) * 2
x = 2 * y % 2
"#;

        let expected = r#"x = 1 - 2 - 3
x = 1 - 2 - 3
x = 1 - (2 - 3)
x = 1 + 2 + 3
x = 1 + 2 + 3
x = 1 + 2 + 3
x = 2 * (y % 2)
x = 2 * y % 2
x = 2 % (y * 2)
x = 2 % y * 2
x = 2 * y % 2
"#;
        let ast = crate::parsing::top_level_parse(code).unwrap();
        let recasted = ast.recast_top(&FormatOptions::new(), 0);
        assert_eq!(recasted, expected);
    }

    #[test]
    fn gap_between_body_item_and_documented_fn() {
        let code = "\
x = 360

// Watermelon
fn myFn() {
}
";
        let ast = crate::parsing::top_level_parse(code).unwrap();
        let recasted = ast.recast_top(&FormatOptions::new(), 0);
        let expected = code;
        assert_eq!(recasted, expected);
    }

    #[test]
    fn simple_assignment_in_fn() {
        let code = "\
fn function001() {
  extrude002 = extrude()
}\n";

        let ast = crate::parsing::top_level_parse(code).unwrap();
        let recasted = ast.recast_top(&FormatOptions::new(), 0);
        let expected = code;
        assert_eq!(recasted, expected);
    }
}
