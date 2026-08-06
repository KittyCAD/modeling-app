use std::collections::BTreeSet;

use indexmap::IndexMap;

use crate::KclValueView;
use crate::SourceRange;
use crate::execution::ArtifactId;
use crate::execution::SegmentRepr;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::front::Point2d;
use crate::front::SourceRef;

use super::types::SketchSelector;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationOptions;
use super::types::SketchVisualizationPoint;

pub(super) fn validate_canvas(options: &SketchVisualizationOptions) -> Result<(), SketchVisualizationError> {
    let min_width = options.padding.saturating_mul(2).saturating_add(2);
    let min_height = options.padding.saturating_mul(2).saturating_add(2);
    if options.width < min_width || options.height < min_height {
        return Err(SketchVisualizationError::InvalidCanvas {
            width: options.width,
            height: options.height,
            padding: options.padding,
        });
    }
    Ok(())
}

pub(super) fn select_sketch<'a>(
    scene_objects: &'a [Object],
    variables: Option<&IndexMap<String, KclValueView>>,
    selector: &SketchSelector,
) -> Result<&'a Object, SketchVisualizationError> {
    match selector {
        SketchSelector::First => scene_objects
            .iter()
            .find(|object| matches!(object.kind, ObjectKind::Sketch(_)))
            .ok_or(SketchVisualizationError::NoSketches),
        SketchSelector::Name(name) => scene_objects
            .iter()
            .find(|object| matches!(object.kind, ObjectKind::Sketch(_)) && object.label == *name)
            .or_else(|| sketch_object_for_variable(scene_objects, variables, name))
            .ok_or_else(|| SketchVisualizationError::SketchNameNotFound(name.clone())),
        SketchSelector::Id(id) => {
            let object =
                object_by_id(scene_objects, *id).map_err(|_| SketchVisualizationError::SketchIdNotFound(id.0))?;
            if matches!(object.kind, ObjectKind::Sketch(_)) {
                Ok(object)
            } else {
                Err(SketchVisualizationError::SketchIdNotFound(id.0))
            }
        }
    }
}

fn sketch_object_for_variable<'a>(
    scene_objects: &'a [Object],
    variables: Option<&IndexMap<String, KclValueView>>,
    name: &str,
) -> Option<&'a Object> {
    let variables = variables?;
    let artifact_id = sketch_artifact_id_for_variable(variables, name);
    let source_range = sketch_source_range_for_variable(variables, name);

    scene_objects.iter().find(|object| {
        matches!(object.kind, ObjectKind::Sketch(_))
            && (artifact_id.is_some_and(|artifact_id| &object.artifact_id == artifact_id)
                || source_range.is_some_and(|source_range| object_source_range(object) == Some(source_range)))
    })
}

fn sketch_artifact_id_for_variable<'a>(
    variables: &'a IndexMap<String, KclValueView>,
    name: &str,
) -> Option<&'a ArtifactId> {
    variables.get(name).and_then(sketch_artifact_id_for_value)
}

fn sketch_artifact_id_for_value(value: &KclValueView) -> Option<&ArtifactId> {
    match value {
        KclValueView::Sketch { value } => Some(&value.artifact_id),
        KclValueView::Segment { value } => match &value.repr {
            SegmentRepr::Solved { segment } => segment.sketch.as_ref().map(|sketch| &sketch.artifact_id),
            SegmentRepr::Unsolved { .. } => None,
        },
        KclValueView::Tuple { value } | KclValueView::HomArray { value } => {
            value.iter().find_map(sketch_artifact_id_for_value)
        }
        KclValueView::Object { value, .. } => value.values().find_map(sketch_artifact_id_for_value),
        _ => None,
    }
}

fn sketch_source_range_for_variable(variables: &IndexMap<String, KclValueView>, name: &str) -> Option<SourceRange> {
    variables.get(name).and_then(sketch_source_range_for_value)
}

fn sketch_source_range_for_value(value: &KclValueView) -> Option<SourceRange> {
    match value {
        KclValueView::Sketch { value } => value.meta.first().map(|metadata| metadata.source_range),
        KclValueView::Segment { value } => match &value.repr {
            SegmentRepr::Solved { segment } => segment
                .sketch
                .as_ref()
                .and_then(|sketch| sketch.meta.first().map(|metadata| metadata.source_range)),
            SegmentRepr::Unsolved { .. } => None,
        },
        KclValueView::Tuple { value } | KclValueView::HomArray { value } => {
            value.iter().find_map(sketch_source_range_for_value)
        }
        KclValueView::Object { value, .. } => value.values().find_map(sketch_source_range_for_value),
        _ => None,
    }
}

fn object_source_range(object: &Object) -> Option<SourceRange> {
    match &object.source {
        SourceRef::Simple { range, .. } => Some(*range),
        SourceRef::BackTrace { ranges } => {
            let [(range, _)] = ranges.as_slice() else {
                return None;
            };
            Some(*range)
        }
    }
}

pub(super) fn object_by_id(scene_objects: &[Object], id: ObjectId) -> Result<&Object, SketchVisualizationError> {
    scene_objects
        .get(id.0)
        .filter(|object| object.id == id)
        .or_else(|| scene_objects.iter().find(|object| object.id == id))
        .ok_or(SketchVisualizationError::MissingObject { id: id.0 })
}

pub(super) fn collect_units(units: &mut BTreeSet<String>, point: &Point2d<Number>) {
    units.insert(format!("{:?}", point.x.units));
    units.insert(format!("{:?}", point.y.units));
}

pub(super) fn position_to_point(point: &Point2d<Number>) -> SketchVisualizationPoint {
    SketchVisualizationPoint {
        x: point.x.value,
        y: point.y.value,
    }
}

pub(super) fn non_empty_name(name: &str) -> Option<String> {
    if name.is_empty() { None } else { Some(name.to_owned()) }
}

pub(super) fn object_kind_name(kind: &ObjectKind) -> &'static str {
    match kind {
        ObjectKind::Nil => "nil",
        ObjectKind::Plane(_) => "plane",
        ObjectKind::Face(_) => "face",
        ObjectKind::Wall(_) => "wall",
        ObjectKind::Cap(_) => "cap",
        ObjectKind::Sketch(_) => "sketch",
        ObjectKind::Segment { .. } => "segment",
        ObjectKind::Constraint { .. } => "constraint",
    }
}
