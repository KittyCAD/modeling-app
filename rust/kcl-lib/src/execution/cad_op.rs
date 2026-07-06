pub use kcl_api::OpHelix;
pub use kcl_api::OpKclValue;
pub use kcl_api::OpSketch;
pub use kcl_api::OpSolid;
pub use kcl_api::Operation;

use super::ArtifactId;
use super::KclValue;
use crate::NodePathExt;

pub trait OperationExt {
    fn fill_node_paths(&mut self, programs: &crate::execution::ProgramLookup, cached_body_items: usize);
}

impl OperationExt for Operation {
    fn fill_node_paths(&mut self, programs: &crate::execution::ProgramLookup, cached_body_items: usize) {
        match self {
            Operation::StdLibCall {
                node_path,
                source_range,
                stdlib_entry_source_range,
                ..
            } => {
                // If there's a stdlib entry source range, use that to fill the
                // node path. For example, this will point to the `hole()` call
                // instead of the `subtract()` call that's deep inside the
                // stdlib.
                let range = stdlib_entry_source_range.as_ref().unwrap_or(source_range);
                node_path.fill_placeholder(programs, cached_body_items, *range);
            }
            Operation::VariableDeclaration {
                node_path,
                source_range,
                ..
            }
            | Operation::GroupBegin {
                node_path,
                source_range,
                ..
            }
            | Operation::ModuleInstance {
                node_path,
                source_range,
                ..
            } => {
                node_path.fill_placeholder(programs, cached_body_items, *source_range);
            }
            Operation::GroupEnd => {}
        }
    }
}

pub fn op_from_kcl_value(value: &KclValue) -> OpKclValue {
    match value {
        KclValue::Uuid { value, .. } => OpKclValue::Uuid { value: *value },
        KclValue::Bool { value, .. } => OpKclValue::Bool { value: *value },
        KclValue::Number { value, ty, .. } => OpKclValue::Number { value: *value, ty: *ty },
        KclValue::String { value, .. } => OpKclValue::String { value: value.clone() },
        KclValue::SketchVar { value, .. } => OpKclValue::SketchVar {
            value: value.initial_value,
            ty: value.ty,
        },
        KclValue::SketchConstraint { .. } => {
            debug_assert!(false, "Sketch constraint cannot be represented in operations");
            OpKclValue::KclNone {}
        }
        KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => {
            let value = value.iter().map(op_from_kcl_value).collect();
            OpKclValue::Array { value }
        }
        KclValue::Object { value, .. } => {
            let value = value.iter().map(|(k, v)| (k.clone(), op_from_kcl_value(v))).collect();
            OpKclValue::Object { value }
        }
        KclValue::TagIdentifier(tag_identifier) => OpKclValue::TagIdentifier {
            value: tag_identifier.value.clone(),
            artifact_id: tag_identifier.get_cur_info().map(|info| ArtifactId::new(info.id)),
        },
        KclValue::TagDeclarator(node) => OpKclValue::TagDeclarator {
            name: node.name.clone(),
        },
        KclValue::GdtAnnotation { value } => OpKclValue::GdtAnnotation {
            artifact_id: ArtifactId::new(value.id),
        },
        KclValue::Plane { value } => OpKclValue::Plane {
            artifact_id: value.artifact_id,
        },
        KclValue::Face { value } => OpKclValue::Face {
            artifact_id: value.artifact_id,
        },
        KclValue::Segment { value } => match &value.repr {
            crate::execution::geometry::SegmentRepr::Unsolved { .. } => {
                // Arguments to constraint functions will be unsolved.
                OpKclValue::KclNone {}
            }
            crate::execution::geometry::SegmentRepr::Solved { segment, .. } => OpKclValue::Segment {
                artifact_id: ArtifactId::new(segment.id),
            },
        },
        KclValue::Sketch { value } => OpKclValue::Sketch {
            value: Box::new(OpSketch::new(value.artifact_id)),
        },
        KclValue::Solid { value } => OpKclValue::Solid {
            value: Box::new(OpSolid::new(value.artifact_id)),
        },
        KclValue::Helix { value } => OpKclValue::Helix {
            value: Box::new(OpHelix::new(value.artifact_id)),
        },
        KclValue::ImportedGeometry(imported_geometry) => OpKclValue::ImportedGeometry {
            artifact_id: ArtifactId::new(imported_geometry.id),
        },
        KclValue::Function { .. } => OpKclValue::Function {},
        KclValue::Module { .. } => OpKclValue::Module {},
        KclValue::KclNone { .. } => OpKclValue::KclNone {},
        KclValue::Type { .. } => OpKclValue::Type {},
        KclValue::BoundedEdge { .. } => OpKclValue::BoundedEdge {},
    }
}
