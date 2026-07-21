use indexmap::IndexMap;
use kcl_error::SourceRange;
use serde::Serialize;

use super::ArtifactId;
use crate::ModuleId;
use crate::NumericType;
use crate::ast::ItemVisibility;
use crate::ast::node_path::NodePath;
use crate::front::ObjectId;

/// A CAD modeling operation for display in the feature tree, AKA operations
/// timeline.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Operation.ts")]
#[serde(tag = "type")]
pub enum Operation {
    #[serde(rename_all = "camelCase")]
    StdLibCall {
        name: String,
        /// The unlabeled argument to the function.
        unlabeled_arg: Option<OpArg>,
        /// The labeled keyword arguments to the function.
        labeled_args: IndexMap<String, OpArg>,
        /// The node path of the operation in the source code.
        node_path: NodePath,
        /// The true source range of the operation in the source code.
        source_range: SourceRange,
        /// The source range that's the boundary of calling the standard
        /// library.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stdlib_entry_source_range: Option<SourceRange>,
        /// True if the operation resulted in an error.
        #[serde(default, skip_serializing_if = "is_false")]
        is_error: bool,
    },
    #[serde(rename_all = "camelCase")]
    VariableDeclaration {
        /// The variable name.
        name: String,
        /// The value of the variable.
        value: OpKclValue,
        /// The visibility modifier of the variable, e.g. `export`.  `Default`
        /// means there is no visibility modifier.
        visibility: ItemVisibility,
        /// The node path of the operation in the source code.
        node_path: NodePath,
        /// The source range of the operation in the source code.
        source_range: SourceRange,
    },
    #[serde(rename_all = "camelCase")]
    GroupBegin {
        /// The details of the group.
        group: Group,
        /// The node path of the operation in the source code.
        node_path: NodePath,
        /// The source range of the operation in the source code.
        source_range: SourceRange,
    },
    #[serde(rename_all = "camelCase")]
    ModuleInstance {
        /// The name of the module being used.
        name: String,
        /// The ID of the module which can be used to determine its path.
        module_id: ModuleId,
        /// Whether this is a glob import (`import * from "foo.kcl"`).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        glob: bool,
        /// The node path of the operation in the source code.
        node_path: NodePath,
        /// The source range of the operation in the source code.
        source_range: SourceRange,
    },
    GroupEnd,
}

impl Operation {
    /// If the variant is `StdLibCall`, set the `is_error` field.
    pub fn set_std_lib_call_is_error(&mut self, is_err: bool) {
        match self {
            Self::StdLibCall { is_error, .. } => *is_error = is_err,
            Self::VariableDeclaration { .. }
            | Self::GroupBegin { .. }
            | Self::ModuleInstance { .. }
            | Self::GroupEnd => {}
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Operation.ts")]
#[serde(tag = "type")]
#[cfg_attr(not(target_arch = "wasm32"), expect(clippy::large_enum_variant))]
pub enum Group {
    /// A function call.
    #[serde(rename_all = "camelCase")]
    FunctionCall {
        /// The name of the user-defined function being called.  Anonymous
        /// functions have no name.
        name: Option<String>,
        /// The location of the function being called so that there's enough
        /// info to go to its definition.
        function_source_range: SourceRange,
        /// The unlabeled argument to the function.
        unlabeled_arg: Option<OpArg>,
        /// The labeled keyword arguments to the function.
        labeled_args: IndexMap<String, OpArg>,
    },
    /// A sketch block.
    #[allow(dead_code)]
    #[serde(rename_all = "camelCase")]
    SketchBlock {
        /// The ID of the sketch this group wraps.
        sketch_id: ObjectId,
    },
}

/// An argument to a CAD modeling operation.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpArg {
    /// The runtime value of the argument.  Instead of using [`KclValue`], we
    /// refer to scene objects using their [`ArtifactId`]s.
    value: OpKclValue,
    /// The KCL code expression for the argument.  This is used in the UI so
    /// that the user can edit the expression.
    source_range: SourceRange,
}

impl OpArg {
    pub fn new(value: OpKclValue, source_range: SourceRange) -> Self {
        Self { value, source_range }
    }
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A KCL value used in Operations.  `ArtifactId`s are used to refer to the
/// actual scene objects.  Any data not needed in the UI may be omitted.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Operation.ts")]
#[serde(tag = "type")]
pub enum OpKclValue {
    Uuid {
        value: ::uuid::Uuid,
    },
    Bool {
        value: bool,
    },
    Number {
        value: f64,
        ty: NumericType,
    },
    String {
        value: String,
    },
    SketchVar {
        value: f64,
        ty: NumericType,
    },
    Array {
        value: Vec<OpKclValue>,
    },
    Object {
        value: OpKclObjectFields,
    },
    TagIdentifier {
        /// The name of the tag identifier.
        value: String,
        /// The artifact ID of the object it refers to.
        artifact_id: Option<ArtifactId>,
    },
    TagDeclarator {
        name: String,
    },
    GdtAnnotation {
        artifact_id: ArtifactId,
    },
    Plane {
        artifact_id: ArtifactId,
    },
    Face {
        artifact_id: ArtifactId,
    },
    Sketch {
        value: Box<OpSketch>,
    },
    Segment {
        artifact_id: ArtifactId,
    },
    Solid {
        value: Box<OpSolid>,
    },
    Helix {
        value: Box<OpHelix>,
    },
    ImportedGeometry {
        artifact_id: ArtifactId,
    },
    Function {},
    Module {},
    Type {},
    KclNone {},
    BoundedEdge {},
}

pub type OpKclObjectFields = IndexMap<String, OpKclValue>;

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpSketch {
    artifact_id: ArtifactId,
}

impl OpSketch {
    pub fn new(artifact_id: ArtifactId) -> Self {
        Self { artifact_id }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpSolid {
    artifact_id: ArtifactId,
}

impl OpSolid {
    pub fn new(artifact_id: ArtifactId) -> Self {
        Self { artifact_id }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpHelix {
    artifact_id: ArtifactId,
}

impl OpHelix {
    pub fn new(artifact_id: ArtifactId) -> Self {
        Self { artifact_id }
    }
}
