pub(crate) mod digest;
pub mod modify;
pub mod types;

use crate::{
    parsing::ast::types::{BinaryPart, BodyItem, Expr, LiteralIdentifier, MemberObject},
    ModuleId,
};

impl BodyItem {
    pub fn module_id(&self) -> ModuleId {
        match self {
            BodyItem::ImportStatement(stmt) => stmt.module_id,
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.module_id,
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.module_id,
            BodyItem::TypeDeclaration(ty_declaration) => ty_declaration.module_id,
            BodyItem::ReturnStatement(return_statement) => return_statement.module_id,
        }
    }
}

impl Expr {
    pub fn module_id(&self) -> ModuleId {
        match self {
            Expr::Literal(literal) => literal.module_id,
            Expr::Identifier(identifier) => identifier.module_id,
            Expr::TagDeclarator(tag) => tag.module_id,
            Expr::BinaryExpression(binary_expression) => binary_expression.module_id,
            Expr::FunctionExpression(function_expression) => function_expression.module_id,
            Expr::CallExpression(call_expression) => call_expression.module_id,
            Expr::CallExpressionKw(call_expression) => call_expression.module_id,
            Expr::PipeExpression(pipe_expression) => pipe_expression.module_id,
            Expr::PipeSubstitution(pipe_substitution) => pipe_substitution.module_id,
            Expr::ArrayExpression(array_expression) => array_expression.module_id,
            Expr::ArrayRangeExpression(array_range) => array_range.module_id,
            Expr::ObjectExpression(object_expression) => object_expression.module_id,
            Expr::MemberExpression(member_expression) => member_expression.module_id,
            Expr::UnaryExpression(unary_expression) => unary_expression.module_id,
            Expr::IfExpression(expr) => expr.module_id,
            Expr::LabelledExpression(expr) => expr.expr.module_id(),
            Expr::AscribedExpression(expr) => expr.expr.module_id(),
            Expr::None(none) => none.module_id,
        }
    }
}

impl BinaryPart {
    pub fn module_id(&self) -> ModuleId {
        match self {
            BinaryPart::Literal(literal) => literal.module_id,
            BinaryPart::Identifier(identifier) => identifier.module_id,
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.module_id,
            BinaryPart::CallExpression(call_expression) => call_expression.module_id,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.module_id,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.module_id,
            BinaryPart::MemberExpression(member_expression) => member_expression.module_id,
            BinaryPart::IfExpression(e) => e.module_id,
        }
    }
}

impl MemberObject {
    pub fn module_id(&self) -> ModuleId {
        match self {
            MemberObject::MemberExpression(member_expression) => member_expression.module_id,
            MemberObject::Identifier(identifier) => identifier.module_id,
        }
    }
}

impl LiteralIdentifier {
    pub fn module_id(&self) -> ModuleId {
        match self {
            LiteralIdentifier::Identifier(identifier) => identifier.module_id,
            LiteralIdentifier::Literal(literal) => literal.module_id,
        }
    }
}

/// Collect all the kcl files in a directory, recursively.
#[cfg(not(target_arch = "wasm32"))]
#[async_recursion::async_recursion]
pub(crate) async fn walk_dir(dir: &std::path::PathBuf) -> Result<Vec<std::path::PathBuf>, anyhow::Error> {
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
        } else if path.extension().is_some_and(|ext| ext == "kcl") {
            files.push(path);
        }
    }

    Ok(files)
}

/// Recast all the kcl files in a directory, recursively.
#[cfg(not(target_arch = "wasm32"))]
pub async fn recast_dir(dir: &std::path::Path, options: &crate::FormatOptions) -> Result<(), crate::KclError> {
    let files = walk_dir(&dir.to_path_buf()).await.map_err(|err| {
        crate::KclError::Internal(crate::errors::KclErrorDetails {
            message: format!("Failed to walk directory `{}`: {:?}", dir.display(), err),
            source_ranges: vec![crate::SourceRange::default()],
        })
    })?;

    let futures = files
        .into_iter()
        .map(|file| {
            let options = options.clone();
            tokio::spawn(async move {
                let contents = tokio::fs::read_to_string(&file).await.map_err(|err| {
                    crate::KclError::Internal(crate::errors::KclErrorDetails {
                        message: format!("Failed to read file `{}`: {:?}", file.display(), err),
                        source_ranges: vec![crate::SourceRange::default()],
                    })
                })?;
                let program = crate::Program::parse_no_errs(&contents)?;
                let recast = program.recast_with_options(&options);
                tokio::fs::write(&file, recast).await.map_err(|err| {
                    crate::KclError::Internal(crate::errors::KclErrorDetails {
                        message: format!("Failed to write file `{}`: {:?}", file.display(), err),
                        source_ranges: vec![crate::SourceRange::default()],
                    })
                })?;

                Ok::<(), crate::KclError>(())
            })
        })
        .collect::<Vec<_>>();

    // Join all futures and await their completion
    let results = futures::future::join_all(futures).await;

    // Check if any of the futures failed.
    for result in results {
        result.map_err(|err| {
            crate::KclError::Internal(crate::errors::KclErrorDetails {
                message: format!("Failed to recast file: {:?}", err),
                source_ranges: vec![crate::SourceRange::default()],
            })
        })??;
    }

    Ok(())
}
