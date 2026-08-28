pub use kcl_api::kcl_value_view::*;
use serde::Serialize;

use crate::exec::KclValue;
use crate::execution::Metadata;
use crate::execution::TagIdentifier;
use crate::execution::geometry as runtime;
use crate::parsing::ast::types::TagNode;

fn json_view<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}

fn tag_declarator_view(tag: TagNode) -> TagDeclaratorView {
    TagDeclaratorView { name: tag.inner.name }
}

fn tag_identifier_view(tag: TagIdentifier) -> TagIdentifierView {
    TagIdentifierView { value: tag.value }
}

fn point3d_view(point: runtime::Point3d) -> Point3dView {
    Point3dView {
        x: point.x,
        y: point.y,
        z: point.z,
        units: point.units,
    }
}

fn plane_kind_view(kind: runtime::PlaneKind) -> PlaneKindView {
    match kind {
        runtime::PlaneKind::XY => PlaneKindView::XY,
        runtime::PlaneKind::XZ => PlaneKindView::XZ,
        runtime::PlaneKind::YZ => PlaneKindView::YZ,
        runtime::PlaneKind::Custom => PlaneKindView::Custom,
    }
}

fn plane_view(plane: runtime::Plane) -> PlaneView {
    PlaneView {
        id: plane.id,
        artifact_id: plane.artifact_id,
        object_id: plane.object_id,
        kind: plane_kind_view(plane.kind),
        origin: point3d_view(plane.info.origin),
        x_axis: point3d_view(plane.info.x_axis),
        y_axis: point3d_view(plane.info.y_axis),
        z_axis: point3d_view(plane.info.z_axis),
    }
}

fn face_view(face: runtime::Face) -> FaceView {
    FaceView {
        id: face.id,
        artifact_id: face.artifact_id,
    }
}

fn sketch_surface_view(surface: runtime::SketchSurface) -> SketchSurfaceView {
    match surface {
        runtime::SketchSurface::Plane(plane) => SketchSurfaceView::Plane(Box::new(plane_view(*plane))),
        runtime::SketchSurface::Face(face) => SketchSurfaceView::Face(Box::new(face_view(*face))),
    }
}

fn geo_meta_view(id: uuid::Uuid, metadata: Metadata) -> GeoMetaView {
    GeoMetaView {
        id,
        source_range: metadata.source_range,
    }
}

fn base_path_view(base: runtime::BasePath) -> BasePathView {
    BasePathView {
        from: base.from,
        to: base.to,
        units: base.units,
        tag: base.tag.map(tag_declarator_view),
        geo_meta: geo_meta_view(base.geo_meta.id, base.geo_meta.metadata),
    }
}

fn path_view(path: runtime::Path) -> PathView {
    match path {
        runtime::Path::ToPoint { base } => PathView::ToPoint {
            base: base_path_view(base),
        },
        runtime::Path::TangentialArcTo { base, center, ccw } => PathView::TangentialArcTo {
            base: base_path_view(base),
            center,
            ccw,
        },
        runtime::Path::TangentialArc { base, center, ccw } => PathView::TangentialArc {
            base: base_path_view(base),
            center,
            ccw,
        },
        runtime::Path::Circle {
            base,
            center,
            radius,
            ccw,
        } => PathView::Circle {
            base: base_path_view(base),
            center,
            radius,
            ccw,
        },
        runtime::Path::CircleThreePoint { base, p1, p2, p3 } => PathView::CircleThreePoint {
            base: base_path_view(base),
            p1,
            p2,
            p3,
        },
        runtime::Path::ArcThreePoint { base, p1, p2, p3 } => PathView::ArcThreePoint {
            base: base_path_view(base),
            p1,
            p2,
            p3,
        },
        runtime::Path::Horizontal { base, x } => PathView::Horizontal {
            base: base_path_view(base),
            x,
        },
        runtime::Path::AngledLineTo { base, x, y } => PathView::AngledLineTo {
            base: base_path_view(base),
            x,
            y,
        },
        runtime::Path::Base { base } => PathView::Base {
            base: base_path_view(base),
        },
        runtime::Path::Arc {
            base,
            center,
            radius,
            ccw,
        } => PathView::Arc {
            base: base_path_view(base),
            center,
            radius,
            ccw,
        },
        runtime::Path::Ellipse {
            base,
            center,
            major_axis,
            minor_radius,
            ccw,
        } => PathView::Ellipse {
            base: base_path_view(base),
            center,
            major_axis,
            minor_radius,
            ccw,
        },
        runtime::Path::Conic { base } => PathView::Conic {
            base: base_path_view(base),
        },
        runtime::Path::Bezier {
            base,
            control1,
            control2,
        } => PathView::Bezier {
            base: base_path_view(base),
            control1,
            control2,
        },
    }
}

fn profile_closed_view(closed: runtime::ProfileClosed) -> ProfileClosedView {
    match closed {
        runtime::ProfileClosed::No => ProfileClosedView::No,
        runtime::ProfileClosed::Maybe => ProfileClosedView::Maybe,
        runtime::ProfileClosed::Implicitly => ProfileClosedView::Implicitly,
        runtime::ProfileClosed::Explicitly => ProfileClosedView::Explicitly,
    }
}

fn sketch_view(sketch: runtime::Sketch) -> SketchView {
    SketchView {
        id: sketch.id,
        original_id: sketch.original_id,
        paths: sketch.paths.into_iter().map(path_view).collect(),
        inner_paths: sketch.inner_paths.into_iter().map(path_view).collect(),
        on: sketch_surface_view(sketch.on),
        start: base_path_view(sketch.start),
        tags: sketch
            .tags
            .into_iter()
            .map(|(name, tag)| (name, tag_identifier_view(tag)))
            .collect(),
        artifact_id: sketch.artifact_id,
        units: sketch.units,
        is_closed: profile_closed_view(sketch.is_closed),
    }
}

fn surface_view(face_id: uuid::Uuid, tag: Option<TagNode>, geo_meta: runtime::GeoMeta) -> SurfaceView {
    SurfaceView {
        face_id,
        tag: tag.map(tag_declarator_view),
        geo_meta: geo_meta_view(geo_meta.id, geo_meta.metadata),
    }
}

fn extrude_surface_view(surface: runtime::ExtrudeSurface) -> ExtrudeSurfaceView {
    match surface {
        runtime::ExtrudeSurface::ExtrudePlane(surface) => {
            ExtrudeSurfaceView::ExtrudePlane(surface_view(surface.face_id, surface.tag, surface.geo_meta))
        }
        runtime::ExtrudeSurface::ExtrudeArc(surface) => {
            ExtrudeSurfaceView::ExtrudeArc(surface_view(surface.face_id, surface.tag, surface.geo_meta))
        }
        runtime::ExtrudeSurface::Chamfer(surface) => {
            ExtrudeSurfaceView::Chamfer(surface_view(surface.face_id, surface.tag, surface.geo_meta))
        }
        runtime::ExtrudeSurface::Fillet(surface) => {
            ExtrudeSurfaceView::Fillet(surface_view(surface.face_id, surface.tag, surface.geo_meta))
        }
    }
}

fn solid_creator_view(creator: runtime::SolidCreator) -> SolidCreatorView {
    match creator {
        runtime::SolidCreator::Sketch(sketch) => SolidCreatorView::Sketch(sketch_view(sketch)),
        runtime::SolidCreator::Face(face) => SolidCreatorView::Face {
            face_id: face.face_id,
            solid_id: face.solid_id,
            sketch: sketch_view(face.sketch),
        },
        runtime::SolidCreator::Edge(edge) => SolidCreatorView::Edge {
            edge_id: edge.edge_id,
            body_id: edge.body_id,
        },
        runtime::SolidCreator::Procedural => SolidCreatorView::Procedural,
    }
}

fn edge_cut_view(edge_cut: runtime::EdgeCut) -> EdgeCutView {
    match edge_cut {
        runtime::EdgeCut::Fillet { id, edge_id, tag, .. } => EdgeCutView::Fillet {
            id,
            edge_id,
            tag: (*tag).map(tag_declarator_view),
        },
        runtime::EdgeCut::Chamfer { id, edge_id, tag, .. } => EdgeCutView::Chamfer {
            id,
            edge_id,
            tag: (*tag).map(tag_declarator_view),
        },
    }
}

fn solid_view(solid: runtime::Solid) -> SolidView {
    let original_id = solid.original_id();
    let topology_id = solid.topology_id();
    SolidView {
        id: solid.id,
        original_id,
        topology_id,
        artifact_id: solid.artifact_id,
        value: solid.value.into_iter().map(extrude_surface_view).collect(),
        faces: solid
            .faces
            .into_iter()
            .map(|(name, tag)| (name, tag_identifier_view(tag)))
            .collect(),
        creator: solid_creator_view(solid.creator),
        start_cap_id: solid.start_cap_id,
        end_cap_id: solid.end_cap_id,
        edge_cuts: solid.edge_cuts.into_iter().map(edge_cut_view).collect(),
        units: solid.units,
        sectional: solid.sectional,
    }
}

impl From<KclValue> for KclValueView {
    fn from(full: KclValue) -> Self {
        match full {
            KclValue::Uuid { value, .. } => Self::Uuid { value },
            KclValue::Bool { value, .. } => Self::Bool { value },
            KclValue::Number { value, ty, .. } => Self::Number { value, ty },
            KclValue::String { value, .. } => Self::String { value },
            KclValue::Enum { value } => Self::Enum {
                enum_name: value.enum_id().declared_name().to_owned(),
                variant: value.variant().to_owned(),
            },
            KclValue::SketchVar { value } => Self::SketchVar {
                value: Box::new(SketchVarView {
                    initial_value: value.initial_value,
                    ty: value.ty,
                }),
            },
            KclValue::SketchConstraint { value } => Self::SketchConstraint {
                value: json_view(&value),
            },
            KclValue::Tuple { value, .. } => Self::Tuple {
                value: value.into_iter().map(Self::from).collect(),
            },
            KclValue::HomArray { value, .. } => Self::HomArray {
                value: value.into_iter().map(Self::from).collect(),
            },
            KclValue::Object {
                value, constrainable, ..
            } => {
                let mut fields: Vec<_> = value.into_iter().collect();
                fields.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
                Self::Object {
                    value: fields
                        .into_iter()
                        .map(|(name, value)| (name, Self::from(value)))
                        .collect(),
                    constrainable,
                }
            }
            KclValue::TagIdentifier(tag) => Self::TagIdentifier(tag_identifier_view(*tag)),
            KclValue::TagDeclarator(tag) => Self::TagDeclarator {
                value: tag.inner.name.clone(),
            },
            KclValue::GdtAnnotation { value } => Self::GdtAnnotation {
                value: Box::new(GdtAnnotationView { id: value.id }),
            },
            KclValue::CameraView { value } => Self::CameraView {
                value: json_view(&value),
            },
            KclValue::NamedView { value } => Self::NamedView {
                value: json_view(&value),
            },
            KclValue::Plane { value } => Self::Plane {
                value: Box::new(plane_view(*value)),
            },
            KclValue::Face { value } => Self::Face {
                value: Box::new(face_view(*value)),
            },
            KclValue::BoundedEdge { value, .. } => Self::BoundedEdge {
                value: BoundedEdgeView {
                    face_id: value.face_id,
                    edge_id: value.edge_id,
                    lower_bound: value.lower_bound,
                    upper_bound: value.upper_bound,
                },
            },
            KclValue::Segment { value } => Self::Segment {
                value: json_view(&value),
            },
            KclValue::Sketch { value } => Self::Sketch {
                value: Box::new(sketch_view(*value)),
            },
            KclValue::Solid { value } => Self::Solid {
                value: Box::new(solid_view(*value)),
            },
            KclValue::Helix { value } => Self::Helix {
                value: Box::new(HelixView {
                    value: value.value,
                    artifact_id: value.artifact_id,
                    revolutions: value.revolutions,
                    angle_start: value.angle_start,
                    ccw: value.ccw,
                    cylinder_id: value.cylinder_id,
                    units: value.units,
                }),
            },
            KclValue::ImportedGeometry(value) => Self::ImportedGeometry(ImportedGeometryView {
                id: value.id,
                value: value.value,
            }),
            KclValue::Function { .. } => Self::Function {},
            KclValue::Module { value, .. } => Self::Module { value },
            KclValue::Type { experimental, .. } => Self::Type { experimental },
            KclValue::KclNone { .. } => Self::KclNone {},
        }
    }
}

/// Runtime helpers for API-owned path views.
#[allow(dead_code)]
pub trait PathViewExt {
    fn get_base(&self) -> &BasePathView;
    fn get_id(&self) -> uuid::Uuid {
        self.get_base().geo_meta.id
    }
    fn get_tag(&self) -> Option<TagDeclaratorView> {
        self.get_base().tag.clone()
    }
    fn arc_center_and_ccw(&self) -> Option<([f64; 2], bool)>;
}

impl PathViewExt for PathView {
    fn get_base(&self) -> &BasePathView {
        match self {
            Self::ToPoint { base }
            | Self::TangentialArcTo { base, .. }
            | Self::TangentialArc { base, .. }
            | Self::Circle { base, .. }
            | Self::CircleThreePoint { base, .. }
            | Self::ArcThreePoint { base, .. }
            | Self::Horizontal { base, .. }
            | Self::AngledLineTo { base, .. }
            | Self::Base { base }
            | Self::Arc { base, .. }
            | Self::Ellipse { base, .. }
            | Self::Conic { base }
            | Self::Bezier { base, .. } => base,
        }
    }

    fn arc_center_and_ccw(&self) -> Option<([f64; 2], bool)> {
        match self {
            Self::TangentialArcTo { center, ccw, .. }
            | Self::TangentialArc { center, ccw, .. }
            | Self::Arc { center, ccw, .. } => Some((*center, *ccw)),
            Self::ArcThreePoint { p1, p2, p3, .. } => {
                let circle = crate::std::utils::calculate_circle_from_3_points([*p1, *p2, *p3]);
                Some((circle.center, crate::std::utils::is_points_ccw(&[*p1, *p2, *p3]) > 0))
            }
            _ => None,
        }
    }
}

/// Runtime navigation helpers for API-owned solid views.
#[allow(dead_code)]
pub trait SolidViewExt {
    fn sketch(&self) -> Option<&SketchView>;
    fn original_id(&self) -> uuid::Uuid;
    fn topology_id(&self) -> uuid::Uuid;
}

impl SolidViewExt for SolidView {
    fn sketch(&self) -> Option<&SketchView> {
        match &self.creator {
            SolidCreatorView::Sketch(sketch) | SolidCreatorView::Face { sketch, .. } => Some(sketch),
            SolidCreatorView::Edge { .. } | SolidCreatorView::Procedural => None,
        }
    }

    fn original_id(&self) -> uuid::Uuid {
        self.original_id
    }

    fn topology_id(&self) -> uuid::Uuid {
        self.topology_id
    }
}

/// Runtime helpers for compact surface views.
#[allow(dead_code)]
pub trait ExtrudeSurfaceViewExt {
    fn get_id(&self) -> uuid::Uuid;
    fn get_tag(&self) -> Option<TagDeclaratorView>;
}

impl ExtrudeSurfaceViewExt for ExtrudeSurfaceView {
    fn get_id(&self) -> uuid::Uuid {
        match self {
            Self::ExtrudePlane(surface)
            | Self::ExtrudeArc(surface)
            | Self::Chamfer(surface)
            | Self::Fillet(surface) => surface.geo_meta.id,
        }
    }

    fn get_tag(&self) -> Option<TagDeclaratorView> {
        match self {
            Self::ExtrudePlane(surface)
            | Self::ExtrudeArc(surface)
            | Self::Chamfer(surface)
            | Self::Fillet(surface) => surface.tag.clone(),
        }
    }
}

/// Runtime helpers for compact edge-cut views.
#[allow(dead_code)]
pub trait EdgeCutViewExt {
    fn id(&self) -> uuid::Uuid;
    fn edge_id(&self) -> uuid::Uuid;
    fn tag(&self) -> Option<TagDeclaratorView>;
}

impl EdgeCutViewExt for EdgeCutView {
    fn id(&self) -> uuid::Uuid {
        match self {
            Self::Fillet { id, .. } | Self::Chamfer { id, .. } => *id,
        }
    }

    fn edge_id(&self) -> uuid::Uuid {
        match self {
            Self::Fillet { edge_id, .. } | Self::Chamfer { edge_id, .. } => *edge_id,
        }
    }

    fn tag(&self) -> Option<TagDeclaratorView> {
        match self {
            Self::Fillet { tag, .. } | Self::Chamfer { tag, .. } => tag.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number(value: f64) -> KclValue {
        KclValue::Number {
            value,
            ty: Default::default(),
            meta: Vec::new(),
        }
    }

    #[test]
    fn object_views_have_stable_field_order() {
        let runtime_value = KclValue::Object {
            value: std::collections::HashMap::from([
                ("zeta".to_owned(), number(2.0)),
                ("alpha".to_owned(), number(1.0)),
            ]),
            constrainable: false,
            object_kind: Default::default(),
            meta: Vec::new(),
        };

        let KclValueView::Object { value, .. } = KclValueView::from(runtime_value) else {
            panic!("expected object view");
        };

        assert_eq!(value.keys().map(String::as_str).collect::<Vec<_>>(), ["alpha", "zeta"]);
    }
}
