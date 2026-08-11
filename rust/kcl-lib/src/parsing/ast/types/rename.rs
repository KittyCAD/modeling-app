//! Renaming of symbols: variable declarations, imports, function parameters, and sketch
//! block declarations, along with all references to them.
//!
//! Renaming follows the executor's semantics: references are renamed in evaluation order and
//! stop at anything that rebinds the name (declarations, parameters, tags, labels, named
//! function expressions, imports), the module and value namespaces are kept separate, and
//! region tag references follow the executor's region provenance rules. New names are
//! validated for identifier syntax and same-scope collisions; capture across scopes is not
//! analyzed (see [`Node<Program>::rename_symbol`]).

use super::*;
use crate::ModuleId;
use crate::SourceRange;

impl Node<Program> {
    /// Rename the variable declaration at the given position.
    pub fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Result<(), String> {
        // The new name must be usable as a binding name, and must not collide with a binding
        // in the target's own scope (checked per target below). No capture analysis is done
        // across scopes: renaming can still change what a reference resolves to when the new
        // name shadows or is shadowed by a binding in a nested or enclosing scope (e.g.
        // renaming a global to the name of some function's local leaves references inside
        // that function resolving to the local). Detecting that would require resolving every
        // reference in every scope between the renamed binding and its uses.
        //
        // On error, the program may be left partially renamed; callers reparse or clone, so a
        // failed rename's program must be discarded.
        if !is_valid_binding_name(new_name) {
            return Err(format!("`{new_name}` is not a valid name"));
        }

        // The position must be within the variable declaration.
        let mut old_name = None;
        for (index, item) in self.body.iter_mut().enumerate() {
            match item {
                BodyItem::ImportStatement(stmt) => {
                    if let Some(var_old_name) = stmt.rename_symbol(new_name, pos) {
                        // A whole-module import (`import "m.kcl" as alias`) binds in the
                        // module namespace; list imports bind ordinary values.
                        let is_module = matches!(&stmt.selector, ImportSelector::None { .. });
                        old_name = Some((var_old_name, is_module, index));
                        break;
                    }
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    if let Some(var_old_name) = variable_declaration.rename_symbol(new_name, pos) {
                        old_name = Some((var_old_name, false, index));
                        break;
                    }
                }
                _ => {}
            }
        }

        if let Some((old_name, is_module, decl_index)) = old_name {
            if old_name != new_name {
                // A same-scope collision would change what other references resolve to. The
                // module and value namespaces are separate, so each kind only collides with
                // its own. The renamed item itself is excluded: it now binds the new name.
                let collides = self.body.iter().enumerate().any(|(index, item)| {
                    index != decl_index
                        && if is_module {
                            matches!(item, BodyItem::ImportStatement(import)
                                if import.module_name().as_deref() == Some(new_name))
                        } else {
                            body_item_binds_name(item, new_name)
                        }
                });
                if collides {
                    return Err(format!("the name `{new_name}` is already in use in this scope"));
                }
            }
            // Rename references, starting at the declaration: the executor binds sequentially,
            // so references before it resolve to something else (e.g. a same-named standard
            // library function). The executor resolves a bare name to the value namespace
            // first and falls back to the module namespace, so the same shadow-aware walk
            // applies to a module's bare references: they stop being the module's at a value
            // binding of the same name.
            rename_identifiers_in_body(&mut self.body[decl_index..], &old_name, new_name);
            if is_module {
                // Qualified references (`old::item`) resolve in the module namespace, which
                // has no nested scopes (the executor rejects non-root imports), so rename
                // heads everywhere after the import.
                rename_module_refs_in_body(&mut self.body[decl_index..], &old_name, new_name);
            }
            return Ok(());
        }

        // It might be a declaration inside a sketch block, or a reference to one.
        if self.rename_sketch_block_symbol(new_name, pos)? {
            return Ok(());
        }

        // Okay so this was not a top level variable declaration.
        // But it might be a variable declaration inside a function or function params.
        // So we need to check that.
        let Some(ref mut item) = self.get_mut_body_item_for_position(pos) else {
            return Ok(());
        };

        // Recurse over the item.
        let mut value = match item {
            BodyItem::ImportStatement(_) => None, // TODO
            BodyItem::ExpressionStatement(expression_statement) => Some(&mut expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_mut_expr_for_position(pos),
            BodyItem::TypeDeclaration(_) => None,
            BodyItem::ReturnStatement(return_statement) => Some(&mut return_statement.argument),
        };

        // Check if we have a function expression.
        if let Some(Expr::FunctionExpression(function_expression)) = &mut value {
            // Check if the params to the function expression contain the position.
            let target_index = function_expression
                .params
                .iter()
                .position(|param| SourceRange::from(&param.identifier).contains(pos));
            if let Some(target_index) = target_index {
                // The parameter's scope is the other parameters plus the function body.
                if function_expression.params[target_index].identifier.name != new_name
                    && (function_expression
                        .params
                        .iter()
                        .enumerate()
                        .any(|(index, param)| index != target_index && param.identifier.name == new_name)
                        || function_expression
                            .body
                            .body
                            .iter()
                            .any(|item| body_item_binds_name(item, new_name)))
                {
                    return Err(format!("the name `{new_name}` is already in use in this scope"));
                }
                let param = &mut function_expression.params[target_index];
                let old_name = std::mem::replace(&mut param.identifier.name, new_name.to_owned());
                // Now rename all the identifiers in the function's body.
                function_expression.body.rename_identifiers(&old_name, new_name);
            }
        }
        Ok(())
    }

    /// Rename a symbol declared inside a sketch block, if `pos` is on such a declaration or on
    /// a reference to one: either a use inside the block, or the property of a member
    /// reference like `mySketch.line1`. The sketch block can be in any scope: top-level, or
    /// inside a function body at any depth. Renames the declaration, uses inside the block,
    /// member references on the sketch variable, and `.tags` member references on regions
    /// derived from the sketch, all within the scope where the sketch variable is declared.
    /// Returns false if `pos` doesn't resolve to a sketch block symbol.
    fn rename_sketch_block_symbol(&mut self, new_name: &str, pos: usize) -> Result<bool, String> {
        let mut candidates = self.sketch_symbol_candidates_at_pos(pos);
        if candidates.is_empty() {
            return Ok(false);
        }
        let handled = rename_sketch_symbol_in_body(&mut self.body, &mut candidates, new_name, pos, false);
        if let Some(error) = candidates.error.take() {
            return Err(error);
        }
        Ok(handled)
    }

    /// Find what `pos` is on, as candidates for resolving a sketch block symbol: the
    /// identifier at `pos` (a declaration or use), the member reference `x.prop` whose
    /// property is at `pos`, or the region tag reference `r.tags.prop` whose property is at
    /// `pos`.
    fn sketch_symbol_candidates_at_pos(&self, pos: usize) -> SketchSymbolCandidates {
        use crate::walk::Node as WalkNode;
        use crate::walk::Walker;

        let decl_id_at_pos = std::cell::RefCell::new(None::<String>);
        let bare_use_at_pos = std::cell::RefCell::new(None::<String>);
        let member_at_pos = std::cell::RefCell::new(None::<(String, String)>);
        let tags_member_at_pos = std::cell::RefCell::new(None::<(String, String)>);
        let pos_is_member_property = std::cell::Cell::new(false);
        let finder = |node: WalkNode<'_>| -> Result<bool, anyhow::Error> {
            match node {
                // Only a reference (a bare name) or a declaration's id can identify a sketch
                // block symbol. Other identifiers at the position, like function parameters
                // and expression labels, bind different symbols; matching them would rename an
                // unrelated same-named declaration.
                WalkNode::Name(name) => {
                    if SourceRange::from(name).contains(pos)
                        && let Some(local) = name.local_ident()
                    {
                        *bare_use_at_pos.borrow_mut() = Some(local.inner.to_owned());
                    }
                }
                WalkNode::VariableDeclarator(decl) => {
                    if SourceRange::from(&decl.id).contains(pos) {
                        *decl_id_at_pos.borrow_mut() = Some(decl.id.name.clone());
                    }
                }
                WalkNode::MemberExpression(member) => {
                    if !member.computed
                        && let Expr::Name(property) = &member.property
                        && SourceRange::from(&**property).contains(pos)
                        && let Some(property) = property.local_ident()
                    {
                        // The name at the position is a field or tag access, not a bare
                        // reference; the member and tags candidates below carry it when the
                        // object shape is recognized.
                        pos_is_member_property.set(true);
                        match &member.object {
                            Expr::Name(object) => {
                                if let Some(object) = object.local_ident() {
                                    *member_at_pos.borrow_mut() =
                                        Some((object.inner.to_owned(), property.inner.to_owned()));
                                }
                            }
                            Expr::MemberExpression(inner) => {
                                if !inner.computed
                                    && let Expr::Name(region) = &inner.object
                                    && let Some(region) = region.local_ident()
                                    && matches!(&inner.property, Expr::Name(t) if t.local_ident().is_some_and(|t| t.inner == "tags"))
                                {
                                    *tags_member_at_pos.borrow_mut() =
                                        Some((region.inner.to_owned(), property.inner.to_owned()));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
            Ok(true)
        };
        for item in &self.body {
            let _ = finder.walk(WalkNode::from(item));
        }
        SketchSymbolCandidates {
            decl_id: decl_id_at_pos.into_inner(),
            bare_use: if pos_is_member_property.get() {
                None
            } else {
                bare_use_at_pos.into_inner()
            },
            member: member_at_pos.into_inner(),
            tags_member: tags_member_at_pos.into_inner(),
            region: None,
            std_region_shadowed: false,
            error: None,
        }
    }
}

impl Program {
    /// Rename all identifiers that have the old name to the new given name. Returns whether
    /// the body rebinds the old name in the current environment; if-expression branches
    /// execute in the current environment, so this propagates to the enclosing walk.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        rename_identifiers_in_body(&mut self.body, old_name, new_name)
    }
}

impl BodyItem {
    /// Rename all identifiers that have the old name to the new given name. Returns whether
    /// this item rebinds the old name for what follows it.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        match self {
            BodyItem::ImportStatement(_) => {
                // Imports only bind names (item names, aliases, module names); they contain
                // no references to rename. Whether they rebind the old name in the value
                // namespace mirrors body_item_binds_name.
                body_item_binds_name(self, old_name)
            }
            BodyItem::ExpressionStatement(expression_statement) => {
                expression_statement.expression.rename_identifiers(old_name, new_name)
            }
            BodyItem::VariableDeclaration(variable_declaration) => {
                variable_declaration.rename_identifiers(old_name, new_name)
            }
            BodyItem::TypeDeclaration(_) => false,
            BodyItem::ReturnStatement(return_statement) => {
                return_statement.argument.rename_identifiers(old_name, new_name)
            }
        }
    }
}

impl Expr {
    /// Rename all identifiers that have the old name to the new given name.
    /// Rename all identifiers that have the old name to the new given name, following the
    /// executor's evaluation order: returns true as soon as something rebinds the old name (a
    /// tag declarator, an expression label, or a named function expression, which the
    /// executor binds the moment it evaluates them), so that references evaluated after the
    /// rebinding are left alone.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        match self {
            Expr::Literal(_literal) => false,
            Expr::Name(identifier) => {
                identifier.rename(old_name, new_name);
                false
            }
            Expr::TagDeclarator(tag) => {
                // TagDeclarators introduce new bindings. Renaming other symbols should not
                // rewrite the tag's identifier, but the executor binds the tag's name as soon
                // as it is evaluated, shadowing the name being renamed from here on.
                tag.name == old_name
            }
            Expr::BinaryExpression(binary_expression) => binary_expression.rename_identifiers(old_name, new_name),
            Expr::FunctionExpression(function_expression) => function_expression.rename_identifiers(old_name, new_name),
            Expr::CallExpressionKw(call_expression) => call_expression.rename_identifiers(old_name, new_name),
            Expr::PipeExpression(pipe_expression) => pipe_expression.rename_identifiers(old_name, new_name),
            Expr::PipeSubstitution(_) => false,
            Expr::ArrayExpression(array_expression) => array_expression.rename_identifiers(old_name, new_name),
            Expr::ArrayRangeExpression(array_range) => array_range.rename_identifiers(old_name, new_name),
            Expr::ObjectExpression(object_expression) => object_expression.rename_identifiers(old_name, new_name),
            Expr::MemberExpression(member_expression) => member_expression.rename_identifiers(old_name, new_name),
            Expr::UnaryExpression(unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            Expr::IfExpression(expr) => expr.rename_identifiers(old_name, new_name),
            Expr::LabelledExpression(expr) => {
                // The label binds after its expression evaluates.
                let bound = expr.expr.rename_identifiers(old_name, new_name);
                bound || expr.label.name == old_name
            }
            Expr::AscribedExpression(expr) => expr.expr.rename_identifiers(old_name, new_name),
            Expr::SketchBlock(expr) => expr.rename_identifiers(old_name, new_name),
            Expr::SketchVar(_) => false,
            Expr::None(_) => false,
        }
    }
}

impl BinaryPart {
    /// Rename all identifiers that have the old name to the new given name.
    /// Rename all identifiers that have the old name to the new given name, following the
    /// executor's evaluation order; see [Expr::rename_identifiers].
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        match self {
            BinaryPart::Literal(_literal) => false,
            BinaryPart::Name(identifier) => {
                identifier.rename(old_name, new_name);
                false
            }
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.rename_identifiers(old_name, new_name),
            BinaryPart::CallExpressionKw(call_expression) => call_expression.rename_identifiers(old_name, new_name),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            BinaryPart::MemberExpression(member_expression) => member_expression.rename_identifiers(old_name, new_name),
            BinaryPart::ArrayExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::ArrayRangeExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::ObjectExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::IfExpression(if_expression) => if_expression.rename_identifiers(old_name, new_name),
            BinaryPart::AscribedExpression(e) => e.expr.rename_identifiers(old_name, new_name),
            BinaryPart::SketchVar(_) => false,
        }
    }
}

impl Name {
    /// Rename all identifiers that have the old name to the new given name.
    /// Rename this name if it is a bare (unqualified) reference to the old name. The head of
    /// a qualified name (`foo::item`) is deliberately not touched: the executor resolves it
    /// in the module namespace, which is separate from ordinary values, so a value rename
    /// must not rewrite it. See [rename_module_refs_in_body] for the module namespace.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if let Some(n) = self.local_ident()
            && n.inner == old_name
        {
            self.name.name = new_name.to_owned();
        }
    }

    /// Rename the head segment of a qualified name (`foo::item`), which the executor resolves
    /// in the module namespace. Later segments are members within the module. An absolute
    /// path (`::foo::bar`) doesn't start with a module binding of this file.
    fn rename_module_head(&mut self, old_name: &str, new_name: &str) {
        if !self.abs_path
            && let Some(head) = self.path.first_mut()
            && head.name == old_name
        {
            head.name = new_name.to_owned();
        }
    }
}

impl Node<ImportItem> {
    fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        match &mut self.alias {
            Some(alias) => {
                let alias_source_range = SourceRange::from(&*alias);
                if !alias_source_range.contains(pos) {
                    return None;
                }
                let old_name = std::mem::replace(&mut alias.name, new_name.to_owned());
                Some(old_name)
            }
            None => {
                let use_source_range = SourceRange::from(&*self);
                if !use_source_range.contains(pos) {
                    return None;
                }
                // The import has no alias, so rename by adding one, e.g. `import foo from "m.kcl"`
                // becomes `import foo as bar from "m.kcl"`.
                let old_name = self.name.name.clone();
                self.alias = Some(Identifier::new(new_name));
                Some(old_name)
            }
        }
    }
}

impl ImportSelector {
    fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        match self {
            ImportSelector::List { items } => {
                for item in items {
                    let source_range = SourceRange::from(&*item);
                    if source_range.contains(pos) {
                        let old_name = item.rename_symbol(new_name, pos);
                        if old_name.is_some() {
                            return old_name;
                        }
                    }
                }
                None
            }
            ImportSelector::Glob(_) => None,
            ImportSelector::None { alias: None } => None,
            ImportSelector::None { alias: Some(alias) } => {
                let alias_source_range = SourceRange::from(&*alias);
                if !alias_source_range.contains(pos) {
                    return None;
                }
                let old_name = std::mem::replace(&mut alias.name, new_name.to_owned());
                Some(old_name)
            }
        }
    }
}

impl Node<ImportStatement> {
    fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        self.selector.rename_symbol(new_name, pos)
    }
}

impl CallExpressionKw {
    /// Rename all identifiers that have the old name to the new given name.
    /// Rename all identifiers that have the old name to the new given name. The executor
    /// evaluates arguments in order and binds tags immediately, so renaming stops at an
    /// argument that rebinds the old name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.callee.rename(old_name, new_name);

        if let Some(unlabeled) = &mut self.unlabeled
            && unlabeled.rename_identifiers(old_name, new_name)
        {
            return true;
        }

        for arg in &mut self.arguments {
            if arg.arg.rename_identifiers(old_name, new_name) {
                return true;
            }
        }
        false
    }
}

impl Node<VariableDeclaration> {
    /// Rename the variable declaration at the given position.
    /// This returns the old name of the variable, if it found one.
    fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        // The position must be within the variable declaration.
        let source_range: SourceRange = self.clone().into();
        if !source_range.contains(pos) {
            return None;
        }

        let declaration_source_range: SourceRange = self.declaration.id.clone().into();
        if declaration_source_range.contains(pos) {
            let old_name = std::mem::replace(&mut self.declaration.id.name, new_name.to_string());
            // A function declaration `fn foo() {}` also records its name on the function
            // expression; keep it in sync. A named function expression assigned to a variable
            // (`foo = fn bar() {}`) is a distinct binding and is left alone.
            if let Expr::FunctionExpression(func) = &mut self.declaration.init
                && let Some(fn_name) = &mut func.name
                && fn_name.name == old_name
            {
                fn_name.name = new_name.to_string();
            }
            return Some(old_name);
        }

        None
    }
}

impl VariableDeclaration {
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        // The declaration that was just renamed (its id is already the new name): the variable
        // is not bound inside its own initializer, since the value is created before the
        // variable is bound, so references to the old name there are not to this variable. The
        // exception is the `fn foo() {}` sugar, whose function name is kept in sync with the
        // declaration id; references in its body are the recursive binding and are renamed
        // along with it.
        if self.declaration.id.name == new_name {
            let is_fn_sugar = matches!(
                &self.declaration.init,
                Expr::FunctionExpression(func) if func.name.as_ref().is_some_and(|n| n.name == new_name)
            );
            if !is_fn_sugar {
                return false;
            }
        }
        // The initializer evaluates before the variable is bound, so a rebinding inside it
        // (e.g. a tag) takes effect first; either way the declaration's own id binds next.
        let bound = self.declaration.init.rename_identifiers(old_name, new_name);
        bound || self.declaration.id.name == old_name
    }
}

impl ArrayExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for element in &mut self.elements {
            if element.rename_identifiers(old_name, new_name) {
                return true;
            }
        }
        false
    }
}

impl ArrayRangeExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.start_element.rename_identifiers(old_name, new_name)
            || self.end_element.rename_identifiers(old_name, new_name)
    }
}

impl ObjectExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for property in &mut self.properties {
            if property.value.rename_identifiers(old_name, new_name) {
                return true;
            }
        }
        false
    }
}

impl MemberExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        if self.object.rename_identifiers(old_name, new_name) {
            return true;
        }
        // A non-computed property like the `bar` in `foo.bar` is a field or tag
        // access, not a reference to a variable named `bar`, so it is not
        // renamed.
        if self.computed {
            return self.property.rename_identifiers(old_name, new_name);
        }
        false
    }
}

impl BinaryExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.left.rename_identifiers(old_name, new_name) || self.right.rename_identifiers(old_name, new_name)
    }
}

impl UnaryExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.argument.rename_identifiers(old_name, new_name)
    }
}

impl PipeExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for statement in &mut self.body {
            if statement.rename_identifiers(old_name, new_name) {
                // A tag bound in an earlier pipe element shadows the name for later ones.
                return true;
            }
        }
        false
    }
}

impl FunctionExpression {
    /// Rename all identifiers that have the old name to the new given name.
    /// If the function's own name or one of its parameters shadows the old name, the body refers
    /// to that binding instead of the one being renamed, so there is nothing to rename.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        // The executor binds a named function expression's name in the enclosing scope, so it
        // rebinds the old name there; a parameter only shadows inside the body.
        let name_binds = self.name.as_ref().is_some_and(|n| n.name == old_name);
        if !self.binds_name(old_name) {
            // The body is its own scope; its bindings don't leak into the enclosing walk.
            self.body.rename_identifiers(old_name, new_name);
        }
        name_binds
    }

    /// Whether the function's own name (its recursive binding) or one of its parameters binds
    /// `name` inside the function's body, shadowing any outer binding of that name.
    fn binds_name(&self, name: &str) -> bool {
        self.name.as_ref().is_some_and(|n| n.name == name) || self.params.iter().any(|p| p.identifier.name == name)
    }
}

impl SketchBlock {
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for arg in &mut self.arguments {
            if arg.arg.rename_identifiers(old_name, new_name) {
                // A binding in an argument shadows the name for the block body too.
                return true;
            }
        }

        // The block's declarations are scoped to the block (exposed as member references on
        // the sketch value), so they don't rebind the enclosing environment.
        self.body.rename_identifiers(old_name, new_name);
        false
    }
}

impl Block {
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        rename_identifiers_in_body(&mut self.items, old_name, new_name)
    }
}

impl IfExpression {
    /// Rename all identifiers that have the old name to the new given name. Branches execute
    /// in the current environment, so their bindings leak; since only one branch runs, each
    /// branch is renamed independently of the others, but a binding in any branch
    /// conservatively stops renaming after the if expression. Conditions evaluate in order
    /// until one is true, so a binding in one stops everything after it.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        if self.cond.rename_identifiers(old_name, new_name) {
            return true;
        }
        let mut bound = self.then_val.rename_identifiers(old_name, new_name);
        for else_if in &mut self.else_ifs {
            if else_if.cond.rename_identifiers(old_name, new_name) {
                return true;
            }
            bound |= else_if.then_val.rename_identifiers(old_name, new_name);
        }
        bound |= self.final_else.rename_identifiers(old_name, new_name);
        bound
    }
}

/// Rename identifiers in body items, in the executor's evaluation order. Stops as soon as
/// something rebinds (shadows) the old name, since references evaluated after it refer to the
/// new binding, not the one being renamed. Rebinding can happen mid-item: the executor binds
/// tags, labels, and named function expressions the moment it evaluates them, so references
/// after them in the same statement are left alone, while references before them are renamed
/// (e.g. renaming outer `x` renames the use in a shadowing local `x = x + 1`, whose
/// initializer evaluates before the binding). Returns whether the old name was rebound, which
/// matters for if-expression branches: they execute in the current environment, so their
/// bindings leak to the enclosing walk.
fn rename_identifiers_in_body(body: &mut [BodyItem], old_name: &str, new_name: &str) -> bool {
    for item in body {
        if item.rename_identifiers(old_name, new_name) {
            return true;
        }
    }
    false
}

/// Rename the head segments of qualified names (`old::item` becomes `new::item`) throughout
/// the body, including every nested scope. The executor resolves qualified heads in the
/// module namespace, where imports may only appear at the file's root, so unlike value
/// renames no shadow tracking is needed.
fn rename_module_refs_in_body(body: &mut [BodyItem], old_name: &str, new_name: &str) {
    for item in body {
        if let Some(expr) = body_item_expr_mut(item) {
            rename_module_refs_expr(expr, old_name, new_name);
        }
    }
}

fn rename_module_refs_expr(expr: &mut Expr, old_name: &str, new_name: &str) {
    let recurse = |e: &mut Expr| rename_module_refs_expr(e, old_name, new_name);
    match expr {
        Expr::Literal(_) | Expr::TagDeclarator(_) | Expr::PipeSubstitution(_) | Expr::SketchVar(_) | Expr::None(_) => {}
        Expr::Name(name) => name.rename_module_head(old_name, new_name),
        Expr::MemberExpression(member) => {
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        Expr::FunctionExpression(func) => rename_module_refs_in_body(&mut func.body.body, old_name, new_name),
        Expr::CallExpressionKw(call) => {
            call.callee.rename_module_head(old_name, new_name);
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        Expr::PipeExpression(pipe) => {
            for e in &mut pipe.body {
                recurse(e);
            }
        }
        Expr::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        Expr::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        Expr::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        Expr::BinaryExpression(bin_expr) => {
            rename_module_refs_binary_part(&mut bin_expr.left, old_name, new_name);
            rename_module_refs_binary_part(&mut bin_expr.right, old_name, new_name);
        }
        Expr::UnaryExpression(unary_expr) => {
            rename_module_refs_binary_part(&mut unary_expr.argument, old_name, new_name)
        }
        Expr::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            rename_module_refs_in_body(&mut if_expr.then_val.body, old_name, new_name);
            for else_if in &mut if_expr.else_ifs {
                rename_module_refs_expr(&mut else_if.cond, old_name, new_name);
                rename_module_refs_in_body(&mut else_if.then_val.body, old_name, new_name);
            }
            rename_module_refs_in_body(&mut if_expr.final_else.body, old_name, new_name);
        }
        Expr::LabelledExpression(labeled) => recurse(&mut labeled.expr),
        Expr::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
        Expr::SketchBlock(sketch_block) => {
            for arg in &mut sketch_block.arguments {
                recurse(&mut arg.arg);
            }
            rename_module_refs_in_body(&mut sketch_block.body.items, old_name, new_name);
        }
    }
}

fn rename_module_refs_binary_part(part: &mut BinaryPart, old_name: &str, new_name: &str) {
    let recurse = |e: &mut Expr| rename_module_refs_expr(e, old_name, new_name);
    match part {
        BinaryPart::Literal(_) | BinaryPart::SketchVar(_) => {}
        BinaryPart::Name(name) => name.rename_module_head(old_name, new_name),
        BinaryPart::BinaryExpression(bin_expr) => {
            rename_module_refs_binary_part(&mut bin_expr.left, old_name, new_name);
            rename_module_refs_binary_part(&mut bin_expr.right, old_name, new_name);
        }
        BinaryPart::UnaryExpression(unary_expr) => {
            rename_module_refs_binary_part(&mut unary_expr.argument, old_name, new_name)
        }
        BinaryPart::CallExpressionKw(call) => {
            call.callee.rename_module_head(old_name, new_name);
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        BinaryPart::MemberExpression(member) => {
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        BinaryPart::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        BinaryPart::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        BinaryPart::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        BinaryPart::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            rename_module_refs_in_body(&mut if_expr.then_val.body, old_name, new_name);
            for else_if in &mut if_expr.else_ifs {
                rename_module_refs_expr(&mut else_if.cond, old_name, new_name);
                rename_module_refs_in_body(&mut else_if.then_val.body, old_name, new_name);
            }
            rename_module_refs_in_body(&mut if_expr.final_else.body, old_name, new_name);
        }
        BinaryPart::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
    }
}

/// Whether the string is usable as a binding name: it lexes as exactly one identifier token
/// covering the whole string (which excludes keywords, literals, operators, and anything with
/// whitespace or punctuation).
fn is_valid_binding_name(name: &str) -> bool {
    let Ok(tokens) = crate::parsing::token::lex(name, ModuleId::default()) else {
        return false;
    };
    let tokens = tokens.as_slice();
    tokens.len() == 1 && tokens[0].token_type == crate::parsing::token::TokenType::Word && tokens[0].value == name
}

/// Whether the block's body directly declares a variable with the given name.
fn block_declares_name(block: &Block, name: &str) -> bool {
    block
        .items
        .iter()
        .any(|item| matches!(item, BodyItem::VariableDeclaration(decl) if decl.declaration.id.name == name))
}

/// Whether the expression contains any reference to the given name.
fn expr_references_name(expr: &Expr, name: &str) -> bool {
    expr_references_name_where(expr, |n| n == name)
}

/// Whether the expression contains a reference to any name matching the predicate. Member
/// properties are visited too, so this over-approximates references; callers use it in the
/// conservative direction (refusing a rename rather than misapplying one).
fn expr_references_name_where(expr: &Expr, pred: impl Fn(&str) -> bool) -> bool {
    use crate::walk::Node as WalkNode;
    use crate::walk::Walker;

    let found = std::cell::Cell::new(false);
    let finder = |node: WalkNode<'_>| -> Result<bool, anyhow::Error> {
        if let WalkNode::Name(n) = node
            && n.local_ident().is_some_and(|ident| pred(ident.inner))
        {
            found.set(true);
            // Stop walking.
            return Ok(false);
        }
        Ok(true)
    };
    let _ = finder.walk(WalkNode::from(expr));
    found.get()
}

/// The expression a body item evaluates, if any.
fn body_item_expr_mut(item: &mut BodyItem) -> Option<&mut Expr> {
    match item {
        BodyItem::ImportStatement(_) | BodyItem::TypeDeclaration(_) => None,
        BodyItem::ExpressionStatement(stmt) => Some(&mut stmt.expression),
        BodyItem::VariableDeclaration(decl) => Some(&mut decl.declaration.init),
        BodyItem::ReturnStatement(stmt) => Some(&mut stmt.argument),
    }
}

/// Variables declared in this body whose value is a sketch block, e.g.
/// `s = sketch(on = XY) {...}`.
fn sketch_blocks_in_body(body: &[BodyItem]) -> impl Iterator<Item = (&str, &Node<Block>)> {
    body.iter().filter_map(|item| {
        let BodyItem::VariableDeclaration(decl) = item else {
            return None;
        };
        let Expr::SketchBlock(sketch) = &decl.declaration.init else {
            return None;
        };
        Some((decl.declaration.id.name.as_str(), &sketch.body))
    })
}

fn sketch_block_mut_in_body<'a>(body: &'a mut [BodyItem], name: &str) -> Option<&'a mut Node<Block>> {
    body.iter_mut().find_map(|item| {
        let BodyItem::VariableDeclaration(decl) = item else {
            return None;
        };
        if decl.declaration.id.name != name {
            return None;
        }
        let Expr::SketchBlock(sketch) = &mut decl.declaration.init else {
            return None;
        };
        Some(&mut sketch.body)
    })
}

/// Whether this declaration's value is a `region(...)` call deriving from the given sketch
/// variable, e.g. `region(segments = [s.line1])`, `region(point = [0, 0], sketch = s)`, or
/// `region(point = s.point1)`. Such regions inherit the sketch block's declared names as tags
/// (`myRegion.tags.line1`). Regions that only reach a variable indirectly (returned from a
/// helper function, aliased, or passed as a parameter) aren't detected.
fn is_region_derived_from_sketch(decl: &VariableDeclaration, sketch_name: &str) -> bool {
    region_call_derives_from(&decl.declaration.init, sketch_name)
}

/// Whether this expression is a `region(...)` call deriving from the given sketch variable.
/// Mirrors the executor's provenance rules (see `region_from_point` in std::sketch):
/// - `segments = [...]`: the region derives from the segments' sketches. (The executor
///   rejects a `sketch` argument alongside segments.)
/// - `point = <segment>`: a solved point segment carries its own sketch, and the executor
///   ignores any `sketch` argument. Syntactically, a point argument of the form `base.name`
///   (a member of a bare name) is treated as a segment of `base`.
/// - `point = [x, y]` or any deeper expression (e.g. `s.circle1.center`, a coordinate taken
///   from geometry): 2D coordinates; the `sketch` argument determines the sketch.
fn region_call_derives_from(init: &Expr, sketch_name: &str) -> bool {
    let Expr::CallExpressionKw(call) = init else {
        return false;
    };
    if call.callee.local_ident().map(|ident| ident.inner) != Some("region") {
        return false;
    }
    let arg_with_label = |label: &str| {
        call.arguments
            .iter()
            .find(|arg| arg.label.as_ref().is_some_and(|l| l.name == label))
            .map(|arg| &arg.arg)
    };
    if let Some(segments) = arg_with_label("segments") {
        return expr_references_name(segments, sketch_name);
    }
    let point = arg_with_label("point");
    // A point segment like `s.point1`: the segment's sketch is the provenance, and the
    // executor ignores any `sketch` argument.
    if let Some(Expr::MemberExpression(member)) = point
        && !member.computed
        && let Expr::Name(base) = &member.object
    {
        return base.local_ident().is_some_and(|ident| ident.inner == sketch_name);
    }
    if let Some(sketch_arg) = arg_with_label("sketch") {
        return expr_references_name(sketch_arg, sketch_name);
    }
    point.is_some_and(|arg| expr_references_name(arg, sketch_name))
}

/// What the rename position points at, as candidates for resolving a sketch block symbol.
/// During resolution, a candidate is killed (set to None) when a binding or scope boundary
/// shadows what it refers to, so that outer scopes don't match a reference that doesn't
/// resolve to their declarations.
struct SketchSymbolCandidates {
    /// The position is on the id of a variable declaration; a rename target only if that
    /// declaration is a direct item of a sketch block.
    decl_id: Option<String>,
    /// A bare name reference at the position.
    bare_use: Option<String>,
    /// A member reference `x.prop` with the position on `prop`: (object, property).
    member: Option<(String, String)>,
    /// A region tag reference `r.tags.prop` with the position on `prop`: (region, property).
    tags_member: Option<(String, String)>,
    /// A resolved tags_member: the region declaration's initializer (cloned), the property,
    /// and the end of the region's declaration. The sketch the region derives from is looked
    /// up among sketch declarations before that position.
    region: Option<(Expr, String, usize)>,
    /// Whether a user binding named `region` shadows the standard `region` function on the
    /// lexical path to the position; calls spelled `region(...)` are then not the standard
    /// function, so no provenance is inferred from them. Maintained with save/restore as the
    /// resolution enters and leaves scopes.
    std_region_shadowed: bool,
    /// Set when the rename resolved to a target but was refused (e.g. the new name collides
    /// in the target's scope); reported to the caller as an error.
    error: Option<String>,
}

impl SketchSymbolCandidates {
    fn is_empty(&self) -> bool {
        self.decl_id.is_none()
            && self.bare_use.is_none()
            && self.member.is_none()
            && self.tags_member.is_none()
            && self.region.is_none()
    }
}

/// Rename a sketch block symbol within this scope, preferring the innermost scope: first
/// recurse into nested bodies (function bodies, if-expression branches, sketch blocks) that
/// contain `pos`; if no inner scope handles the rename, resolve the candidates against
/// declarations directly in this body. Candidates are passed mutably so that a scope boundary
/// or declaration that rebinds (shadows) what they refer to can kill them, preventing outer
/// scopes from matching a reference that doesn't resolve to their declarations. Returns
/// whether the rename was handled.
fn rename_sketch_symbol_in_body(
    body: &mut [BodyItem],
    candidates: &mut SketchSymbolCandidates,
    new_name: &str,
    pos: usize,
    in_sketch_block: bool,
) -> bool {
    // The innermost scope wins, so a fn-local sketch shadows a same-named outer one. Items
    // before the one containing the position can rebind `region` for everything inside it;
    // the flag is restored afterwards since those binders don't apply to enclosing scopes.
    let saved_region_shadowed = candidates.std_region_shadowed;
    if let Some(idx) = body.iter().position(|item| SourceRange::from(item).contains(pos)) {
        if body[..idx].iter().any(|item| body_item_binds_name(item, "region")) {
            candidates.std_region_shadowed = true;
        }
        if let Some(expr) = body_item_expr_mut(&mut body[idx])
            && rename_sketch_symbol_in_nested_bodies(expr, candidates, new_name, pos)
        {
            return true;
        }
    }
    candidates.std_region_shadowed = saved_region_shadowed;

    // A bare name reference resolves to the last binding before the position. Inside a
    // sketch block's body, only the block's own declaration of that name makes it a rename
    // target (matched by the enclosing scope, which knows the sketch variable); any other
    // binding, or no binding at all inside the block, means the reference is not to the
    // block's declaration.
    if let Some(name) = candidates.bare_use.as_ref() {
        let last_binder = body
            .iter()
            .rfind(|item| SourceRange::from(&**item).end() <= pos && body_item_binds_name(item, name));
        let binder_is_own_decl = matches!(last_binder, Some(BodyItem::VariableDeclaration(decl))
            if decl.declaration.id.name == *name);
        if in_sketch_block {
            if !binder_is_own_decl {
                candidates.bare_use = None;
            }
        } else if last_binder.is_some() {
            candidates.bare_use = None;
        }
    }

    // A region tag reference like `r.tags.line1` resolves through the last binding of the
    // region name before the position. If that binding isn't a region call, the reference is
    // not a region tag, and outer scopes must not match it either.
    if let Some((region, property)) = candidates.tags_member.as_ref() {
        let last_binder = body
            .iter()
            .rfind(|item| SourceRange::from(&**item).end() <= pos && body_item_binds_name(item, region));
        if let Some(binder) = last_binder {
            if let BodyItem::VariableDeclaration(decl) = binder
                && decl.declaration.id.name == *region
                && matches!(&decl.declaration.init, Expr::CallExpressionKw(call)
                    if call.callee.local_ident().map(|ident| ident.inner) == Some("region"))
                // The call is only the standard `region` if nothing rebinds that name at the
                // call's site: neither an enclosing scope on the path here nor an earlier
                // item in this body.
                && !candidates.std_region_shadowed
                && !body.iter().any(|item| {
                    SourceRange::from(item).end() <= SourceRange::from(binder).start()
                        && body_item_binds_name(item, "region")
                })
            {
                candidates.region = Some((
                    decl.declaration.init.clone(),
                    property.clone(),
                    SourceRange::from(binder).end(),
                ));
            }
            candidates.tags_member = None;
        }
    }

    // The sketch a resolved region derives from: a sketch declaration before the region that
    // the region's initializer references and whose block declares the property.
    let mut target: Option<(String, String)> = None;
    if let Some((region_init, property, region_pos)) = candidates.region.as_ref() {
        let sketch = body.iter().rfind(|item| {
            SourceRange::from(&**item).end() <= *region_pos
                && matches!(item, BodyItem::VariableDeclaration(decl)
                    if matches!(&decl.declaration.init, Expr::SketchBlock(sketch)
                        if block_declares_name(&sketch.body, property))
                    && region_call_derives_from(region_init, &decl.declaration.id.name))
        });
        if let Some(BodyItem::VariableDeclaration(decl)) = sketch {
            target = Some((decl.declaration.id.name.clone(), property.clone()));
        }
    }

    // A member reference like `mySketch.line1` resolves to the last binding of the sketch
    // name before the position. If that binding is a sketch block declaring the property, it
    // is the rename target. If it is any other binding, the reference is not to a sketch, and
    // outer scopes must not match it either.
    if target.is_none()
        && let Some((object, property)) = candidates.member.as_ref()
    {
        let last_binder = body
            .iter()
            .rfind(|item| SourceRange::from(&**item).end() <= pos && body_item_binds_name(item, object));
        if let Some(binder) = last_binder {
            if let BodyItem::VariableDeclaration(decl) = binder
                && decl.declaration.id.name == *object
                && let Expr::SketchBlock(sketch) = &decl.declaration.init
                && block_declares_name(&sketch.body, property)
            {
                target = Some((object.clone(), property.clone()));
            } else {
                candidates.member = None;
            }
        }
    }
    // Or the id of a declaration that is a direct item of a sketch block declared in this
    // body. Declarations nested deeper (e.g. a local inside a function inside the block) are
    // different symbols and don't match.
    let target = target.or_else(|| {
        candidates.decl_id.as_ref()?;
        sketch_blocks_in_body(body).find_map(|(sketch_name, block)| {
            block.items.iter().find_map(|item| match item {
                BodyItem::VariableDeclaration(decl) if SourceRange::from(&decl.declaration.id).contains(pos) => {
                    Some((sketch_name.to_owned(), decl.declaration.id.name.clone()))
                }
                _ => None,
            })
        })
    });
    // ...or a bare use inside a sketch block declared in this body.
    let target = target.or_else(|| {
        let name = candidates.bare_use.as_deref()?;
        sketch_blocks_in_body(body)
            .find(|(_, block)| block.as_source_range().contains(pos) && block_declares_name(block, name))
            .map(|(sketch_name, _)| (sketch_name.to_owned(), name.to_owned()))
    });
    let Some((sketch_name, old_name)) = target else {
        return false;
    };

    // The new name must not collide with a binding in the block, the target's own scope.
    if old_name != new_name
        && sketch_blocks_in_body(body).any(|(name, block)| {
            name == sketch_name && block.items.iter().any(|item| body_item_binds_name(item, new_name))
        })
    {
        candidates.error = Some(format!("the name `{new_name}` is already in use in this sketch"));
        return true;
    }

    // Rename the declaration and the uses inside the block after it; the executor evaluates
    // block items in order, so references before the declaration resolve to an outer binding.
    if let Some(block) = sketch_block_mut_in_body(body, &sketch_name) {
        let mut decl_index = 0;
        for (index, item) in block.items.iter_mut().enumerate() {
            if let BodyItem::VariableDeclaration(decl) = item
                && decl.declaration.id.name == old_name
            {
                decl.declaration.id.name = new_name.to_owned();
                decl_index = index;
                break;
            }
        }
        rename_identifiers_in_body(&mut block.items[decl_index..], &old_name, new_name);
    }

    // Rename references outside the block, within this scope: the sketch value exposes the
    // block's declarations as members (`mySketch.line1`), and regions derived from the sketch
    // inherit them as tags (`myRegion.tags.line1`). Regions are discovered as the walk
    // proceeds, here and in nested scopes, since their `.tags` can only be referenced after
    // their declaration. The walk starts at the sketch's declaration: references before it
    // cannot refer to this sketch, only to an outer binding of the same name. This scope is
    // where the sketch and region variables are bound, so no rebinding is possible after the
    // sketch's declaration; only nested bodies can shadow them, which the recursion handles.
    let start = body
        .iter()
        .position(|item| {
            matches!(item, BodyItem::VariableDeclaration(decl)
                if decl.declaration.id.name == sketch_name && matches!(&decl.declaration.init, Expr::SketchBlock(_)))
        })
        .unwrap_or(0);
    // Whether the standard `region` function is shadowed: by an enclosing scope on the path
    // here, by an item before the sketch's declaration, or by an item the walk passes.
    let mut region_fn_shadowed =
        candidates.std_region_shadowed || body[..start].iter().any(|item| body_item_binds_name(item, "region"));
    let mut region_names: Vec<String> = Vec::new();
    for item in body[start..].iter_mut() {
        if let Some(expr) = body_item_expr_mut(item) {
            rename_sketch_member_refs_expr(
                expr,
                Some(&sketch_name),
                &region_names,
                &old_name,
                new_name,
                region_fn_shadowed,
            );
        }
        if !region_fn_shadowed
            && let BodyItem::VariableDeclaration(decl) = &*item
            && is_region_derived_from_sketch(decl, &sketch_name)
        {
            region_names.push(decl.declaration.id.name.clone());
        }
        region_fn_shadowed |= body_item_binds_name(item, "region");
    }
    true
}

/// Recurse into nested bodies (function bodies, if-expression branches, sketch blocks) within
/// this expression that contain `pos`, trying to rename a sketch block symbol declared in one
/// of them. Returns whether the rename was handled.
fn rename_sketch_symbol_in_nested_bodies(
    expr: &mut Expr,
    candidates: &mut SketchSymbolCandidates,
    new_name: &str,
    pos: usize,
) -> bool {
    if !SourceRange::from(&*expr).contains(pos) {
        return false;
    }
    let recurse =
        |e: &mut Expr, c: &mut SketchSymbolCandidates| rename_sketch_symbol_in_nested_bodies(e, c, new_name, pos);
    let recurse_body = |b: &mut Node<Program>, c: &mut SketchSymbolCandidates| {
        b.as_source_range().contains(pos) && rename_sketch_symbol_in_body(&mut b.body, c, new_name, pos, false)
    };
    match expr {
        Expr::Literal(_)
        | Expr::Name(_)
        | Expr::TagDeclarator(_)
        | Expr::PipeSubstitution(_)
        | Expr::SketchVar(_)
        | Expr::None(_) => false,
        Expr::FunctionExpression(func) => {
            // A parameter or the function's own name can also rebind `region` for the body;
            // restored below since it doesn't apply to enclosing scopes.
            let saved_region_shadowed = candidates.std_region_shadowed;
            if func.binds_name("region") {
                candidates.std_region_shadowed = true;
            }
            let handled = recurse_body(&mut func.body, candidates);
            // A parameter or the function's own name that rebinds a candidate's base name
            // shadows any outer binding; if the reference didn't resolve inside the function,
            // outer scopes must not resolve it either.
            if !handled {
                candidates.std_region_shadowed = saved_region_shadowed;
                if candidates.bare_use.as_ref().is_some_and(|name| func.binds_name(name)) {
                    candidates.bare_use = None;
                }
                if candidates
                    .member
                    .as_ref()
                    .is_some_and(|(object, _)| func.binds_name(object))
                {
                    candidates.member = None;
                }
                if candidates
                    .tags_member
                    .as_ref()
                    .is_some_and(|(region, _)| func.binds_name(region))
                {
                    candidates.tags_member = None;
                }
                // A resolved region's initializer references names that meant the function's
                // bindings inside it (e.g. `region(segments = [s.line1])` where `s` is a
                // parameter); outer scopes' same-named sketches are different bindings, and
                // the runtime provenance is whatever was passed in. Over-approximates by
                // matching any referenced name, which only refuses more renames.
                if candidates
                    .region
                    .as_ref()
                    .is_some_and(|(init, _, _)| expr_references_name_where(init, |name| func.binds_name(name)))
                {
                    candidates.region = None;
                }
            }
            handled
        }
        Expr::SketchBlock(sketch_block) => {
            sketch_block
                .arguments
                .iter_mut()
                .any(|arg| recurse(&mut arg.arg, candidates))
                || (sketch_block.body.as_source_range().contains(pos)
                    && rename_sketch_symbol_in_body(&mut sketch_block.body.items, candidates, new_name, pos, true))
        }
        Expr::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond, candidates)
                || recurse_body(&mut if_expr.then_val, candidates)
                || if_expr.else_ifs.iter_mut().any(|else_if| {
                    recurse(&mut else_if.cond, candidates) || recurse_body(&mut else_if.then_val, candidates)
                })
                || recurse_body(&mut if_expr.final_else, candidates)
        }
        Expr::MemberExpression(member) => {
            recurse(&mut member.object, candidates) || recurse(&mut member.property, candidates)
        }
        Expr::BinaryExpression(bin_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.left, candidates, new_name, pos)
                || rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.right, candidates, new_name, pos)
        }
        Expr::UnaryExpression(unary_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut unary_expr.argument, candidates, new_name, pos)
        }
        Expr::CallExpressionKw(call) => {
            call.unlabeled.as_mut().is_some_and(|u| recurse(u, candidates))
                || call.arguments.iter_mut().any(|arg| recurse(&mut arg.arg, candidates))
        }
        Expr::PipeExpression(pipe) => pipe.body.iter_mut().any(|e| recurse(e, candidates)),
        Expr::ArrayExpression(array) => array.elements.iter_mut().any(|e| recurse(e, candidates)),
        Expr::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element, candidates) || recurse(&mut range.end_element, candidates)
        }
        Expr::ObjectExpression(obj) => obj.properties.iter_mut().any(|p| recurse(&mut p.value, candidates)),
        Expr::LabelledExpression(labeled) => recurse(&mut labeled.expr, candidates),
        Expr::AscribedExpression(ascribed) => recurse(&mut ascribed.expr, candidates),
    }
}

fn rename_sketch_symbol_in_nested_bodies_binary_part(
    part: &mut BinaryPart,
    candidates: &mut SketchSymbolCandidates,
    new_name: &str,
    pos: usize,
) -> bool {
    let recurse =
        |e: &mut Expr, c: &mut SketchSymbolCandidates| rename_sketch_symbol_in_nested_bodies(e, c, new_name, pos);
    match part {
        BinaryPart::Literal(_) | BinaryPart::Name(_) | BinaryPart::SketchVar(_) => false,
        BinaryPart::BinaryExpression(bin_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.left, candidates, new_name, pos)
                || rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.right, candidates, new_name, pos)
        }
        BinaryPart::UnaryExpression(unary_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut unary_expr.argument, candidates, new_name, pos)
        }
        BinaryPart::CallExpressionKw(call) => {
            call.unlabeled.as_mut().is_some_and(|u| recurse(u, candidates))
                || call.arguments.iter_mut().any(|arg| recurse(&mut arg.arg, candidates))
        }
        BinaryPart::MemberExpression(member) => {
            recurse(&mut member.object, candidates) || recurse(&mut member.property, candidates)
        }
        BinaryPart::ArrayExpression(array) => array.elements.iter_mut().any(|e| recurse(e, candidates)),
        BinaryPart::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element, candidates) || recurse(&mut range.end_element, candidates)
        }
        BinaryPart::ObjectExpression(obj) => obj.properties.iter_mut().any(|p| recurse(&mut p.value, candidates)),
        BinaryPart::IfExpression(if_expr) => {
            let recurse_body = |b: &mut Node<Program>, c: &mut SketchSymbolCandidates| {
                b.as_source_range().contains(pos) && rename_sketch_symbol_in_body(&mut b.body, c, new_name, pos, false)
            };
            recurse(&mut if_expr.cond, candidates)
                || recurse_body(&mut if_expr.then_val, candidates)
                || if_expr.else_ifs.iter_mut().any(|else_if| {
                    recurse(&mut else_if.cond, candidates) || recurse_body(&mut else_if.then_val, candidates)
                })
                || recurse_body(&mut if_expr.final_else, candidates)
        }
        BinaryPart::AscribedExpression(ascribed) => recurse(&mut ascribed.expr, candidates),
    }
}

/// Rename member references to a sketch block symbol in a nested scope: `<sketch>.<old>` and
/// `<region>.tags.<old>`. Stops tracking a sketch or region name once an item rebinds
/// (shadows) it, since member references after that refer to the new binding. References
/// within the rebinding item itself are still renamed, consistent with identifier renames.
/// Regions derived from the sketch that are declared in this scope are tracked from their
/// declaration on, as long as the sketch itself is still live here.
fn rename_sketch_member_refs_in_body(
    body: &mut [BodyItem],
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
    std_region_shadowed: bool,
) {
    let mut sketch_name = sketch_name;
    let mut region_names = region_names.to_vec();
    let mut region_fn_shadowed = std_region_shadowed;
    for item in body {
        if sketch_name.is_none() && region_names.is_empty() {
            return;
        }
        if let Some(expr) = body_item_expr_mut(item) {
            rename_sketch_member_refs_expr(expr, sketch_name, &region_names, old_name, new_name, region_fn_shadowed);
        }
        if sketch_name.is_some_and(|s| body_item_binds_name(item, s)) {
            sketch_name = None;
        }
        region_names.retain(|r| !body_item_binds_name(item, r));
        // Discover regions after the drops, so that a region declaration isn't dropped for
        // binding its own name. Only calls to the standard `region` function derive; a user
        // binding of that name shadows it from its item on.
        if !region_fn_shadowed
            && let Some(s) = sketch_name
            && let BodyItem::VariableDeclaration(decl) = &*item
            && is_region_derived_from_sketch(decl, s)
        {
            region_names.push(decl.declaration.id.name.clone());
        }
        region_fn_shadowed |= body_item_binds_name(item, "region");
    }
}

fn rename_sketch_member_refs_expr(
    expr: &mut Expr,
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
    std_region_shadowed: bool,
) {
    let recurse = |e: &mut Expr| {
        rename_sketch_member_refs_expr(e, sketch_name, region_names, old_name, new_name, std_region_shadowed)
    };
    let recurse_body = |b: &mut Node<Program>| {
        rename_sketch_member_refs_in_body(
            &mut b.body,
            sketch_name,
            region_names,
            old_name,
            new_name,
            std_region_shadowed,
        )
    };
    match expr {
        Expr::Literal(_)
        | Expr::Name(_)
        | Expr::TagDeclarator(_)
        | Expr::PipeSubstitution(_)
        | Expr::SketchVar(_)
        | Expr::None(_) => {}
        Expr::MemberExpression(member) => {
            rename_sketch_member_ref(member, sketch_name, region_names, old_name, new_name);
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        Expr::FunctionExpression(func) => {
            // The function's own name or a parameter can shadow the sketch or region
            // variables, or the standard `region` function, for the whole body.
            let sketch_name = sketch_name.filter(|s| !func.binds_name(s));
            let region_names: Vec<String> = region_names.iter().filter(|r| !func.binds_name(r)).cloned().collect();
            if sketch_name.is_some() || !region_names.is_empty() {
                let region_fn_shadowed = std_region_shadowed || func.binds_name("region");
                rename_sketch_member_refs_in_body(
                    &mut func.body.body,
                    sketch_name,
                    &region_names,
                    old_name,
                    new_name,
                    region_fn_shadowed,
                );
            }
        }
        Expr::SketchBlock(sketch_block) => {
            for arg in &mut sketch_block.arguments {
                recurse(&mut arg.arg);
            }
            rename_sketch_member_refs_in_body(
                &mut sketch_block.body.items,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        Expr::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            recurse_body(&mut if_expr.then_val);
            for else_if in &mut if_expr.else_ifs {
                rename_sketch_member_refs_expr(
                    &mut else_if.cond,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
                rename_sketch_member_refs_in_body(
                    &mut else_if.then_val.body,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
            }
            recurse_body(&mut if_expr.final_else);
        }
        Expr::BinaryExpression(bin_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.left,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.right,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        Expr::UnaryExpression(unary_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut unary_expr.argument,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        Expr::CallExpressionKw(call) => {
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        Expr::PipeExpression(pipe) => {
            for e in &mut pipe.body {
                recurse(e);
            }
        }
        Expr::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        Expr::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        Expr::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        Expr::LabelledExpression(labeled) => recurse(&mut labeled.expr),
        Expr::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
    }
}

fn rename_sketch_member_refs_binary_part(
    part: &mut BinaryPart,
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
    std_region_shadowed: bool,
) {
    let recurse = |e: &mut Expr| {
        rename_sketch_member_refs_expr(e, sketch_name, region_names, old_name, new_name, std_region_shadowed)
    };
    match part {
        BinaryPart::Literal(_) | BinaryPart::Name(_) | BinaryPart::SketchVar(_) => {}
        BinaryPart::MemberExpression(member) => {
            rename_sketch_member_ref(member, sketch_name, region_names, old_name, new_name);
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        BinaryPart::BinaryExpression(bin_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.left,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.right,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        BinaryPart::UnaryExpression(unary_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut unary_expr.argument,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        BinaryPart::CallExpressionKw(call) => {
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        BinaryPart::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        BinaryPart::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        BinaryPart::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        BinaryPart::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            rename_sketch_member_refs_in_body(
                &mut if_expr.then_val.body,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
            for else_if in &mut if_expr.else_ifs {
                rename_sketch_member_refs_expr(
                    &mut else_if.cond,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
                rename_sketch_member_refs_in_body(
                    &mut else_if.then_val.body,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
            }
            rename_sketch_member_refs_in_body(
                &mut if_expr.final_else.body,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        BinaryPart::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
    }
}

/// If this member expression is `<sketch>.<old>`, or `<region>.tags.<old>` for one of the
/// given regions, rename its property to the new name.
fn rename_sketch_member_ref(
    member: &mut Node<MemberExpression>,
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
) {
    // Reborrow through the Node so that the object and property field borrows are disjoint.
    let member = &mut **member;
    if member.computed {
        return;
    }
    let Expr::Name(property) = &mut member.property else {
        return;
    };
    if property.local_ident().map(|ident| ident.inner) != Some(old_name) {
        return;
    }
    let object_is_sketch_or_region_tags = match &member.object {
        Expr::Name(object) => sketch_name.is_some_and(|s| object.local_ident().is_some_and(|ident| ident.inner == s)),
        Expr::MemberExpression(inner) => {
            !inner.computed
                && matches!(&inner.object, Expr::Name(o) if o.local_ident().is_some_and(|ident| region_names.iter().any(|r| r == ident.inner)))
                && matches!(&inner.property, Expr::Name(p) if p.local_ident().is_some_and(|ident| ident.inner == "tags"))
        }
        _ => false,
    };
    if object_is_sketch_or_region_tags {
        property.name.name = new_name.to_owned();
    }
}

/// Whether this body item introduces a binding for `name`: a variable declaration, or a
/// TagDeclarator, LabelledExpression label, or named function anywhere in its expressions.
/// Names bound inside nested function bodies don't count; they are scoped to that function.
/// Mirrors frontend modify::find_defined_names_expr.
fn body_item_binds_name(item: &BodyItem, name: &str) -> bool {
    match item {
        BodyItem::ImportStatement(import) => match &import.selector {
            ImportSelector::List { items } => items.iter().any(|item| item.identifier() == name),
            // A whole-module import binds in the module namespace, which the executor keeps
            // separate from ordinary values (modules are stored under a prefix and resolved
            // as a fallback), so it doesn't shadow value bindings.
            ImportSelector::None { .. } => false,
            // A glob import binds an unknowable set of names; treat it as binding none rather
            // than stopping every rename that crosses it.
            ImportSelector::Glob(_) => false,
        },
        BodyItem::TypeDeclaration(_) => false,
        BodyItem::ExpressionStatement(expr_stmt) => expr_binds_name(&expr_stmt.expression, name),
        BodyItem::VariableDeclaration(var_decl) => {
            var_decl.declaration.id.name == name || expr_binds_name(&var_decl.declaration.init, name)
        }
        BodyItem::ReturnStatement(ret_stmt) => expr_binds_name(&ret_stmt.argument, name),
    }
}

fn expr_binds_name(expr: &Expr, name: &str) -> bool {
    match expr {
        Expr::TagDeclarator(tag_decl) => tag_decl.name == name,
        Expr::LabelledExpression(labeled) => labeled.label.name == name || expr_binds_name(&labeled.expr, name),
        Expr::FunctionExpression(func) => func.name.as_ref().is_some_and(|n| n.name == name),
        Expr::CallExpressionKw(call) => call.iter_arguments().any(|(_, arg)| expr_binds_name(arg, name)),
        Expr::PipeExpression(pipe) => pipe.body.iter().any(|e| expr_binds_name(e, name)),
        Expr::BinaryExpression(bin_expr) => {
            binary_part_binds_name(&bin_expr.left, name) || binary_part_binds_name(&bin_expr.right, name)
        }
        Expr::ArrayExpression(array) => array.elements.iter().any(|e| expr_binds_name(e, name)),
        Expr::ArrayRangeExpression(range) => {
            expr_binds_name(&range.start_element, name) || expr_binds_name(&range.end_element, name)
        }
        Expr::ObjectExpression(obj) => obj.properties.iter().any(|p| expr_binds_name(&p.value, name)),
        Expr::MemberExpression(member) => {
            expr_binds_name(&member.object, name) || expr_binds_name(&member.property, name)
        }
        Expr::UnaryExpression(unary_expr) => binary_part_binds_name(&unary_expr.argument, name),
        Expr::IfExpression(if_expr) => {
            // Branches execute in the current environment, so their declarations bind here
            // too; only one branch runs, but any branch binding conservatively counts.
            expr_binds_name(&if_expr.cond, name)
                || if_expr
                    .then_val
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
                || if_expr.else_ifs.iter().any(|else_if| {
                    expr_binds_name(&else_if.cond, name)
                        || else_if
                            .then_val
                            .body
                            .iter()
                            .any(|item| body_item_binds_name(item, name))
                })
                || if_expr
                    .final_else
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
        }
        Expr::AscribedExpression(expr) => expr_binds_name(&expr.expr, name),
        Expr::SketchBlock(sketch_block) => sketch_block.arguments.iter().any(|a| expr_binds_name(&a.arg, name)),
        Expr::Literal(_) | Expr::Name(_) | Expr::PipeSubstitution(_) | Expr::SketchVar(_) | Expr::None(_) => false,
    }
}

fn binary_part_binds_name(part: &BinaryPart, name: &str) -> bool {
    match part {
        BinaryPart::Literal(_) | BinaryPart::Name(_) | BinaryPart::SketchVar(_) => false,
        BinaryPart::BinaryExpression(binary_expr) => {
            binary_part_binds_name(&binary_expr.left, name) || binary_part_binds_name(&binary_expr.right, name)
        }
        BinaryPart::CallExpressionKw(call) => call.iter_arguments().any(|(_, arg)| expr_binds_name(arg, name)),
        BinaryPart::UnaryExpression(unary_expr) => binary_part_binds_name(&unary_expr.argument, name),
        BinaryPart::MemberExpression(member) => {
            expr_binds_name(&member.object, name) || expr_binds_name(&member.property, name)
        }
        BinaryPart::ArrayExpression(array) => array.elements.iter().any(|e| expr_binds_name(e, name)),
        BinaryPart::ArrayRangeExpression(range) => {
            expr_binds_name(&range.start_element, name) || expr_binds_name(&range.end_element, name)
        }
        BinaryPart::ObjectExpression(obj) => obj.properties.iter().any(|p| expr_binds_name(&p.value, name)),
        BinaryPart::IfExpression(if_expr) => {
            // See the Expr::IfExpression case: branch declarations bind the current
            // environment.
            expr_binds_name(&if_expr.cond, name)
                || if_expr
                    .then_val
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
                || if_expr.else_ifs.iter().any(|else_if| {
                    expr_binds_name(&else_if.cond, name)
                        || else_if
                            .then_val
                            .body
                            .iter()
                            .any(|item| body_item_binds_name(item, name))
                })
                || if_expr
                    .final_else
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
        }
        BinaryPart::AscribedExpression(expr) => expr_binds_name(&expr.expr, name),
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[track_caller]
    fn parse(code: &str) -> Node<Program> {
        crate::parsing::top_level_parse(code).unwrap()
    }

    #[test]
    fn test_rename_renames_computed_member_index_but_not_dot_property() {
        // In `arr[key]` the index is a reference to the variable `key`, so it is renamed. In
        // `obj.key` the property is a field access unrelated to the variable, so it is not,
        // and neither is the `key` in the object literal.
        let code = r#"key = 1
arr = [10, 20, 30]
obj = { key = 2, other = 3 }
byIndex = arr[key]
byField = obj.key + key
"#;
        let mut program = parse(code);
        let pos = code.find("key").unwrap() + 1;

        program.rename_symbol("idx", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"idx = 1
arr = [10, 20, 30]
obj = { key = 2, other = 3 }
byIndex = arr[idx]
byField = obj.key + idx
"#
        );
    }

    #[test]
    fn test_rename_in_math_in_std_function() {
        let code = r#"rise = 4.5
run = 8
angle = atan(rise / run)"#;
        let mut program = crate::parsing::top_level_parse(code).unwrap();

        // We want to rename `run` to `run2`.
        let run = program.body.get(1).unwrap().clone();
        let BodyItem::VariableDeclaration(var_decl) = &run else {
            panic!("expected a variable declaration")
        };
        let Expr::Literal(lit) = &var_decl.declaration.init else {
            panic!("expected a literal");
        };
        assert_eq!(lit.raw, "8");

        // Rename it.
        program
            .rename_symbol("yoyo", var_decl.as_source_range().start() + 1)
            .unwrap();

        // Recast the program to a string.
        let formatted = program.recast_top(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"rise = 4.5
yoyo = 8
angle = atan(rise / yoyo)
"#
        );
    }

    #[test]
    fn test_rename_handles_tag_bindings() {
        let code = r#"BEST = 2

fn foo() {
  sketch001 = startSketchOn(XY)
  profile001 = startProfile(sketch001, at = [0, 0])
    |> xLine(length = BEST)
    |> yLine(length = BEST, tag = $BEST)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  return profile001
}

foo()
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("BETTER", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"BETTER = 2

fn foo() {
  sketch001 = startSketchOn(XY)
  profile001 = startProfile(sketch001, at = [0, 0])
    |> xLine(length = BETTER)
    |> yLine(length = BETTER, tag = $BEST)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  return profile001
}

foo()
"#
        );
    }

    #[test]
    fn test_rename_stops_mid_statement_at_tag_binding() {
        // The executor binds `$BEST` the moment it evaluates the tag, shadowing the outer
        // name from that point in evaluation order: references evaluated before the tag (the
        // `at` coordinate, evaluated in an earlier pipe element) are renamed; references
        // after it (a later argument of the same call, a later pipe element, or a later
        // statement) are not.
        let code = r#"BEST = 2

fn foo() {
  startProfile(startSketchOn(XY), at = [0, BEST])
    |> xLine(tag = $BEST, length = BEST)
    |> yLine(length = BEST)
    |> close()
  return BEST
}
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("BETTER", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"BETTER = 2

fn foo() {
  startProfile(startSketchOn(XY), at = [0, BETTER])
    |> xLine(tag = $BEST, length = BEST)
    |> yLine(length = BEST)
    |> close()
  return BEST
}
"#
        );
    }

    #[test]
    fn test_rename_stops_at_binding_in_if_branch() {
        // If-expression branches execute in the current environment, so the tag bound inside
        // the branch leaks; whether it binds depends on which branch runs, so renaming
        // conservatively stops after the if expression.
        let code = r#"foo = 1
val = if true {
  p = startProfile(startSketchOn(XY), at = [0, foo])
    |> line(end = [1, 1], tag = $foo)
    |> close()
  5
} else {
  0
}
after = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1
val = if true {
  p = startProfile(startSketchOn(XY), at = [0, bar])
    |> line(end = [1, 1], tag = $foo)
    |> close()
  5
} else {
  0
}
after = foo
"#
        );
    }

    #[test]
    fn test_rename_stops_after_shadowing() {
        let code = r#"foo = 1

fn demo(a) {
  before = foo
  foo = a
  after = foo
}
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("foo_initial", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"foo_initial = 1

fn demo(a) {
  before = foo_initial
  foo = a
  after = foo
}
"#
        );
    }

    #[test]
    fn test_rename_inside_if_then_branch() {
        let code = r#"param1 = 1
if true {
  param1
} else if false {
  param1 + 1
} else {
  param1 + 2
}
"#;
        let mut program = parse(code);
        let pos = code.find("param1").unwrap() + 1;

        program.rename_symbol("height", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"height = 1
if true {
  height
} else if false {
  height + 1
} else {
  height + 2
}
"#
        );
    }

    #[test]
    fn test_rename_fn_renames_recursive_calls() {
        let code = r#"fn accum(n) {
  return accum(n)
}
total = accum(3)
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("addUp", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn addUp(n) {
  return addUp(n)
}
total = addUp(3)
"#
        );
    }

    #[test]
    fn test_rename_does_not_touch_shadowing_nested_fn() {
        let code = r#"foo = 1

fn helper() {
  fn foo() {
    return foo()
  }
  return foo()
}
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("bar", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1

fn helper() {
  fn foo() {
    return foo()
  }
  return foo()
}
"#
        );
    }

    #[test]
    fn test_rename_import_without_alias_adds_alias() {
        let code = r#"import foo from "m.kcl"

x = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import foo as bar from "m.kcl"

x = bar
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration() {
        let code = r#"@settings(kclVersion = 2.0)

blockSketch = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 24mm])
  coincident([edge1.end, edge2.start])
}

blockRegion = region(point = [5mm, 3mm], sketch = blockSketch)
"#;
        let mut program = parse(code);
        let pos = code.find("edge1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"@settings(kclVersion = 2.0)

blockSketch = sketch(on = XY) {
  edgeOne = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 24mm])
  coincident([edgeOne.end, edge2.start])
}

blockRegion = region(point = [5mm, 3mm], sketch = blockSketch)
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_updates_member_references() {
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.line1, s.line2])
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("line1Prime", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1Prime = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.line1Prime, s.line2])
"#
        );
    }

    #[test]
    fn test_rename_top_level_declaration_does_not_rename_shadowing_sketch_block_declaration() {
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([line1.end, line1.start])
}

line1 = 99
result = line1
"#;
        let mut program = parse(code);
        let pos = code.rfind("line1 = 99").unwrap() + 1;

        program.rename_symbol("topLine", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([line1.end, line1.start])
}

topLine = 99
result = topLine
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_does_not_rename_same_named_top_level_declaration() {
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([line1.end, line1.start])
}

r = region(segments = [s.line1])
line1 = 99
result = line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line").unwrap() + 1;

        program.rename_symbol("sketchLine", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  sketchLine = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([sketchLine.end, sketchLine.start])
}

r = region(segments = [s.sketchLine])
line1 = 99
result = line1
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_symbol_from_references() {
        let code = r#"@settings(kclVersion = 2.0, experimentalFeatures = allow)

s = sketch(on = XY) {
  line1 = line(start = [var 8.34mm, var 12.78mm], end = [var 17.82mm, var 12.78mm])
  line2 = line(start = [var 17.82mm, var 12.78mm], end = [var 17.82mm, var 6.3mm])
  line3 = line(start = [var 17.82mm, var 6.3mm], end = [var 8.34mm, var 6.3mm])
  line4 = line(start = [var 8.34mm, var 6.3mm], end = [var 8.34mm, var 12.78mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
r = region(segments = [s.line1, s.line2])
extrude(r, length = 5)
"#;
        let expected = r#"@settings(kclVersion = 2.0, experimentalFeatures = allow)

s = sketch(on = XY) {
  line1Prime = line(start = [var 8.34mm, var 12.78mm], end = [var 17.82mm, var 12.78mm])
  line2 = line(start = [var 17.82mm, var 12.78mm], end = [var 17.82mm, var 6.3mm])
  line3 = line(start = [var 17.82mm, var 6.3mm], end = [var 8.34mm, var 6.3mm])
  line4 = line(start = [var 8.34mm, var 6.3mm], end = [var 8.34mm, var 12.78mm])
  coincident([line1Prime.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1Prime.start])
  parallel([line2, line4])
  parallel([line3, line1Prime])
  perpendicular([line1Prime, line2])
  horizontal(line3)
}
r = region(segments = [s.line1Prime, s.line2])
extrude(r, length = 5)
"#;

        for pos in [
            code.find("perpendicular([line1").unwrap() + "perpendicular([".len() + 1,
            code.find("s.line1").unwrap() + "s.".len() + 1,
        ] {
            let mut program = parse(code);
            program.rename_symbol("line1Prime", pos).unwrap();

            let formatted = program.recast_top(&Default::default(), 0);
            assert_eq!(formatted, expected);
        }
    }

    #[test]
    fn test_rename_sketch_block_declaration_updates_region_tag_references() {
        // Regions derived from a sketch inherit the sketch block's declared names as tags, so
        // `.tags` member references on them are renamed too. `rOther` is derived from a
        // different sketch, so its `.tags.line1` refers to that sketch's `line1` and is left
        // alone.
        let code = r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  point1 = point(at = [var 5, var 5])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r1 = region(segments = [s1.line1])
r2 = region(point = [0, 0], sketch = s1)
r3 = region(point = s1.point1)
rOther = region(sketch = s2)
a = r1.tags.line1
b = r2.tags.line1
c = r3.tags.line1
d = rOther.tags.line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("coolLine", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  coolLine = line(start = [var 0, var 0], end = [var 10, var 0])
  point1 = point(at = [var 5, var 5])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r1 = region(segments = [s1.coolLine])
r2 = region(point = [0, 0], sketch = s1)
r3 = region(point = s1.point1)
rOther = region(sketch = s2)
a = r1.tags.coolLine
b = r2.tags.coolLine
c = r3.tags.coolLine
d = rOther.tags.line1
"#
        );
    }

    #[test]
    fn test_rename_top_level_declaration_does_not_rename_member_properties() {
        // `s.line1` refers to the declaration inside the sketch block, not the top-level
        // variable, so renaming the top-level `line1` must leave it alone.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.line1])
line1 = 99
result = line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = 99").unwrap() + 1;

        program.rename_symbol("topLine", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.line1])
topLine = 99
result = topLine
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_inside_function_body() {
        let code = r#"fn makePart() {
  s = sketch(on = XY) {
    line1 = line(start = [var 0, var 0], end = [var 10, var 0])
    line2 = line(start = [var 10, var 0], end = [var 10, var 10])
  }
  r = region(segments = [s.line1, s.line2])
  t = r.tags.line1
  return s.line1
}
part = makePart()
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("innerLine", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn makePart() {
  s = sketch(on = XY) {
    innerLine = line(start = [var 0, var 0], end = [var 10, var 0])
    line2 = line(start = [var 10, var 0], end = [var 10, var 10])
  }
  r = region(segments = [s.innerLine, s.line2])
  t = r.tags.innerLine
  return s.innerLine
}
part = makePart()
"#
        );
    }

    #[test]
    fn test_rename_function_local_sketch_shadows_top_level_sketch() {
        // The sketch inside `f` shadows the top-level sketch of the same name, so renaming its
        // `line1` must not touch the top-level sketch block or references to it.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = sketch(on = XY) {
    line1 = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  return s.line1
}

top = s.line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line(start = [var 5").unwrap() + 1;

        program.rename_symbol("localLine", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = sketch(on = XY) {
    localLine = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  return s.localLine
}

top = s.line1
"#
        );
    }

    #[test]
    fn test_rename_top_level_sketch_skips_shadowing_function_scope() {
        // Renaming the top-level sketch's `line1` updates references in functions that close
        // over `s`, but not in functions where `s` is rebound (here, by a parameter), since
        // `s.line1` there refers to the parameter, not the sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn usesOuter() {
  return s.line1
}

fn shadows(s) {
  return s.line1
}

top = s.line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn usesOuter() {
  return s.edgeOne
}

fn shadows(s) {
  return s.line1
}

top = s.edgeOne
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_inside_lambda_argument() {
        let code = r#"made = makeThing(cb = fn() {
  s = sketch(on = XY) {
    line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.line1])
  return r.tags.line1
})
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("seg1", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"made = makeThing(cb = fn() {
  s = sketch(on = XY) {
    seg1 = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.seg1])
  return r.tags.seg1
})
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_inside_if_branch() {
        let code = r#"x = if true {
  s = sketch(on = XY) {
    line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.line1])
  r.tags.line1
} else {
  0
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"x = if true {
  s = sketch(on = XY) {
    edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.edgeOne])
  r.tags.edgeOne
} else {
  0
}
"#
        );
    }

    #[test]
    fn test_rename_from_param_position_does_not_rename_sketch_block_declaration() {
        // The parameter `line1` is its own binding; even though the position is inside the
        // sketch block's range and the block declares a same-named symbol, renaming from the
        // parameter's position must not touch the block's declaration. (Renaming parameters
        // of nested functions isn't supported, so nothing is renamed at all.)
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  helper = fn(line1) {
    return line1
  }
}
"#;
        let mut program = parse(code);
        let pos = code.find("fn(line1").unwrap() + "fn(".len() + 1;

        program.rename_symbol("newName", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_sketch_member_refs_stop_after_local_shadows_sketch_var() {
        // Inside `f`, the local `s = 5` shadows the sketch variable from its statement on.
        // The reference before it refers to the sketch and is renamed; the reference after it
        // refers to the local and is not.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.line1
  s = 5
  b = s.line1
  return [a, b]
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.edgeOne
  s = 5
  b = s.line1
  return [a, b]
}
"#
        );
    }

    #[test]
    fn test_rename_via_member_ref_targets_only_that_sketch() {
        // Two sketches declare the same name. Renaming via `s2.line1` renames s2's
        // declaration and references; s1's are left alone.
        let code = r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

a = s1.line1
b = s2.line1
"#;
        let mut program = parse(code);
        let pos = code.find("s2.line1").unwrap() + "s2.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

a = s1.line1
b = s2.edgeOne
"#
        );
    }

    #[test]
    fn test_rename_sketch_member_ref_inside_another_sketch_block() {
        // A member reference to one sketch's declaration from inside another sketch block,
        // including as the head of a longer member chain (`s1.line1.end`).
        let code = r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  line2 = line(start = s1.line1.end, end = [var 9, var 9])
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  line2 = line(start = s1.edgeOne.end, end = [var 9, var 9])
}
"#
        );
    }

    #[test]
    fn test_rename_aliased_import() {
        let code = r#"import foo as bar from "m.kcl"

x = bar
"#;
        let mut program = parse(code);
        let pos = code.find("bar").unwrap() + 1;

        program.rename_symbol("baz", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import foo as baz from "m.kcl"

x = baz
"#
        );
    }

    #[test]
    fn test_rename_fn_param_with_same_named_sketch_block_declaration() {
        // Renaming the parameter `line1` must not be intercepted by the sketch block symbol
        // handling just because the body's sketch block declares the same name. The block's
        // own declaration shadows the parameter from its statement on, so it and its (empty
        // set of) later uses stay; the use in its own initializer refers to the parameter and
        // is renamed, like any use before a shadowing declaration.
        let code = r#"fn f(line1) {
  s = sketch(on = XY) {
    line1 = line(start = [line1, var 0], end = [var 10, var 0])
  }
  return line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("newLen", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn f(newLen) {
  s = sketch(on = XY) {
    line1 = line(start = [newLen, var 0], end = [var 10, var 0])
  }
  return newLen
}
"#
        );
    }

    #[test]
    fn test_rename_import_original_name_of_aliased_import_does_nothing() {
        // `foo` is the name exported by the other module; renaming it locally isn't
        // supported. Only the alias can be renamed.
        let code = r#"import foo as bar from "m.kcl"

x = bar
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("baz", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_sketch_block_declaration_updates_region_tags_in_nested_fn() {
        // A region derived from the sketch and declared inside a nested function gets its
        // `.tags` references renamed, just like its direct member references to the sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.edgeOne])
  return r.tags.edgeOne
}
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_ignores_region_of_shadowed_sketch() {
        // Inside `f`, the local `s = 5` shadows the sketch before the region is declared, so
        // the region is derived from the local, not from the sketch being renamed. Nothing
        // inside `f` refers to the sketch, so nothing there is renamed.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = 5
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = 5
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#
        );
    }

    #[test]
    fn test_rename_variable_with_named_fn_initializer_leaves_fn_name_alone() {
        // `foo` and `bar` are distinct bindings: `foo` is the variable, `bar` is the
        // function's own recursive name, bound only inside its body. Renaming `foo` must not
        // touch `bar`, and must not rename anything inside the body, where `foo` is not bound
        // (the function value is created before `foo` is bound).
        let code = r#"foo = fn bar(n) {
  return bar(n) + foo
}
result = foo(1)
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("baz", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"baz = fn bar(n) {
  return bar(n) + foo
}
result = baz(1)
"#
        );
    }

    #[test]
    fn test_rename_from_member_ref_shadowed_by_param_does_nothing() {
        // The `s` in `s.line1` under the cursor is the parameter, not the outer sketch, so
        // there is no sketch symbol to rename; in particular the outer sketch must not be
        // touched.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(s) {
  return s.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("s.line1").unwrap() + "s.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_member_ref_shadowed_by_local_does_nothing() {
        // The `s` in `s.line1` under the cursor is the local `s = 5` (the last binding of `s`
        // before the reference), not the outer sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = 5
  return s.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("s.line1").unwrap() + "s.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_local_sketch_does_not_rename_refs_before_its_declaration() {
        // `a = s.line1` runs before the local sketch is declared, so its `s` is the outer
        // sketch; only references at or after the local sketch's declaration are renamed.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.line1
  s = sketch(on = XY) {
    line1 = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  b = s.line1
  return [a, b]
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line(start = [var 5").unwrap() + 1;

        program.rename_symbol("localLine", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.line1
  s = sketch(on = XY) {
    localLine = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  b = s.localLine
  return [a, b]
}
"#
        );
    }

    #[test]
    fn test_rename_region_with_explicit_sketch_arg_derives_from_that_sketch_only() {
        // Mirrors the executor's coordinate branch (see region_from_point in std::sketch):
        // `s1.circle1.center` is a 2D coordinate taken from s1's geometry, not a segment, so
        // the explicit `sketch` argument (s2) determines the region's provenance and the
        // region does not derive from s1.
        let code = r#"s1 = sketch(on = XY) {
  circle1 = circle(center = [var 0, var 0], diameter = var 2)
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.circle1.center, sketch = s2)
a = r.tags.line1
b = r.tags.circle1
"#;

        // Renaming s1's segment updates its member references but not r's tags, since r is
        // not derived from s1.
        let mut program = parse(code);
        let pos = code.find("circle1").unwrap() + 1;
        program.rename_symbol("loop1", pos).unwrap();
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  loop1 = circle(center = [var 0, var 0], diameter = var 2)
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.loop1.center, sketch = s2)
a = r.tags.line1
b = r.tags.circle1
"#
        );

        // Renaming s2's segment updates r's tags, since r derives from s2.
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;
        program.rename_symbol("edgeOne", pos).unwrap();
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  circle1 = circle(center = [var 0, var 0], diameter = var 2)
}
s2 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.circle1.center, sketch = s2)
a = r.tags.edgeOne
b = r.tags.circle1
"#
        );
    }

    #[test]
    fn test_rename_module_import_alias_renames_qualified_references() {
        let code = r#"import "m.kcl" as alias

x = alias::item
y = alias::helper(alias::item)
"#;
        let mut program = parse(code);
        let pos = code.find("alias").unwrap() + 1;

        program.rename_symbol("mod2", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as mod2

x = mod2::item
y = mod2::helper(mod2::item)
"#
        );
    }

    #[test]
    fn test_rename_variable_does_not_rename_qualified_member_segments() {
        // `alias::item` refers to `item` inside the module; renaming the local variable
        // `item` must not touch it.
        let code = r#"import "m.kcl" as alias

item = 1
x = alias::item + item
"#;
        let mut program = parse(code);
        let pos = code.find("item = 1").unwrap() + 1;

        program.rename_symbol("count", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as alias

count = 1
x = alias::item + count
"#
        );
    }

    #[test]
    fn test_rename_initiated_from_region_tag_reference() {
        // Renaming from the cursor on `line1` in `r.tags.line1` resolves through the region's
        // declaration to the sketch it derives from, then renames like a declaration rename.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.line1, s.line2])
x = r.tags.line1
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.edgeOne, s.line2])
x = r.tags.edgeOne
"#
        );
    }

    #[test]
    fn test_rename_initiated_from_region_tag_reference_in_nested_fn() {
        // The region lives in a nested function while the sketch is at the top level; the tag
        // reference still resolves through the region to the sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.edgeOne])
  return r.tags.edgeOne
}
"#
        );
    }

    #[test]
    fn test_rename_from_tag_reference_of_non_region_does_nothing() {
        // `r` is not a region, so `r.tags.line1` doesn't resolve to any sketch symbol; in
        // particular the sketch's same-named declaration must not be touched.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = 5
x = r.tags.line1
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_stops_at_shadowing_import() {
        // The import rebinds `foo` inside `f`: the use before it refers to the outer variable
        // and is renamed; the import itself (a binder, not a use) and the use after it are
        // not. Grammar-level coverage only: the executor rejects non-root imports, so this
        // shadowing can't occur in executable code.
        let code = r#"foo = 1

fn f() {
  a = foo
  import foo from "m.kcl"
  return [a, foo]
}
result = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1

fn f() {
  a = bar
  import foo from "m.kcl"
  return [a, foo]
}
result = bar
"#
        );
    }

    #[test]
    fn test_rename_value_passes_through_module_import() {
        // A module import binds in the module namespace, not the value namespace, so
        // renaming the value `foo` neither stops at `import "foo.kcl"` nor rewrites the
        // qualified head `foo::item`, which refers to the module. Grammar-level coverage
        // only: the executor rejects non-root imports.
        let code = r#"foo = 1

fn f() {
  import "foo.kcl"
  return foo::item
}
result = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1

fn f() {
  import "foo.kcl"
  return foo::item
}
result = bar
"#
        );
    }

    #[test]
    fn test_rename_value_leaves_same_named_module_alone() {
        // A value and a module can share a spelling: the executor stores modules separately
        // and resolves qualified heads in the module namespace. Renaming the value must not
        // rewrite `foo::item`.
        let code = r#"import "m.kcl" as foo

foo = 1
x = foo + foo::item
"#;
        let mut program = parse(code);
        let pos = code.find("foo = 1").unwrap() + 1;

        program.rename_symbol("bar", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as foo

bar = 1
x = bar + foo::item
"#
        );
    }

    #[test]
    fn test_rename_module_alias_leaves_same_named_value_alone() {
        // Renaming the module alias rewrites qualified heads everywhere and bare references
        // that resolve to the module (the executor falls back to the module namespace for a
        // bare name with no value binding, so `pre = foo` before the value declaration is the
        // module). The value declaration and bare references after it stay.
        let code = r#"import "m.kcl" as foo

a = foo::item
pre = foo
foo = 1
b = foo + foo::item
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("m2", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as m2

a = m2::item
pre = m2
foo = 1
b = foo + m2::item
"#
        );
    }

    #[test]
    fn test_rename_region_point_segment_provenance_overrides_sketch_arg() {
        // Mirrors the executor: when `point` is a point segment (`s1.point1`), the region
        // derives from that segment's sketch and the `sketch` argument is ignored (see
        // region_from_point in std::sketch). This region call is executor-shaped: a segment
        // point plus a (dead) sketch argument.
        let code = r#"s1 = sketch(on = XY) {
  point1 = point(at = [var 1, var 1])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.point1, sketch = s2)
a = r.tags.point1
b = r.tags.line1
"#;

        // Renaming s1's point segment updates r's tags: r derives from s1.
        let mut program = parse(code);
        let pos = code.find("point1").unwrap() + 1;
        program.rename_symbol("anchor", pos).unwrap();
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  anchor = point(at = [var 1, var 1])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.anchor, sketch = s2)
a = r.tags.anchor
b = r.tags.line1
"#
        );

        // Renaming s2's segment does not touch r's tags: the sketch argument is dead when
        // the point is a segment, so r does not derive from s2.
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;
        program.rename_symbol("edgeOne", pos).unwrap();
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  point1 = point(at = [var 1, var 1])
}
s2 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.point1, sketch = s2)
a = r.tags.point1
b = r.tags.line1
"#
        );
    }

    #[test]
    fn test_rename_from_unrelated_member_property_in_block_does_nothing() {
        // `cfg.line1` is a field access on an unrelated object. Even though the position is
        // inside a sketch block that declares `line1`, it is not a reference to the block's
        // declaration.
        let code = r#"cfg = { line1 = 1 }
s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  point1 = point(at = [cfg.line1, var 0])
}
"#;
        let mut program = parse(code);
        let pos = code.find("cfg.line1, var 0").unwrap() + "cfg.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_param_use_in_nested_fn_inside_block_does_nothing() {
        // The `line1` under the cursor is the parameter of the nested function, not the
        // block's declaration.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  helper = fn(line1) {
    return line1
  }
}
"#;
        let mut program = parse(code);
        let pos = code.find("return line1").unwrap() + "return ".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_local_decl_in_nested_fn_inside_block_does_nothing() {
        // The declaration under the cursor is a local of the nested function, not a direct
        // item of the sketch block, so it is a different symbol from the block's `line1`.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  helper = fn() {
    line1 = 5
    return line1
  }
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = 5").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_use_before_declaration_in_block_does_nothing() {
        // The executor evaluates block items in order, so a reference before the declaration
        // doesn't resolve to it; rename doesn't target the declaration from there.
        let code = r#"s = sketch(on = XY) {
  coincident([line1.end, line1.start])
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1.end").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_tag_reference_with_param_shadowed_sketch_does_nothing() {
        // The region derives from the parameter `s`, not the outer sketch of the same name;
        // at runtime its tags come from whatever argument is passed to `f`. Renaming from the
        // tag reference must not touch the outer sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(s) {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_ignores_region_call_shadowed_by_user_function() {
        // `region` here is the user's function, not the standard one, so `r` is not a region
        // derived from the sketch: renaming the segment updates the sketch member reference
        // (an ordinary argument) but must not rewrite `r.tags.line1`, and initiating the
        // rename from that tag reference must do nothing.
        let code = r#"fn region(segments) {
  return segments
}
s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.line1])
x = r.tags.line1
"#;

        // Renaming from the declaration renames the member reference but not the tag.
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;
        program.rename_symbol("edgeOne", pos).unwrap();
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn region(segments) {
  return segments
}
s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.edgeOne])
x = r.tags.line1
"#
        );

        // Initiating from the tag reference resolves to nothing.
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;
        program.rename_symbol("edgeOne", pos).unwrap();
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_ignores_region_call_shadowed_by_param() {
        // Inside `f`, `region` is the parameter, so the call is not the standard region
        // function; `r.tags.line1` must not be rewritten.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(region) {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(region) {
  r = region(segments = [s.edgeOne])
  return r.tags.line1
}
"#
        );
    }

    #[test]
    fn test_rename_fn_does_not_rename_calls_before_its_declaration() {
        // Before the local `sin` is declared, `sin(0)` is the standard library function; the
        // executor binds sequentially, so only references after the declaration are renamed.
        let code = r#"before = sin(0)
fn sin(x) {
  return x
}
after = sin(1)
"#;
        let mut program = parse(code);
        let pos = code.find("fn sin").unwrap() + "fn ".len() + 1;

        program.rename_symbol("mySin", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"before = sin(0)
fn mySin(x) {
  return x
}
after = mySin(1)
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_leaves_refs_before_it() {
        // Inside the block, references before the declaration resolve to the outer `line1`,
        // so only the declaration and references after it are renamed.
        let code = r#"line1 = 99
s = sketch(on = XY) {
  coincident([line1.end, line1.start])
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  parallel([line1, line1])
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line").unwrap() + 1;

        program.rename_symbol("edgeOne", pos).unwrap();

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"line1 = 99
s = sketch(on = XY) {
  coincident([line1.end, line1.start])
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
  parallel([edgeOne, edgeOne])
}
"#
        );
    }

    #[test]
    fn test_rename_rejects_invalid_name() {
        let code = r#"thing = 1
result = thing
"#;
        for bad in ["my name", "123abc", "if", "a-b", "", "a::b"] {
            let mut program = parse(code);
            let pos = code.find("thing").unwrap() + 1;
            let result = program.rename_symbol(bad, pos);
            assert!(result.is_err(), "expected `{bad}` to be rejected");
            // The name is validated before anything is renamed.
            assert_eq!(program.recast_top(&Default::default(), 0), code);
        }
    }

    #[test]
    fn test_rename_rejects_colliding_name() {
        // Renaming `a` to `b` would change what the existing references to `b` resolve to.
        // Note that only the target's own scope is checked; capture across nested scopes
        // (e.g. renaming a global to the name of some function's local) is not detected.
        let code = r#"a = 1
b = 2
x = a + b
"#;
        let mut program = parse(code);
        let pos = code.find('a').unwrap() + 1;
        let result = program.rename_symbol("b", pos);
        assert!(result.is_err(), "expected the collision with `b` to be rejected");
    }

    #[test]
    fn test_rename_rejects_colliding_name_in_sketch_block() {
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;
        let result = program.rename_symbol("line2", pos);
        assert!(result.is_err(), "expected the collision with `line2` to be rejected");
    }

    #[test]
    fn test_rename_rejects_colliding_param_name() {
        let code = r#"fn f(a, b) {
  return a + b
}
"#;
        let mut program = parse(code);
        let pos = code.find("a,").unwrap() + 1;
        let result = program.rename_symbol("b", pos);
        assert!(result.is_err(), "expected the collision with `b` to be rejected");
    }
}
