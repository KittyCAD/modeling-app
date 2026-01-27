use sha2::{Digest as DigestTrait, Sha256};

use crate::parsing::ast::types::{
    Annotation, ArrayExpression, ArrayRangeExpression, AscribedExpression, BinaryExpression, BinaryPart, Block,
    BodyItem, CallExpressionKw, DefaultParamVal, ElseIf, Expr, ExpressionStatement, FunctionExpression, FunctionType,
    Identifier, IfExpression, ImportItem, ImportSelector, ImportStatement, ItemVisibility, KclNone, LabelledExpression,
    Literal, LiteralValue, MemberExpression, Name, Node, NumericLiteral, ObjectExpression, ObjectProperty, Parameter,
    PipeExpression, PipeSubstitution, PrimitiveType, Program, ReturnStatement, SketchBlock, SketchVar, TagDeclarator,
    Type, TypeDeclaration, UnaryExpression, VariableDeclaration, VariableDeclarator, VariableKind,
};

/// Position-independent digest of the AST node.
pub type Digest = [u8; 32];

/// Macro to implement `compute_digest` for AST nodes. If you update this, you
/// probably want to update the no_attrs version as well.
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
            for attr in &mut $slf.outer_attrs {
                $hasher.update(attr.compute_digest());
            }

            $hasher.update(std::any::type_name::<Self>());

            $body

            let node_digest: Digest = $hasher.finalize().into();
            $slf.digest = Some(node_digest);
            node_digest
        }
    };
}

/// Macro to implement `compute_digest` for AST nodes without outer attributes.
/// You should always prefer the version with attributes, unless the AST node
/// type *never* has them. If you update this, you probably want to update the
/// attrs version as well.
macro_rules! compute_digest_no_attrs {
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

impl Node<ImportItem> {
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

impl Node<ImportStatement> {
    compute_digest!(|slf, hasher| {
        match &mut slf.selector {
            ImportSelector::List { items } => {
                for item in items {
                    hasher.update(item.compute_digest());
                }
            }
            ImportSelector::Glob(_) => hasher.update(b"ImportSelector::Glob"),
            ImportSelector::None { alias: None } => hasher.update(b"ImportSelector::None"),
            ImportSelector::None { alias: Some(alias) } => {
                hasher.update(b"ImportSelector::None");
                hasher.update(alias.compute_digest());
            }
        }
        hasher.update(slf.visibility.digestable_id());
        let path = slf.path.to_string();
        let path = path.as_bytes();
        hasher.update(path.len().to_ne_bytes());
        hasher.update(path);
    });
}

impl Node<Program> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.body.len().to_ne_bytes());
        for body_item in slf.body.iter_mut() {
            hasher.update(body_item.compute_digest());
        }
        for attr in &mut slf.inner_attrs {
            hasher.update(attr.compute_digest());
        }
        if let Some(shebang) = &slf.shebang {
            hasher.update(&shebang.inner.content);
        }
    });
}

impl Node<Annotation> {
    pub fn compute_digest(&mut self) -> Digest {
        let mut hasher = Sha256::new();
        if let Some(name) = &mut self.name {
            hasher.update(name.compute_digest());
        }
        if let Some(properties) = &mut self.properties {
            hasher.update(properties.len().to_ne_bytes());
            for property in properties.iter_mut() {
                hasher.update(property.compute_digest());
            }
        } else {
            hasher.update("no_properties");
        }
        hasher.finalize().into()
    }
}

impl BodyItem {
    pub fn compute_digest(&mut self) -> Digest {
        let mut hasher = Sha256::new();
        hasher.update(match self {
            BodyItem::ImportStatement(s) => s.compute_digest(),
            BodyItem::ExpressionStatement(es) => es.compute_digest(),
            BodyItem::VariableDeclaration(vs) => vs.compute_digest(),
            BodyItem::TypeDeclaration(t) => t.compute_digest(),
            BodyItem::ReturnStatement(rs) => rs.compute_digest(),
        });

        for a in self.get_attrs_mut() {
            hasher.update(a.compute_digest());
        }
        hasher.finalize().into()
    }
}

impl Expr {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            Expr::Literal(lit) => lit.compute_digest(),
            Expr::Name(id) => id.compute_digest(),
            Expr::TagDeclarator(tag) => tag.compute_digest(),
            Expr::BinaryExpression(be) => be.compute_digest(),
            Expr::FunctionExpression(fe) => fe.compute_digest(),
            Expr::CallExpressionKw(ce) => ce.compute_digest(),
            Expr::PipeExpression(pe) => pe.compute_digest(),
            Expr::PipeSubstitution(ps) => ps.compute_digest(),
            Expr::ArrayExpression(ae) => ae.compute_digest(),
            Expr::ArrayRangeExpression(are) => are.compute_digest(),
            Expr::ObjectExpression(oe) => oe.compute_digest(),
            Expr::MemberExpression(me) => me.compute_digest(),
            Expr::UnaryExpression(ue) => ue.compute_digest(),
            Expr::IfExpression(e) => e.compute_digest(),
            Expr::LabelledExpression(e) => e.compute_digest(),
            Expr::AscribedExpression(e) => e.compute_digest(),
            Expr::SketchBlock(e) => e.compute_digest(),
            Expr::SketchVar(e) => e.compute_digest(),
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
            BinaryPart::Name(id) => id.compute_digest(),
            BinaryPart::BinaryExpression(be) => be.compute_digest(),
            BinaryPart::CallExpressionKw(ce) => ce.compute_digest(),
            BinaryPart::UnaryExpression(ue) => ue.compute_digest(),
            BinaryPart::MemberExpression(me) => me.compute_digest(),
            BinaryPart::ArrayExpression(e) => e.compute_digest(),
            BinaryPart::ArrayRangeExpression(e) => e.compute_digest(),
            BinaryPart::ObjectExpression(e) => e.compute_digest(),
            BinaryPart::IfExpression(e) => e.compute_digest(),
            BinaryPart::AscribedExpression(e) => e.compute_digest(),
            BinaryPart::SketchVar(e) => e.compute_digest(),
        }
    }
}

impl Type {
    pub fn compute_digest(&mut self) -> Digest {
        let mut hasher = Sha256::new();

        match self {
            Type::Primitive(prim) => {
                hasher.update(b"FnArgType::Primitive");
                hasher.update(prim.compute_digest())
            }
            Type::Array { ty, len } => {
                hasher.update(b"FnArgType::Array");
                hasher.update(ty.compute_digest());
                match len {
                    crate::execution::types::ArrayLen::None => {}
                    crate::execution::types::ArrayLen::Minimum(n) => hasher.update((-(*n as isize)).to_ne_bytes()),
                    crate::execution::types::ArrayLen::Known(n) => hasher.update(n.to_ne_bytes()),
                }
            }
            Type::Union { tys } => {
                hasher.update(b"FnArgType::Union");
                hasher.update(tys.len().to_ne_bytes());
                for t in tys.iter_mut() {
                    hasher.update(t.compute_digest());
                }
            }
            Type::Object { properties } => {
                hasher.update(b"FnArgType::Object");
                hasher.update(properties.len().to_ne_bytes());
                for (id, ty) in properties.iter_mut() {
                    hasher.update(id.compute_digest());
                    hasher.update(ty.compute_digest());
                }
            }
        }

        hasher.finalize().into()
    }
}

impl PrimitiveType {
    pub fn compute_digest(&mut self) -> Digest {
        let mut hasher = Sha256::new();
        match self {
            PrimitiveType::Any => hasher.update(b"any"),
            PrimitiveType::None => hasher.update(b"none"),
            PrimitiveType::Named { id } => hasher.update(id.compute_digest()),
            PrimitiveType::String => hasher.update(b"string"),
            PrimitiveType::Number(suffix) => hasher.update(suffix.digestable_id()),
            PrimitiveType::Boolean => hasher.update(b"bool"),
            PrimitiveType::TagDecl => hasher.update(b"TagDecl"),
            PrimitiveType::ImportedGeometry => hasher.update(b"ImportedGeometry"),
            PrimitiveType::Function(f) => hasher.update(f.compute_digest()),
        }

        hasher.finalize().into()
    }
}

impl FunctionType {
    compute_digest_no_attrs!(|slf, hasher| {
        if let Some(u) = &mut slf.unnamed_arg {
            hasher.update(u.compute_digest());
        }
        slf.named_args.iter_mut().for_each(|(a, t)| {
            a.compute_digest();
            t.compute_digest();
        });
        if let Some(r) = &mut slf.return_type {
            hasher.update(r.compute_digest());
        }
    });
}

impl Parameter {
    compute_digest_no_attrs!(|slf, hasher| {
        hasher.update(slf.identifier.compute_digest());
        match &mut slf.param_type {
            Some(arg) => {
                hasher.update(b"Parameter::type_::Some");
                hasher.update(arg.compute_digest())
            }
            None => {
                hasher.update(b"Parameter::type_::None");
            }
        }
        match slf.default_value {
            None => hasher.update(vec![0]),
            Some(DefaultParamVal::KclNone(ref _kcl_none)) => hasher.update(vec![1]),
            Some(DefaultParamVal::Literal(ref mut literal)) => hasher.update(literal.compute_digest()),
        }
    });
}

impl Node<KclNone> {
    compute_digest!(|slf, hasher| {
        hasher.update(b"KclNone");
    });
}

impl Node<FunctionExpression> {
    compute_digest!(|slf, hasher| {
        if let Some(name) = &mut slf.name {
            hasher.update(name.compute_digest());
        } else {
            hasher.update(b"FunctionExpression::name::None");
        }
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

impl Node<ReturnStatement> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.argument.compute_digest());
    });
}

impl Node<ExpressionStatement> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.expression.compute_digest());
    });
}

impl Node<VariableDeclaration> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.declaration.compute_digest());
        hasher.update(slf.visibility.digestable_id());
        hasher.update(slf.kind.digestable_id());
    });
}

impl Node<TypeDeclaration> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.name.compute_digest());
        if let Some(args) = &mut slf.args {
            hasher.update([1]);
            for a in args {
                hasher.update(a.compute_digest());
            }
        }
        if let Some(alias) = &mut slf.alias {
            hasher.update(alias.compute_digest());
        }
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

impl Node<VariableDeclarator> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.id.compute_digest());
        hasher.update(slf.init.compute_digest());
    });
}

impl NumericLiteral {
    fn digestable_id(&self) -> Vec<u8> {
        let mut result: Vec<u8> = self.value.to_ne_bytes().into();
        result.extend((self.suffix as u32).to_ne_bytes());
        result
    }
}

impl Node<Literal> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.value.digestable_id());
    });
}

impl LiteralValue {
    fn digestable_id(&self) -> Vec<u8> {
        match self {
            LiteralValue::Number { value, suffix } => {
                let mut result: Vec<u8> = value.to_ne_bytes().into();
                result.extend((*suffix as u32).to_ne_bytes());
                result
            }
            LiteralValue::String(st) => st.as_bytes().into(),
            LiteralValue::Bool(b) => {
                if *b {
                    vec![1]
                } else {
                    vec![0]
                }
            }
        }
    }
}

impl Node<Identifier> {
    compute_digest!(|slf, hasher| {
        let name = slf.name.as_bytes();
        hasher.update(name.len().to_ne_bytes());
        hasher.update(name);
    });
}

impl Node<Name> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.name.compute_digest());
        for p in &mut slf.path {
            hasher.update(p.compute_digest());
        }
        if slf.abs_path {
            hasher.update([1]);
        }
    });
}
impl Node<TagDeclarator> {
    compute_digest!(|slf, hasher| {
        let name = slf.name.as_bytes();
        hasher.update(name.len().to_ne_bytes());
        hasher.update(name);
    });
}

impl Node<PipeSubstitution> {
    compute_digest!(|slf, hasher| {
        hasher.update(b"PipeSubstitution");
    });
}

impl Node<ArrayExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.elements.len().to_ne_bytes());
        for value in slf.elements.iter_mut() {
            hasher.update(value.compute_digest());
        }
    });
}

impl Node<ArrayRangeExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.start_element.compute_digest());
        hasher.update(slf.end_element.compute_digest());
        hasher.update(if slf.end_inclusive { [1] } else { [0] });
    });
}

impl Node<ObjectExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.properties.len().to_ne_bytes());
        for prop in slf.properties.iter_mut() {
            hasher.update(prop.compute_digest());
        }
    });
}

impl Node<ObjectProperty> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.key.compute_digest());
        hasher.update(slf.value.compute_digest());
    });
}

impl Node<MemberExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.object.compute_digest());
        hasher.update(slf.property.compute_digest());
        hasher.update(if slf.computed { [1] } else { [0] });
    });
}

impl Node<BinaryExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.operator.digestable_id());
        hasher.update(slf.left.compute_digest());
        hasher.update(slf.right.compute_digest());
    });
}

impl Node<UnaryExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.operator.digestable_id());
        hasher.update(slf.argument.compute_digest());
    });
}

impl Node<LabelledExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.expr.compute_digest());
        hasher.update(slf.label.compute_digest());
    });
}

impl Node<AscribedExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.expr.compute_digest());
        hasher.update(slf.ty.compute_digest());
    });
}

impl Node<PipeExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.body.len().to_ne_bytes());
        for value in slf.body.iter_mut() {
            hasher.update(value.compute_digest());
        }
    });
}

impl Node<CallExpressionKw> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.callee.compute_digest());
        if let Some(ref mut unlabeled) = slf.unlabeled {
            hasher.update(unlabeled.compute_digest());
        } else {
            hasher.update("no_unlabeled");
        }
        hasher.update(slf.arguments.len().to_ne_bytes());
        for argument in slf.arguments.iter_mut() {
            if let Some(l) = &mut argument.label {
                hasher.update(l.compute_digest());
            }
            hasher.update(argument.arg.compute_digest());
        }
    });
}

impl Node<IfExpression> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.cond.compute_digest());
        hasher.update(slf.then_val.compute_digest());
        for else_if in &mut slf.else_ifs {
            hasher.update(else_if.compute_digest());
        }
        hasher.update(slf.final_else.compute_digest());
    });
}
impl Node<ElseIf> {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.cond.compute_digest());
        hasher.update(slf.then_val.compute_digest());
    });
}

impl Node<SketchBlock> {
    compute_digest!(|slf, hasher| {
        for argument in &mut slf.arguments {
            if let Some(l) = &mut argument.label {
                hasher.update(l.compute_digest());
            }
            hasher.update(argument.arg.compute_digest());
        }
        hasher.update(slf.body.compute_digest());
        hasher.update(if slf.is_being_edited { [1] } else { [0] });
    });
}

impl Node<Block> {
    compute_digest!(|slf, hasher| {
        for item in &mut slf.items {
            hasher.update(item.compute_digest());
        }
    });
}

impl Node<SketchVar> {
    compute_digest!(|slf, hasher| {
        if let Some(initial) = &slf.initial {
            hasher.update(initial.digestable_id());
        } else {
            hasher.update("no_initial");
        }
    });
}

#[cfg(test)]
mod test {
    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_digest() {
        let prog1_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line([5, 5])
"#;
        let prog1_digest = crate::parsing::top_level_parse(prog1_string).unwrap().compute_digest();

        let prog2_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 2])
    |> line([5, 5])
"#;
        let prog2_digest = crate::parsing::top_level_parse(prog2_string).unwrap().compute_digest();

        assert!(prog1_digest != prog2_digest);

        let prog3_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line([5, 5])
"#;
        let prog3_digest = crate::parsing::top_level_parse(prog3_string).unwrap().compute_digest();

        assert_eq!(prog1_digest, prog3_digest);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_annotations_digest() {
        // Settings annotations should be included in the digest.
        let prog1_string = r#"@settings(defaultLengthUnit = in)
startSketchOn(XY)
"#;
        let prog1_digest = crate::parsing::top_level_parse(prog1_string).unwrap().compute_digest();

        let prog2_string = r#"@settings(defaultLengthUnit = mm)
startSketchOn(XY)
"#;
        let prog2_digest = crate::parsing::top_level_parse(prog2_string).unwrap().compute_digest();

        assert!(prog1_digest != prog2_digest);
    }
}
