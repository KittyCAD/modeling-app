use std::fmt::Write;

use crate::{
    ast::types::{
        ArrayExpression, BinaryExpression, BinaryOperator, BinaryPart, BodyItem, CallExpression, Expr, FormatOptions,
        FunctionExpression, IfExpression, Literal, LiteralIdentifier, LiteralValue, MemberExpression, MemberObject,
        NonCodeValue, ObjectExpression, PipeExpression, Program, TagDeclarator, UnaryExpression, VariableDeclaration,
    },
    parser::PIPE_OPERATOR,
};

impl Program {
    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let indentation = options.get_indentation(indentation_level);
        let result = self
            .body
            .iter()
            .map(|statement| match statement.clone() {
                BodyItem::ExpressionStatement(expression_statement) => {
                    expression_statement
                        .expression
                        .recast(options, indentation_level, false)
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    variable_declaration.recast(options, indentation_level)
                }
                BodyItem::ReturnStatement(return_statement) => {
                    format!(
                        "{}return {}",
                        indentation,
                        return_statement.argument.recast(options, 0, false)
                    )
                }
            })
            .enumerate()
            .fold(String::new(), |mut output, (index, recast_str)| {
                let start_string = if index == 0 {
                    // We need to indent.
                    if self.non_code_meta.start.is_empty() {
                        indentation.to_string()
                    } else {
                        self.non_code_meta
                            .start
                            .iter()
                            .map(|start| start.format(&indentation))
                            .collect()
                    }
                } else {
                    // Do nothing, we already applied the indentation elsewhere.
                    String::new()
                };

                // determine the value of the end string
                // basically if we are inside a nested function we want to end with a new line
                let maybe_line_break: String = if index == self.body.len() - 1 && indentation_level == 0 {
                    String::new()
                } else {
                    "\n".to_string()
                };

                let custom_white_space_or_comment = match self.non_code_meta.non_code_nodes.get(&index) {
                    Some(noncodes) => noncodes
                        .iter()
                        .enumerate()
                        .map(|(i, custom_white_space_or_comment)| {
                            let formatted = custom_white_space_or_comment.format(&indentation);
                            if i == 0 && !formatted.trim().is_empty() {
                                if let NonCodeValue::BlockComment { .. } = custom_white_space_or_comment.value {
                                    format!("\n{}", formatted)
                                } else {
                                    formatted
                                }
                            } else {
                                formatted
                            }
                        })
                        .collect::<String>(),
                    None => String::new(),
                };
                let end_string = if custom_white_space_or_comment.is_empty() {
                    maybe_line_break
                } else {
                    custom_white_space_or_comment
                };

                let _ = write!(output, "{}{}{}", start_string, recast_str, end_string);
                output
            })
            .trim()
            .to_string();

        // Insert a final new line if the user wants it.
        if options.insert_final_newline && !result.is_empty() {
            format!("{}\n", result)
        } else {
            result
        }
    }
}

impl NonCodeValue {
    fn should_cause_array_newline(&self) -> bool {
        match self {
            Self::InlineComment { .. } => false,
            Self::Shebang { .. } | Self::BlockComment { .. } | Self::NewLineBlockComment { .. } | Self::NewLine => true,
        }
    }
}

impl Expr {
    pub(crate) fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        match &self {
            Expr::BinaryExpression(bin_exp) => bin_exp.recast(options),
            Expr::ArrayExpression(array_exp) => array_exp.recast(options, indentation_level, is_in_pipe),
            Expr::ObjectExpression(ref obj_exp) => obj_exp.recast(options, indentation_level, is_in_pipe),
            Expr::MemberExpression(mem_exp) => mem_exp.recast(),
            Expr::Literal(literal) => literal.recast(),
            Expr::FunctionExpression(func_exp) => func_exp.recast(options, indentation_level),
            Expr::CallExpression(call_exp) => call_exp.recast(options, indentation_level, is_in_pipe),
            Expr::Identifier(ident) => ident.name.to_string(),
            Expr::TagDeclarator(tag) => tag.recast(),
            Expr::PipeExpression(pipe_exp) => pipe_exp.recast(options, indentation_level),
            Expr::UnaryExpression(unary_exp) => unary_exp.recast(options),
            Expr::IfExpression(e) => e.recast(options, indentation_level, is_in_pipe),
            Expr::PipeSubstitution(_) => crate::parser::PIPE_SUBSTITUTION_OPERATOR.to_string(),
            Expr::None(_) => {
                unimplemented!("there is no literal None, see https://github.com/KittyCAD/modeling-app/issues/1115")
            }
        }
    }
}

impl BinaryPart {
    fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        match &self {
            BinaryPart::Literal(literal) => literal.recast(),
            BinaryPart::Identifier(identifier) => identifier.name.to_string(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.recast(options),
            BinaryPart::CallExpression(call_expression) => call_expression.recast(options, indentation_level, false),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.recast(options),
            BinaryPart::MemberExpression(member_expression) => member_expression.recast(),
            BinaryPart::IfExpression(e) => e.recast(options, indentation_level, false),
        }
    }
}

impl CallExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        format!(
            "{}{}({})",
            if is_in_pipe {
                "".to_string()
            } else {
                options.get_indentation(indentation_level)
            },
            self.callee.name,
            self.arguments
                .iter()
                .map(|arg| arg.recast(options, indentation_level, is_in_pipe))
                .collect::<Vec<String>>()
                .join(", ")
        )
    }
}

impl VariableDeclaration {
    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let indentation = options.get_indentation(indentation_level);
        self.declarations.iter().fold(String::new(), |mut output, declaration| {
            let _ = write!(
                output,
                "{}{} {} = {}",
                indentation,
                self.kind,
                declaration.id.name,
                declaration.init.recast(options, indentation_level, false).trim()
            );
            output
        })
    }
}

impl Literal {
    fn recast(&self) -> String {
        match self.value {
            LiteralValue::Fractional(x) => {
                if x.fract() == 0.0 {
                    format!("{x:?}")
                } else {
                    self.raw.clone()
                }
            }
            LiteralValue::IInteger(_) => self.raw.clone(),
            LiteralValue::String(ref s) => {
                let quote = if self.raw.trim().starts_with('"') { '"' } else { '\'' };
                format!("{quote}{s}{quote}")
            }
            LiteralValue::Bool(_) => self.raw.clone(),
        }
    }
}

impl TagDeclarator {
    pub fn recast(&self) -> String {
        // TagDeclarators are always prefixed with a dollar sign.
        format!("${}", self.name)
    }
}

impl ArrayExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        // Reconstruct the order of items in the array.
        // An item can be an element (i.e. an expression for a KCL value),
        // or a non-code item (e.g. a comment)
        let num_items = self.elements.len() + self.non_code_meta.non_code_nodes_len();
        let mut elems = self.elements.iter();
        let mut found_line_comment = false;
        let mut format_items: Vec<_> = (0..num_items)
            .flat_map(|i| {
                if let Some(noncode) = self.non_code_meta.non_code_nodes.get(&i) {
                    noncode
                        .iter()
                        .map(|nc| {
                            found_line_comment |= nc.value.should_cause_array_newline();
                            nc.format("")
                        })
                        .collect::<Vec<_>>()
                } else {
                    let el = elems.next().unwrap();
                    let s = format!("{}, ", el.recast(options, 0, false));
                    vec![s]
                }
            })
            .collect();

        // Format these items into a one-line array.
        if let Some(item) = format_items.last_mut() {
            if let Some(norm) = item.strip_suffix(", ") {
                *item = norm.to_owned();
            }
        }
        let format_items = format_items; // Remove mutability
        let flat_recast = format!("[{}]", format_items.join(""));

        // We might keep the one-line representation, if it's short enough.
        let max_array_length = 40;
        let multi_line = flat_recast.len() > max_array_length || found_line_comment;
        if !multi_line {
            return flat_recast;
        }

        // Otherwise, we format a multi-line representation.
        let inner_indentation = if is_in_pipe {
            options.get_indentation_offset_pipe(indentation_level + 1)
        } else {
            options.get_indentation(indentation_level + 1)
        };
        let formatted_array_lines = format_items
            .iter()
            .map(|s| {
                format!(
                    "{inner_indentation}{}{}",
                    if let Some(x) = s.strip_suffix(" ") { x } else { s },
                    if s.ends_with('\n') { "" } else { "\n" }
                )
            })
            .collect::<Vec<String>>()
            .join("")
            .to_owned();
        let end_indent = if is_in_pipe {
            options.get_indentation_offset_pipe(indentation_level)
        } else {
            options.get_indentation(indentation_level)
        };
        format!("[\n{formatted_array_lines}{end_indent}]")
    }
}

impl ObjectExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        if self
            .non_code_meta
            .non_code_nodes
            .values()
            .any(|nc| nc.iter().any(|nc| nc.value.should_cause_array_newline()))
        {
            return self.recast_multi_line(options, indentation_level, is_in_pipe);
        }
        let flat_recast = format!(
            "{{ {} }}",
            self.properties
                .iter()
                .map(|prop| {
                    format!(
                        "{}: {}",
                        prop.key.name,
                        prop.value.recast(options, indentation_level + 1, is_in_pipe).trim()
                    )
                })
                .collect::<Vec<String>>()
                .join(", ")
        );
        let max_array_length = 40;
        let needs_multiple_lines = flat_recast.len() > max_array_length;
        if !needs_multiple_lines {
            return flat_recast;
        }
        self.recast_multi_line(options, indentation_level, is_in_pipe)
    }

    /// Recast, but always outputs the object with newlines between each property.
    fn recast_multi_line(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        let inner_indentation = if is_in_pipe {
            options.get_indentation_offset_pipe(indentation_level + 1)
        } else {
            options.get_indentation(indentation_level + 1)
        };
        let num_items = self.properties.len() + self.non_code_meta.non_code_nodes_len();
        let mut props = self.properties.iter();
        let format_items: Vec<_> = (0..num_items)
            .flat_map(|i| {
                if let Some(noncode) = self.non_code_meta.non_code_nodes.get(&i) {
                    noncode.iter().map(|nc| nc.format("")).collect::<Vec<_>>()
                } else {
                    let prop = props.next().unwrap();
                    // Use a comma unless it's the last item
                    let comma = if i == num_items - 1 { "" } else { ",\n" };
                    let s = format!(
                        "{}: {}{comma}",
                        prop.key.name,
                        prop.value.recast(options, indentation_level + 1, is_in_pipe).trim()
                    );
                    vec![s]
                }
            })
            .collect();
        let end_indent = if is_in_pipe {
            options.get_indentation_offset_pipe(indentation_level)
        } else {
            options.get_indentation(indentation_level)
        };
        format!(
            "{{\n{inner_indentation}{}\n{end_indent}}}",
            format_items.join(&inner_indentation),
        )
    }
}

impl MemberExpression {
    fn recast(&self) -> String {
        let key_str = match &self.property {
            LiteralIdentifier::Identifier(identifier) => {
                if self.computed {
                    format!("[{}]", &(*identifier.name))
                } else {
                    format!(".{}", &(*identifier.name))
                }
            }
            LiteralIdentifier::Literal(lit) => format!("[{}]", &(*lit.raw)),
        };

        match &self.object {
            MemberObject::MemberExpression(member_exp) => member_exp.recast() + key_str.as_str(),
            MemberObject::Identifier(identifier) => identifier.name.to_string() + key_str.as_str(),
        }
    }
}

impl BinaryExpression {
    fn recast(&self, options: &FormatOptions) -> String {
        let maybe_wrap_it = |a: String, doit: bool| -> String {
            if doit {
                format!("({})", a)
            } else {
                a
            }
        };

        let should_wrap_right = match &self.right {
            BinaryPart::BinaryExpression(bin_exp) => {
                self.precedence() > bin_exp.precedence()
                    || self.operator == BinaryOperator::Sub
                    || self.operator == BinaryOperator::Div
            }
            _ => false,
        };

        let should_wrap_left = match &self.left {
            BinaryPart::BinaryExpression(bin_exp) => self.precedence() > bin_exp.precedence(),
            _ => false,
        };

        format!(
            "{} {} {}",
            maybe_wrap_it(self.left.recast(options, 0), should_wrap_left),
            self.operator,
            maybe_wrap_it(self.right.recast(options, 0), should_wrap_right)
        )
    }
}

impl UnaryExpression {
    fn recast(&self, options: &FormatOptions) -> String {
        match self.argument {
            BinaryPart::Literal(_)
            | BinaryPart::Identifier(_)
            | BinaryPart::MemberExpression(_)
            | BinaryPart::IfExpression(_)
            | BinaryPart::CallExpression(_) => {
                format!("{}{}", &self.operator, self.argument.recast(options, 0))
            }
            BinaryPart::BinaryExpression(_) | BinaryPart::UnaryExpression(_) => {
                format!("{}({})", &self.operator, self.argument.recast(options, 0))
            }
        }
    }
}

impl IfExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        todo!("ADAM")
    }
}

impl PipeExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let pipe = self
            .body
            .iter()
            .enumerate()
            .map(|(index, statement)| {
                let indentation = options.get_indentation(indentation_level + 1);
                let mut s = statement.recast(options, indentation_level + 1, true);
                let non_code_meta = self.non_code_meta.clone();
                if let Some(non_code_meta_value) = non_code_meta.non_code_nodes.get(&index) {
                    for val in non_code_meta_value {
                        let formatted = if val.end == self.end {
                            let indentation = options.get_indentation(indentation_level);
                            val.format(&indentation).trim_end_matches('\n').to_string()
                        } else {
                            val.format(&indentation).trim_end_matches('\n').to_string()
                        };
                        if let NonCodeValue::BlockComment { .. } = val.value {
                            s += "\n";
                            s += &formatted;
                        } else {
                            s += &formatted;
                        }
                    }
                }

                if index != self.body.len() - 1 {
                    s += "\n";
                    s += &indentation;
                    s += PIPE_OPERATOR;
                    s += " ";
                }
                s
            })
            .collect::<String>();
        format!("{}{}", options.get_indentation(indentation_level), pipe)
    }
}

impl FunctionExpression {
    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        // We don't want to end with a new line inside nested functions.
        let mut new_options = options.clone();
        new_options.insert_final_newline = false;
        format!(
            "({}) => {{\n{}{}\n}}",
            self.params
                .iter()
                .map(|param| param.identifier.name.clone())
                .collect::<Vec<String>>()
                .join(", "),
            options.get_indentation(indentation_level + 1),
            self.body.recast(&new_options, indentation_level + 1)
        )
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use crate::ast::types::FormatOptions;

    #[test]
    fn test_recast_bug_fn_in_fn() {
        let some_program_string = r#"// Start point (top left)
const zoo_x = -20
const zoo_y = 7
// Scale
const s = 1 // s = 1 -> height of Z is 13.4mm
// Depth
const d = 1

fn rect = (x, y, w, h) => {
  startSketchOn('XY')
    |> startProfileAt([x, y], %)
    |> xLine(w, %)
    |> yLine(h, %)
    |> xLine(-w, %)
    |> close(%)
    |> extrude(d, %)
}

fn quad = (x1, y1, x2, y2, x3, y3, x4, y4) => {
  startSketchOn('XY')
    |> startProfileAt([x1, y1], %)
    |> lineTo([x2, y2], %)
    |> lineTo([x3, y3], %)
    |> lineTo([x4, y4], %)
    |> close(%)
    |> extrude(d, %)
}

fn crosshair = (x, y) => {
  startSketchOn('XY')
    |> startProfileAt([x, y], %)
    |> yLine(1, %)
    |> yLine(-2, %)
    |> yLine(1, %)
    |> xLine(1, %)
    |> xLine(-2, %)
}

fn z = (z_x, z_y) => {
  const z_end_w = s * 8.4
  const z_end_h = s * 3
  const z_corner = s * 2
  const z_w = z_end_w + 2 * z_corner
  const z_h = z_w * 1.08130081300813
  rect(z_x, z_y, z_end_w, -z_end_h)
  rect(z_x + z_w, z_y, -z_corner, -z_corner)
  rect(z_x + z_w, z_y - z_h, -z_end_w, z_end_h)
  rect(z_x, z_y - z_h, z_corner, z_corner)
  quad(z_x, z_y - z_h + z_corner, z_x + z_w - z_corner, z_y, z_x + z_w, z_y - z_corner, z_x + z_corner, z_y - z_h)
}

fn o = (c_x, c_y) => {
  // Outer and inner radii
  const o_r = s * 6.95
  const i_r = 0.5652173913043478 * o_r

  // Angle offset for diagonal break
  const a = 7

  // Start point for the top sketch
  const o_x1 = c_x + o_r * cos((45 + a) / 360 * tau())
  const o_y1 = c_y + o_r * sin((45 + a) / 360 * tau())

  // Start point for the bottom sketch
  const o_x2 = c_x + o_r * cos((225 + a) / 360 * tau())
  const o_y2 = c_y + o_r * sin((225 + a) / 360 * tau())

  // End point for the bottom startSketchAt
  const o_x3 = c_x + o_r * cos((45 - a) / 360 * tau())
  const o_y3 = c_y + o_r * sin((45 - a) / 360 * tau())

  // Where is the center?
  // crosshair(c_x, c_y)


  startSketchOn('XY')
    |> startProfileAt([o_x1, o_y1], %)
    |> arc({
         radius: o_r,
         angle_start: 45 + a,
         angle_end: 225 - a
       }, %)
    |> angledLine([45, o_r - i_r], %)
    |> arc({
         radius: i_r,
         angle_start: 225 - a,
         angle_end: 45 + a
       }, %)
    |> close(%)
    |> extrude(d, %)

  startSketchOn('XY')
    |> startProfileAt([o_x2, o_y2], %)
    |> arc({
         radius: o_r,
         angle_start: 225 + a,
         angle_end: 360 + 45 - a
       }, %)
    |> angledLine([225, o_r - i_r], %)
    |> arc({
         radius: i_r,
         angle_start: 45 - a,
         angle_end: 225 + a - 360
       }, %)
    |> close(%)
    |> extrude(d, %)
}

fn zoo = (x0, y0) => {
  z(x0, y0)
  o(x0 + s * 20, y0 - (s * 6.7))
  o(x0 + s * 35, y0 - (s * 6.7))
}

zoo(zoo_x, zoo_y)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_bug_extra_parens() {
        let some_program_string = r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads. 

// Define constants like ball diameter, inside diameter, overhange length, and thickness
const sphereDia = 0.5
const insideDia = 1
const thickness = 0.25
const overHangLength = .4

// Sketch and revolve the inside bearing piece
const insideRevolve = startSketchOn('XZ')
  |> startProfileAt([insideDia / 2, 0], %)
  |> line([0, thickness + sphereDia / 2], %)
  |> line([overHangLength, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, -sphereDia], %)
  |> line([overHangLength - thickness, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
const sphere = startSketchOn('XZ')
  |> startProfileAt([
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ], %)
  |> line([sphereDia - 0.1, 0], %)
  |> arc({
       angle_start: 0,
       angle_end: -180,
       radius: sphereDia / 2 - 0.05
     }, %)
  |> close(%)
  |> revolve({ axis: 'x' }, %)
  |> patternCircular3d({
       axis: [0, 0, 1],
       center: [0, 0, 0],
       repetitions: 10,
       arcDegrees: 360,
       rotateDuplicates: true
     }, %)

// Sketch and revolve the outside bearing
const outsideRevolve = startSketchOn('XZ')
  |> startProfileAt([
       insideDia / 2 + thickness + sphereDia,
       0
     ], %)
  |> line([0, sphereDia / 2], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength, 0], %)
  |> line([0, -2 * thickness - sphereDia], %)
  |> line([-overHangLength, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength - thickness, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads.


// Define constants like ball diameter, inside diameter, overhange length, and thickness
const sphereDia = 0.5
const insideDia = 1
const thickness = 0.25
const overHangLength = .4

// Sketch and revolve the inside bearing piece
const insideRevolve = startSketchOn('XZ')
  |> startProfileAt([insideDia / 2, 0], %)
  |> line([0, thickness + sphereDia / 2], %)
  |> line([overHangLength, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, -sphereDia], %)
  |> line([overHangLength - thickness, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
const sphere = startSketchOn('XZ')
  |> startProfileAt([
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ], %)
  |> line([sphereDia - 0.1, 0], %)
  |> arc({
       angle_start: 0,
       angle_end: -180,
       radius: sphereDia / 2 - 0.05
     }, %)
  |> close(%)
  |> revolve({ axis: 'x' }, %)
  |> patternCircular3d({
       axis: [0, 0, 1],
       center: [0, 0, 0],
       repetitions: 10,
       arcDegrees: 360,
       rotateDuplicates: true
     }, %)

// Sketch and revolve the outside bearing
const outsideRevolve = startSketchOn('XZ')
  |> startProfileAt([
       insideDia / 2 + thickness + sphereDia,
       0
     ], %)
  |> line([0, sphereDia / 2], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength, 0], %)
  |> line([0, -2 * thickness - sphereDia], %)
  |> line([-overHangLength, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength - thickness, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)
"#
        );
    }

    #[test]
    fn test_recast_fn_in_object() {
        let some_program_string = r#"const bing = { yo: 55 }
const myNestedVar = [{ prop: callExp(bing.yo) }]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_fn_in_array() {
        let some_program_string = r#"const bing = { yo: 55 }
const myNestedVar = [callExp(bing.yo)]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_space_in_fn_call() {
        let some_program_string = r#"fn thing = (x) => {
    return x + 1
}

thing ( 1 )
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn thing = (x) => {
  return x + 1
}

thing(1)
"#
        );
    }

    #[test]
    fn test_recast_object_fn_in_array_weird_bracket() {
        let some_program_string = r#"const bing = { yo: 55 }
const myNestedVar = [
  {
  prop:   line([bing.yo, 21], sketch001)
}
]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const bing = { yo: 55 }
const myNestedVar = [
  { prop: line([bing.yo, 21], sketch001) }
]
"#
        );
    }

    #[test]
    fn test_recast_empty_file() {
        let some_program_string = r#""#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(recasted, r#""#);
    }

    #[test]
    fn test_recast_empty_file_new_line() {
        let some_program_string = r#"
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(recasted, r#""#);
    }

    #[test]
    fn test_recast_shebang_only() {
        let some_program_string = r#"#!/usr/local/env zoo kcl"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([21, 24])], message: "Unexpected end of file. The compiler expected a function body items (functions are made up of variable declarations, expressions, and return statements, each of those is a possible body item" }"#
        );
    }

    #[test]
    fn test_recast_shebang() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#
        );
    }

    #[test]
    fn test_recast_shebang_new_lines() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
        


const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#
        );
    }

    #[test]
    fn test_recast_shebang_with_comments() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
        
// Yo yo my comments.
const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

// Yo yo my comments.
const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#
        );
    }

    #[test]
    fn test_recast_large_file() {
        let some_program_string = r#"// define constants
const radius = 6.0
const width = 144.0
const length = 83.0
const depth = 45.0
const thk = 5
const hole_diam = 5
// define a rectangular shape func
fn rectShape = (pos, w, l) => {
  const rr = startSketchOn('xy')
    |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
    |> lineTo([pos[0] + w / 2, pos[1] - (l / 2)], %,$edge1)
    |> lineTo([pos[0] + w / 2, pos[1] + l / 2], %, $edge2)
    |> lineTo([pos[0] - (w / 2), pos[1] + l / 2], %, $edge3)
    |> close(%, $edge4)
  return rr
}
// build the body of the focusrite scarlett solo gen 4
// only used for visualization
const scarlett_body = rectShape([0, 0], width, length)
  |> extrude(depth, %)
  |> fillet({
       radius: radius,
       tags: [
  edge2,
  edge4,
  getOppositeEdge(edge2),
  getOppositeEdge(edge4)
]
     }, %)
  // build the bracket sketch around the body
fn bracketSketch = (w, d, t) => {
  const s = startSketchOn({
         plane: {
  origin: { x: 0, y: length / 2 + thk, z: 0 },
  x_axis: { x: 1, y: 0, z: 0 },
  y_axis: { x: 0, y: 0, z: 1 },
  z_axis: { x: 0, y: 1, z: 0 }
}
       })
    |> startProfileAt([-w / 2 - t, d + t], %)
    |> lineTo([-w / 2 - t, -t], %, $edge1)
    |> lineTo([w / 2 + t, -t], %, $edge2)
    |> lineTo([w / 2 + t, d + t], %, $edge3)
    |> lineTo([w / 2, d + t], %, $edge4)
    |> lineTo([w / 2, 0], %, $edge5)
    |> lineTo([-w / 2, 0], %, $edge6)
    |> lineTo([-w / 2, d + t], %, $edge7)
    |> close(%, $edge8)
  return s
}
// build the body of the bracket
const bracket_body = bracketSketch(width, depth, thk)
  |> extrude(length + 10, %)
  |> fillet({
       radius: radius,
       tags: [
  getNextAdjacentEdge(edge7),
  getNextAdjacentEdge(edge2),
  getNextAdjacentEdge(edge3),
  getNextAdjacentEdge(edge6)
]
     }, %)
  // build the tabs of the mounting bracket (right side)
const tabs_r = startSketchOn({
       plane: {
  origin: { x: 0, y: 0, z: depth + thk },
  x_axis: { x: 1, y: 0, z: 0 },
  y_axis: { x: 0, y: 1, z: 0 },
  z_axis: { x: 0, y: 0, z: 1 }
}
     })
  |> startProfileAt([width / 2 + thk, length / 2 + thk], %)
  |> line([10, -5], %)
  |> line([0, -10], %)
  |> line([-10, -5], %)
  |> close(%)
  |> hole(circle({
       center: [
         width / 2 + thk + hole_diam,
         length / 2 - hole_diam
       ],
       radius: hole_diam / 2
     }, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
  // build the tabs of the mounting bracket (left side)
const tabs_l = startSketchOn({
       plane: {
  origin: { x: 0, y: 0, z: depth + thk },
  x_axis: { x: 1, y: 0, z: 0 },
  y_axis: { x: 0, y: 1, z: 0 },
  z_axis: { x: 0, y: 0, z: 1 }
}
     })
  |> startProfileAt([-width / 2 - thk, length / 2 + thk], %)
  |> line([-10, -5], %)
  |> line([0, -10], %)
  |> line([10, -5], %)
  |> close(%)
  |> hole(circle({
       center: [
         -width / 2 - thk - hole_diam,
         length / 2 - hole_diam
       ],
       radius: hole_diam / 2
     }, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(
            recasted,
            r#"// define constants
const radius = 6.0
const width = 144.0
const length = 83.0
const depth = 45.0
const thk = 5
const hole_diam = 5
// define a rectangular shape func
fn rectShape = (pos, w, l) => {
  const rr = startSketchOn('xy')
    |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
    |> lineTo([pos[0] + w / 2, pos[1] - (l / 2)], %, $edge1)
    |> lineTo([pos[0] + w / 2, pos[1] + l / 2], %, $edge2)
    |> lineTo([pos[0] - (w / 2), pos[1] + l / 2], %, $edge3)
    |> close(%, $edge4)
  return rr
}
// build the body of the focusrite scarlett solo gen 4
// only used for visualization
const scarlett_body = rectShape([0, 0], width, length)
  |> extrude(depth, %)
  |> fillet({
       radius: radius,
       tags: [
         edge2,
         edge4,
         getOppositeEdge(edge2),
         getOppositeEdge(edge4)
       ]
     }, %)
// build the bracket sketch around the body
fn bracketSketch = (w, d, t) => {
  const s = startSketchOn({
         plane: {
           origin: { x: 0, y: length / 2 + thk, z: 0 },
           x_axis: { x: 1, y: 0, z: 0 },
           y_axis: { x: 0, y: 0, z: 1 },
           z_axis: { x: 0, y: 1, z: 0 }
         }
       })
    |> startProfileAt([-w / 2 - t, d + t], %)
    |> lineTo([-w / 2 - t, -t], %, $edge1)
    |> lineTo([w / 2 + t, -t], %, $edge2)
    |> lineTo([w / 2 + t, d + t], %, $edge3)
    |> lineTo([w / 2, d + t], %, $edge4)
    |> lineTo([w / 2, 0], %, $edge5)
    |> lineTo([-w / 2, 0], %, $edge6)
    |> lineTo([-w / 2, d + t], %, $edge7)
    |> close(%, $edge8)
  return s
}
// build the body of the bracket
const bracket_body = bracketSketch(width, depth, thk)
  |> extrude(length + 10, %)
  |> fillet({
       radius: radius,
       tags: [
         getNextAdjacentEdge(edge7),
         getNextAdjacentEdge(edge2),
         getNextAdjacentEdge(edge3),
         getNextAdjacentEdge(edge6)
       ]
     }, %)
// build the tabs of the mounting bracket (right side)
const tabs_r = startSketchOn({
       plane: {
         origin: { x: 0, y: 0, z: depth + thk },
         x_axis: { x: 1, y: 0, z: 0 },
         y_axis: { x: 0, y: 1, z: 0 },
         z_axis: { x: 0, y: 0, z: 1 }
       }
     })
  |> startProfileAt([width / 2 + thk, length / 2 + thk], %)
  |> line([10, -5], %)
  |> line([0, -10], %)
  |> line([-10, -5], %)
  |> close(%)
  |> hole(circle({
       center: [
         width / 2 + thk + hole_diam,
         length / 2 - hole_diam
       ],
       radius: hole_diam / 2
     }, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
// build the tabs of the mounting bracket (left side)
const tabs_l = startSketchOn({
       plane: {
         origin: { x: 0, y: 0, z: depth + thk },
         x_axis: { x: 1, y: 0, z: 0 },
         y_axis: { x: 0, y: 1, z: 0 },
         z_axis: { x: 0, y: 0, z: 1 }
       }
     })
  |> startProfileAt([-width / 2 - thk, length / 2 + thk], %)
  |> line([-10, -5], %)
  |> line([0, -10], %)
  |> line([10, -5], %)
  |> close(%)
  |> hole(circle({
       center: [
         -width / 2 - thk - hole_diam,
         length / 2 - hole_diam
       ],
       radius: hole_diam / 2
     }, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
"#
        );
    }

    #[test]
    fn test_recast_nested_var_declaration_in_fn_body() {
        let some_program_string = r#"fn cube = (pos, scale) => {
   const sg = startSketchOn('XY')
  |> startProfileAt(pos, %)
  |> line([0, scale], %)
  |> line([scale, 0], %)
  |> line([0, -scale], %)
  |> close(%)
  |> extrude(scale, %)
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)
}
"#
        );
    }

    #[test]
    fn test_recast_with_bad_indentation() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
              |> line([0.4900857016, -0.0240763666], %)
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %)
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }

    #[test]
    fn test_recast_with_bad_indentation_and_inline_comment() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
              |> line([0.4900857016, -0.0240763666], %) // hello world
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %) // hello world
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }
    #[test]
    fn test_recast_with_bad_indentation_and_line_comment() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
              |> line([0.4900857016, -0.0240763666], %)
        // hello world
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %)
  // hello world
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }

    #[test]
    fn test_recast_comment_in_a_fn_block() {
        let some_program_string = r#"fn myFn = () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } } /* block
  comment */

  const key = 'c'
  // this is also a comment
    return things
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn myFn = () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } } /* block
  comment */

  const key = 'c'
  // this is also a comment
  return things
}
"#
        );
    }

    #[test]
    fn test_recast_comment_under_variable() {
        let some_program_string = r#"const key = 'c'
// this is also a comment
const thing = 'foo'
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const key = 'c'
// this is also a comment
const thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment_start_file() {
        let some_program_string = r#"// hello world
// I am a comment
const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// hello world
// I am a comment
const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_empty_comment() {
        let some_program_string = r#"// hello world
//
// I am a comment
const key = 'c'

//
// I am a comment
const thing = 'c'

const foo = 'bar' //
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// hello world
//
// I am a comment
const key = 'c'

//
// I am a comment
const thing = 'c'

const foo = 'bar' //
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment_under_variable() {
        let some_program_string = r#"const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_comment_at_start() {
        let test_program = r#"
/* comment at start */

const mySk1 = startSketchAt([0, 0])"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"/* comment at start */

const mySk1 = startSketchAt([0, 0])
"#
        );
    }

    #[test]
    fn test_recast_lots_of_comments() {
        let some_program_string = r#"// comment at start
const mySk1 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo([0, 1], %, $myTag)
  |> lineTo([1, 1], %)
  /* and
  here
  */
  // a comment between pipe expression statements
  |> rx(90, %)
  // and another with just white space between others below
  |> ry(45, %)
  |> rx(45, %)
// one more for good measure"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// comment at start
const mySk1 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo([0, 1], %, $myTag)
  |> lineTo([1, 1], %)
  /* and
  here */
  // a comment between pipe expression statements
  |> rx(90, %)
  // and another with just white space between others below
  |> ry(45, %)
  |> rx(45, %)
// one more for good measure
"#
        );
    }

    #[test]
    fn test_recast_multiline_object() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-0.01, -0.08], %)
  |> line([0.62, 4.15], %, $seg01)
  |> line([2.77, -1.24], %)
  |> angledLineThatIntersects({
       angle: 201,
       offset: -1.35,
       intersectTag: seg01
     }, %)
  |> line([-0.42, -1.72], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_first_level_object() {
        let some_program_string = r#"const three = 3

const yo = {
  aStr: 'str',
  anum: 2,
  identifier: three,
  binExp: 4 + 5
}
const yo = [
  1,
  "  2,",
  "three",
  4 + 5,
  "  hey oooooo really long long long"
]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_new_line_before_comment() {
        let some_program_string = r#"
// this is a comment
const yo = { a: { b: { c: '123' } } }

const key = 'c'
const things = "things"

// this is also a comment"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        let expected = some_program_string.trim();
        // Currently new parser removes an empty line
        let actual = recasted.trim();
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_recast_comment_tokens_inside_strings() {
        let some_program_string = r#"let b = {
  end: 141,
  start: 125,
  type: "NonCodeNode",
  value: "
 // a comment
   "
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string.trim());
    }

    #[test]
    fn test_recast_array_new_line_in_pipe() {
        let some_program_string = r#"const myVar = 3
const myVar2 = 5
const myVar3 = 6
const myAng = 40
const myAng2 = 134
const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([1, 3.82], %, $seg01) // ln-should-get-tag
  |> angledLineToX([
       -angleToMatchLengthX(seg01, myVar, %),
       myVar
     ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> angledLineToY([
       -angleToMatchLengthY(seg01, myVar, %),
       myVar
     ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_array_new_line_in_pipe_custom() {
        let some_program_string = r#"const myVar = 3
const myVar2 = 5
const myVar3 = 6
const myAng = 40
const myAng2 = 134
const part001 = startSketchOn('XY')
   |> startProfileAt([0, 0], %)
   |> line([1, 3.82], %, $seg01) // ln-should-get-tag
   |> angledLineToX([
         -angleToMatchLengthX(seg01, myVar, %),
         myVar
      ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
   |> angledLineToY([
         -angleToMatchLengthY(seg01, myVar, %),
         myVar
      ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(
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
        let some_program_string = r#"const part001 = startSketchOn('XY')
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
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let mut program = parser.ast().unwrap();
        program.rename_symbol("mySuperCoolPart", 6);

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const mySuperCoolPart = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [mySuperCoolPart, 0.0]
let blah = 1
const foo = false
let baz = { a: 1, part001: "thing" }

fn ghi = (part001) => {
  return part001
}
"#
        );
    }

    #[test]
    fn test_recast_after_rename_fn_args() {
        let some_program_string = r#"fn ghi = (x, y, z) => {
  return x
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let mut program = parser.ast().unwrap();
        program.rename_symbol("newName", 10);

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn ghi = (newName, y, z) => {
  return newName
}
"#
        );
    }

    #[test]
    fn test_recast_trailing_comma() {
        let some_program_string = r#"startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> arc({
    radius: 1,
    angle_start: 0,
    angle_end: 180,
  }, %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> arc({
       radius: 1,
       angle_start: 0,
       angle_end: 180
     }, %)
"#
        );
    }

    #[test]
    fn test_recast_negative_var() {
        let some_program_string = r#"const w = 20
const l = 8
const h = 10

const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const w = 20
const l = 8
const h = 10

const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment() {
        let some_program_string = r#"const w = 20
const l = 8
const h = 10

// This is my comment
// It has multiple lines
// And it's really long
const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const w = 20
const l = 8
const h = 10

// This is my comment
// It has multiple lines
// And it's really long
const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_recast_math_start_negative() {
        let some_program_string = r#"const myVar = -5 + 6"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_recast_math_negate_parens() {
        let some_program_string = r#"const wallMountL = 3.82
const thickness = 0.5

startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, -(wallMountL - thickness)], %)
  |> line([0, -(5 - thickness)], %)
  |> line([0, -(5 - 1)], %)
  |> line([0, -(-5 - 1)], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_recast_math_nested_parens() {
        let some_program_string = r#"const distance = 5
const p = 3
const FOS = 2
const sigmaAllow = 8
const width = 20
const thickness = sqrt(distance * p * FOS * 6 / (sigmaAllow * width))"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
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
            let tokens = crate::token::lexer(raw).unwrap();
            let literal = crate::parser::parser_impl::unsigned_number_literal
                .parse(&tokens)
                .unwrap();
            assert_eq!(
                literal.recast(),
                expected,
                "failed test {i}, which is testing that {reason}"
            );
        }
    }

    #[test]
    fn recast_objects_no_comments() {
        let input = r#"
const sketch002 = startSketchOn({
       plane: {
    origin: { x: 1, y: 2, z: 3 },
    x_axis: { x: 4, y: 5, z: 6 },
    y_axis: { x: 7, y: 8, z: 9 },
    z_axis: { x: 10, y: 11, z: 12 }
       }
  })
"#;
        let expected = r#"const sketch002 = startSketchOn({
  plane: {
    origin: { x: 1, y: 2, z: 3 },
    x_axis: { x: 4, y: 5, z: 6 },
    y_axis: { x: 7, y: 8, z: 9 },
    z_axis: { x: 10, y: 11, z: 12 }
  }
})
"#;
        let tokens = crate::token::lexer(input).unwrap();
        let p = crate::parser::Parser::new(tokens);
        let ast = p.ast().unwrap();
        let actual = ast.recast(&FormatOptions::new(), 0);
        assert_eq!(actual, expected);
    }

    #[test]
    fn recast_objects_with_comments() {
        use winnow::Parser;
        for (i, (input, expected, reason)) in [(
            "\
{
  a: 1,
  // b: 2,
  c: 3
}",
            "\
{
  a: 1,
  // b: 2,
  c: 3
}",
            "preserves comments",
        )]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::token::lexer(input).unwrap();
            crate::parser::parser_impl::print_tokens(&tokens);
            let expr = crate::parser::parser_impl::object.parse(&tokens).unwrap();
            assert_eq!(
                expr.recast(&FormatOptions::new(), 0, false),
                expected,
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
            let tokens = crate::token::lexer(input).unwrap();
            let expr = crate::parser::parser_impl::array_elem_by_elem.parse(&tokens).unwrap();
            assert_eq!(
                expr.recast(&FormatOptions::new(), 0, false),
                expected,
                "failed test {i}, which is testing that recasting {reason}"
            );
        }
    }
}
