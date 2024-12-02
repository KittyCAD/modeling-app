use sha2::{Digest as DigestTrait, Sha256};

use super::types::{ItemVisibility, VariableKind};
use crate::parsing::ast::types::{
    ArrayExpression, ArrayRangeExpression, BinaryExpression, BinaryPart, BodyItem, CallExpression, CallExpressionKw,
    CommentStyle, ElseIf, Expr, ExpressionStatement, FnArgType, FunctionExpression, Identifier, IfExpression,
    ImportItem, ImportStatement, Literal, LiteralIdentifier, MemberExpression, MemberObject, NonCodeMeta, NonCodeNode,
    NonCodeValue, ObjectExpression, ObjectProperty, Parameter, PipeExpression, PipeSubstitution, Program,
    ReturnStatement, TagDeclarator, UnaryExpression, VariableDeclaration, VariableDeclarator,
};

/// Position-independent digest of the AST node.
pub type Digest = [u8; 32];

macro_rules! compute_digest {
    (|$slf:ident, $hasher:ident| $body:block) => {
        /// Compute a digest over the AST node.
        pub fn compute_digest(&mut self) -> Digest {
            if let Some(node_digest) = self.digest {
                return node_digest;
            }

            let mut $hasher = Sha256::new();

            #[allow(unused_mut)]
            let mut $slf = self;

            $hasher.update(std::any::type_name::<Self>());

            $body

            let node_digest: Digest = $hasher.finalize().into();
            $slf.digest = Some(node_digest);
            node_digest
        }
    };
}

impl ImportItem {
    compute_digest!(|slf, hasher| {
        let name = slf.name.name.as_bytes();
        hasher.update(name.len().to_ne_bytes());
        hasher.update(name);
        if let Some(alias) = &mut slf.alias {
            hasher.update([1]);
            hasher.update(alias.compute_digest());
        } else {
            hasher.update([0]);
        }
    });
}

impl ImportStatement {
    compute_digest!(|slf, hasher| {
        for item in &mut slf.items {
            hasher.update(item.compute_digest());
        }
        let path = slf.path.as_bytes();
        hasher.update(path.len().to_ne_bytes());
        hasher.update(path);
    });
}

impl Program {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.body.len().to_ne_bytes());
        for body_item in slf.body.iter_mut() {
            hasher.update(body_item.compute_digest());
        }
        if let Some(shebang) = &slf.shebang {
            hasher.update(&shebang.inner.content);
        }
        hasher.update(slf.non_code_meta.compute_digest());
    });
}

impl BodyItem {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            BodyItem::ImportStatement(s) => s.compute_digest(),
            BodyItem::ExpressionStatement(es) => es.compute_digest(),
            BodyItem::VariableDeclaration(vs) => vs.compute_digest(),
            BodyItem::ReturnStatement(rs) => rs.compute_digest(),
        }
    }
}

impl Expr {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            Expr::Literal(lit) => lit.compute_digest(),
            Expr::Identifier(id) => id.compute_digest(),
            Expr::TagDeclarator(tag) => tag.compute_digest(),
            Expr::BinaryExpression(be) => be.compute_digest(),
            Expr::FunctionExpression(fe) => fe.compute_digest(),
            Expr::CallExpression(ce) => ce.compute_digest(),
            Expr::CallExpressionKw(ce) => ce.compute_digest(),
            Expr::PipeExpression(pe) => pe.compute_digest(),
            Expr::PipeSubstitution(ps) => ps.compute_digest(),
            Expr::ArrayExpression(ae) => ae.compute_digest(),
            Expr::ArrayRangeExpression(are) => are.compute_digest(),
            Expr::ObjectExpression(oe) => oe.compute_digest(),
            Expr::MemberExpression(me) => me.compute_digest(),
            Expr::UnaryExpression(ue) => ue.compute_digest(),
            Expr::IfExpression(e) => e.compute_digest(),
            Expr::None(_) => {
                let mut hasher = Sha256::new();
                hasher.update(b"Value::None");
                hasher.finalize().into()
            }
        }
    }
}

impl BinaryPart {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            BinaryPart::Literal(lit) => lit.compute_digest(),
            BinaryPart::Identifier(id) => id.compute_digest(),
            BinaryPart::BinaryExpression(be) => be.compute_digest(),
            BinaryPart::CallExpression(ce) => ce.compute_digest(),
            BinaryPart::CallExpressionKw(ce) => ce.compute_digest(),
            BinaryPart::UnaryExpression(ue) => ue.compute_digest(),
            BinaryPart::MemberExpression(me) => me.compute_digest(),
            BinaryPart::IfExpression(e) => e.compute_digest(),
        }
    }
}

impl MemberObject {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            MemberObject::MemberExpression(me) => me.compute_digest(),
            MemberObject::Identifier(id) => id.compute_digest(),
        }
    }
}

impl LiteralIdentifier {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            LiteralIdentifier::Identifier(id) => id.compute_digest(),
            LiteralIdentifier::Literal(lit) => lit.compute_digest(),
        }
    }
}
impl FnArgType {
    pub fn compute_digest(&mut self) -> Digest {
        let mut hasher = Sha256::new();

        match self {
            FnArgType::Primitive(prim) => {
                hasher.update(b"FnArgType::Primitive");
                hasher.update(prim.digestable_id())
            }
            FnArgType::Array(prim) => {
                hasher.update(b"FnArgType::Array");
                hasher.update(prim.digestable_id())
            }
            FnArgType::Object { properties } => {
                hasher.update(b"FnArgType::Object");
                hasher.update(properties.len().to_ne_bytes());
                for prop in properties.iter_mut() {
                    hasher.update(prop.compute_digest());
                }
            }
        }

        hasher.finalize().into()
    }
}
impl Parameter {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.identifier.compute_digest());
        match &mut slf.type_ {
            Some(arg) => {
                hasher.update(b"Parameter::type_::Some");
                hasher.update(arg.compute_digest())
            }
            None => {
                hasher.update(b"Parameter::type_::None");
            }
        }
        hasher.update(if slf.optional { [1] } else { [0] })
    });
}

impl FunctionExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.params.len().to_ne_bytes());
        for param in slf.params.iter_mut() {
            hasher.update(param.compute_digest());
        }
        hasher.update(slf.body.compute_digest());
        match &mut slf.return_type {
            Some(rt) => {
                hasher.update(b"FunctionExpression::return_type::Some");
                hasher.update(rt.compute_digest());
            }
            None => {
                hasher.update(b"FunctionExpression::return_type::None");
            }
        }
    });
}

impl ReturnStatement {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.argument.compute_digest());
    });
}

impl CommentStyle {
    fn digestable_id(&self) -> [u8; 2] {
        match &self {
            CommentStyle::Line => *b"//",
            CommentStyle::Block => *b"/*",
        }
    }
}

impl NonCodeNode {
    compute_digest!(|slf, hasher| {
        match &slf.value {
            NonCodeValue::InlineComment { value, style } => {
                hasher.update(value);
                hasher.update(style.digestable_id());
            }
            NonCodeValue::BlockComment { value, style } => {
                hasher.update(value);
                hasher.update(style.digestable_id());
            }
            NonCodeValue::NewLineBlockComment { value, style } => {
                hasher.update(value);
                hasher.update(style.digestable_id());
            }
            NonCodeValue::NewLine => {
                hasher.update(b"\r\n");
            }
        }
    });
}

impl NonCodeMeta {
    compute_digest!(|slf, hasher| {
        let mut keys = slf.non_code_nodes.keys().copied().collect::<Vec<_>>();
        keys.sort();

        for key in keys.into_iter() {
            hasher.update(key.to_ne_bytes());
            let nodes = slf.non_code_nodes.get_mut(&key).unwrap();
            hasher.update(nodes.len().to_ne_bytes());
            for node in nodes.iter_mut() {
                hasher.update(node.compute_digest());
            }
        }
    });
}

impl ExpressionStatement {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.expression.compute_digest());
    });
}

impl VariableDeclaration {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.declarations.len().to_ne_bytes());
        for declarator in &mut slf.declarations {
            hasher.update(declarator.compute_digest());
        }
        hasher.update(slf.visibility.digestable_id());
        hasher.update(slf.kind.digestable_id());
    });
}

impl VariableKind {
    fn digestable_id(&self) -> [u8; 1] {
        match self {
            VariableKind::Const => [2],
            VariableKind::Fn => [3],
        }
    }
}

impl ItemVisibility {
    fn digestable_id(&self) -> [u8; 1] {
        match self {
            ItemVisibility::Default => [0],
            ItemVisibility::Export => [1],
        }
    }
}

impl VariableDeclarator {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.id.compute_digest());
        hasher.update(slf.init.compute_digest());
    });
}

impl Literal {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.value.digestable_id());
    });
}

impl Identifier {
    compute_digest!(|slf, hasher| {
        let name = slf.name.as_bytes();
        hasher.update(name.len().to_ne_bytes());
        hasher.update(name);
    });
}

impl TagDeclarator {
    compute_digest!(|slf, hasher| {
        let name = slf.name.as_bytes();
        hasher.update(name.len().to_ne_bytes());
        hasher.update(name);
    });
}

impl PipeSubstitution {
    compute_digest!(|slf, hasher| {
        hasher.update(b"PipeSubstitution");
    });
}

impl ArrayExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.elements.len().to_ne_bytes());
        for value in slf.elements.iter_mut() {
            hasher.update(value.compute_digest());
        }
    });
}

impl ArrayRangeExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.start_element.compute_digest());
        hasher.update(slf.end_element.compute_digest());
    });
}

impl ObjectExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.properties.len().to_ne_bytes());
        for prop in slf.properties.iter_mut() {
            hasher.update(prop.compute_digest());
        }
    });
}

impl ObjectProperty {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.key.compute_digest());
        hasher.update(slf.value.compute_digest());
    });
}

impl MemberExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.object.compute_digest());
        hasher.update(slf.property.compute_digest());
        hasher.update(if slf.computed { [1] } else { [0] });
    });
}

impl BinaryExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.operator.digestable_id());
        hasher.update(slf.left.compute_digest());
        hasher.update(slf.right.compute_digest());
    });
}

impl UnaryExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.operator.digestable_id());
        hasher.update(slf.argument.compute_digest());
    });
}

impl PipeExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.body.len().to_ne_bytes());
        for value in slf.body.iter_mut() {
            hasher.update(value.compute_digest());
        }
        hasher.update(slf.non_code_meta.compute_digest());
    });
}

impl CallExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.callee.compute_digest());
        hasher.update(slf.arguments.len().to_ne_bytes());
        for argument in slf.arguments.iter_mut() {
            hasher.update(argument.compute_digest());
        }
    });
}

impl CallExpressionKw {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.callee.compute_digest());
        if let Some(ref mut unlabeled) = slf.unlabeled {
            hasher.update(unlabeled.compute_digest());
        } else {
            hasher.update("no_unlabeled");
        }
        hasher.update(slf.arguments.len().to_ne_bytes());
        for argument in slf.arguments.iter_mut() {
            hasher.update(argument.label.compute_digest());
            hasher.update(argument.arg.compute_digest());
        }
    });
}

impl IfExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.cond.compute_digest());
        hasher.update(slf.then_val.compute_digest());
        for else_if in &mut slf.else_ifs {
            hasher.update(else_if.compute_digest());
        }
        hasher.update(slf.final_else.compute_digest());
    });
}
impl ElseIf {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.cond.compute_digest());
        hasher.update(slf.then_val.compute_digest());
    });
}

#[cfg(test)]
mod test {
    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_digest() {
        let prog1_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %)
"#;
        let prog1_digest = crate::parsing::top_level_parse(prog1_string).unwrap().compute_digest();

        let prog2_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 2], %)
    |> line([5, 5], %)
"#;
        let prog2_digest = crate::parsing::top_level_parse(prog2_string).unwrap().compute_digest();

        assert!(prog1_digest != prog2_digest);

        let prog3_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %)
"#;
        let prog3_digest = crate::parsing::top_level_parse(prog3_string).unwrap().compute_digest();

        assert_eq!(prog1_digest, prog3_digest);
    }
}
