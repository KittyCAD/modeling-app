//! Lossless memory adapters. Keep every field, including fields omitted from display output.

use super::*;
use crate::execution::memory::snapshot;

#[derive(Serialize, Deserialize)]
#[serde(remote = "GdtAnnotation")]
struct GdtAnnotationSnapshot {
    id: uuid::Uuid,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(GdtAnnotation, GdtAnnotationSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Geometry")]
#[allow(clippy::large_enum_variant)]
enum GeometrySnapshot {
    Sketch(#[serde(with = "snapshot")] Sketch),
    Solid(#[serde(with = "snapshot")] Solid),
}
snapshot::snapshot_type!(Geometry, GeometrySnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ImportedGeometry")]
struct ImportedGeometrySnapshot {
    id: uuid::Uuid,
    value: Vec<String>,
    meta: Vec<Metadata>,
    completed: bool,
}
snapshot::snapshot_type!(ImportedGeometry, ImportedGeometrySnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Helix")]
struct HelixSnapshot {
    value: uuid::Uuid,
    artifact_id: ArtifactId,
    revolutions: f64,
    angle_start: f64,
    ccw: bool,
    cylinder_id: Option<uuid::Uuid>,
    units: UnitLength,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(Helix, HelixSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Plane")]
struct PlaneSnapshot {
    id: uuid::Uuid,
    artifact_id: ArtifactId,
    object_id: Option<ObjectId>,
    #[serde(with = "snapshot")]
    kind: PlaneKind,
    #[serde(with = "snapshot")]
    info: PlaneInfo,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(Plane, PlaneSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "PlaneInfo")]
struct PlaneInfoSnapshot {
    #[serde(with = "snapshot")]
    origin: Point3d,
    #[serde(with = "snapshot")]
    x_axis: Point3d,
    #[serde(with = "snapshot")]
    y_axis: Point3d,
    #[serde(with = "snapshot")]
    z_axis: Point3d,
}
snapshot::snapshot_type!(PlaneInfo, PlaneInfoSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Face")]
struct FaceSnapshot {
    id: uuid::Uuid,
    artifact_id: ArtifactId,
    object_id: ObjectId,
    value: String,
    #[serde(with = "snapshot")]
    x_axis: Point3d,
    #[serde(with = "snapshot")]
    y_axis: Point3d,
    #[serde(with = "snapshot")]
    parent_solid: FaceParentSolid,
    units: UnitLength,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(Face, FaceSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "FaceParentSolid")]
struct FaceParentSolidSnapshot {
    solid_id: Uuid,
    creator_sketch_id: Option<Uuid>,
    #[serde(with = "snapshot")]
    creator_sketch_is_closed: Option<ProfileClosed>,
    edge_cut_ids: Vec<Uuid>,
}
snapshot::snapshot_type!(FaceParentSolid, FaceParentSolidSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "BoundedEdge")]
struct BoundedEdgeSnapshot {
    face_id: uuid::Uuid,
    edge_id: Option<uuid::Uuid>,
    #[serde(with = "snapshot")]
    edge_specifier: Option<UnresolvedEdgeSpecifier>,
    lower_bound: f32,
    upper_bound: f32,
}
snapshot::snapshot_type!(BoundedEdge, BoundedEdgeSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "PlaneKind")]
enum PlaneKindSnapshot {
    XY,
    XZ,
    YZ,
    Custom,
}
snapshot::snapshot_type!(PlaneKind, PlaneKindSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Sketch")]
struct SketchSnapshot {
    id: uuid::Uuid,
    #[serde(with = "snapshot")]
    paths: imbl::Vector<Path>,
    #[serde(with = "snapshot")]
    inner_paths: Vec<Path>,
    #[serde(with = "snapshot")]
    on: SketchSurface,
    #[serde(with = "snapshot")]
    start: BasePath,
    #[serde(with = "snapshot")]
    tags: IndexMap<String, TagIdentifier>,
    artifact_id: ArtifactId,
    original_id: uuid::Uuid,
    origin_sketch_id: Option<uuid::Uuid>,
    mirror: Option<uuid::Uuid>,
    clone: Option<uuid::Uuid>,
    synthetic_jump_path_ids: Vec<uuid::Uuid>,
    units: UnitLength,
    meta: Vec<Metadata>,
    #[serde(with = "snapshot")]
    is_closed: ProfileClosed,
}
snapshot::snapshot_type!(Sketch, SketchSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ProfileClosed")]
enum ProfileClosedSnapshot {
    No,
    Maybe,
    Implicitly,
    Explicitly,
}
snapshot::snapshot_type!(ProfileClosed, ProfileClosedSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SketchSurface")]
enum SketchSurfaceSnapshot {
    Plane(#[serde(with = "snapshot")] Box<Plane>),
    Face(#[serde(with = "snapshot")] Box<Face>),
}
snapshot::snapshot_type!(SketchSurface, SketchSurfaceSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Solid")]
struct SolidSnapshot {
    id: uuid::Uuid,
    value_id: uuid::Uuid,
    topology_id: uuid::Uuid,
    tag_update_source_artifact_id: Option<ArtifactId>,
    pattern_source_artifact_id: Option<ArtifactId>,
    best_guess_body_type: Option<kcmc::shared::BodyType>,
    artifact_id: ArtifactId,
    #[serde(with = "snapshot")]
    value: Vec<ExtrudeSurface>,
    #[serde(with = "snapshot")]
    faces: IndexMap<String, TagIdentifier>,
    #[serde(with = "snapshot")]
    creator: SolidCreator,
    start_cap_id: Option<uuid::Uuid>,
    end_cap_id: Option<uuid::Uuid>,
    #[serde(with = "snapshot")]
    edge_cuts: Vec<EdgeCut>,
    pending_edge_cut_ids: Vec<uuid::Uuid>,
    units: UnitLength,
    sectional: bool,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(Solid, SolidSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "CreatorFace")]
struct CreatorFaceSnapshot {
    face_id: uuid::Uuid,
    solid_id: uuid::Uuid,
    #[serde(with = "snapshot")]
    sketch: Sketch,
}
snapshot::snapshot_type!(CreatorFace, CreatorFaceSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "CreatorEdge")]
struct CreatorEdgeSnapshot {
    edge_id: uuid::Uuid,
    body_id: uuid::Uuid,
}
snapshot::snapshot_type!(CreatorEdge, CreatorEdgeSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SolidCreator")]
enum SolidCreatorSnapshot {
    Sketch(#[serde(with = "snapshot")] Sketch),
    Face(#[serde(with = "snapshot")] CreatorFace),
    Edge(#[serde(with = "snapshot")] CreatorEdge),
    Procedural,
}
snapshot::snapshot_type!(SolidCreator, SolidCreatorSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "EdgeCut")]
enum EdgeCutSnapshot {
    Fillet {
        id: uuid::Uuid,
        radius: TyF64,
        edge_id: uuid::Uuid,
        #[serde(with = "snapshot")]
        tag: Box<Option<TagNode>>,
    },
    Chamfer {
        id: uuid::Uuid,
        length: TyF64,
        edge_id: uuid::Uuid,
        #[serde(with = "snapshot")]
        tag: Box<Option<TagNode>>,
    },
}
snapshot::snapshot_type!(EdgeCut, EdgeCutSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Point2d")]
struct Point2dSnapshot {
    x: f64,
    y: f64,
    units: UnitLength,
}
snapshot::snapshot_type!(Point2d, Point2dSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Point3d")]
struct Point3dSnapshot {
    x: f64,
    y: f64,
    z: f64,
    units: Option<UnitLength>,
}
snapshot::snapshot_type!(Point3d, Point3dSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "BasePath")]
struct BasePathSnapshot {
    from: [f64; 2],
    to: [f64; 2],
    units: UnitLength,
    #[serde(with = "snapshot")]
    tag: Option<TagNode>,
    #[serde(with = "snapshot")]
    geo_meta: GeoMeta,
}
snapshot::snapshot_type!(BasePath, BasePathSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "GeoMeta")]
struct GeoMetaSnapshot {
    id: uuid::Uuid,
    metadata: Metadata,
}
snapshot::snapshot_type!(GeoMeta, GeoMetaSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Path")]
enum PathSnapshot {
    ToPoint {
        #[serde(with = "snapshot")]
        base: BasePath,
    },
    TangentialArcTo {
        #[serde(with = "snapshot")]
        base: BasePath,
        center: [f64; 2],
        ccw: bool,
    },
    TangentialArc {
        #[serde(with = "snapshot")]
        base: BasePath,
        center: [f64; 2],
        ccw: bool,
    },
    Circle {
        #[serde(with = "snapshot")]
        base: BasePath,
        center: [f64; 2],
        radius: f64,
        ccw: bool,
    },
    CircleThreePoint {
        #[serde(with = "snapshot")]
        base: BasePath,
        p1: [f64; 2],
        p2: [f64; 2],
        p3: [f64; 2],
    },
    ArcThreePoint {
        #[serde(with = "snapshot")]
        base: BasePath,
        p1: [f64; 2],
        p2: [f64; 2],
        p3: [f64; 2],
    },
    Horizontal {
        #[serde(with = "snapshot")]
        base: BasePath,
        x: f64,
    },
    AngledLineTo {
        #[serde(with = "snapshot")]
        base: BasePath,
        x: Option<f64>,
        y: Option<f64>,
    },
    Base {
        #[serde(with = "snapshot")]
        base: BasePath,
    },
    Arc {
        #[serde(with = "snapshot")]
        base: BasePath,
        center: [f64; 2],
        radius: f64,
        ccw: bool,
    },
    Ellipse {
        #[serde(with = "snapshot")]
        base: BasePath,
        center: [f64; 2],
        major_axis: [f64; 2],
        minor_radius: f64,
        ccw: bool,
    },
    Conic {
        #[serde(with = "snapshot")]
        base: BasePath,
    },
    Bezier {
        #[serde(with = "snapshot")]
        base: BasePath,
        control1: [f64; 2],
        control2: [f64; 2],
    },
}
snapshot::snapshot_type!(Path, PathSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ExtrudeSurface")]
enum ExtrudeSurfaceSnapshot {
    ExtrudePlane(#[serde(with = "snapshot")] ExtrudePlane),
    ExtrudeArc(#[serde(with = "snapshot")] ExtrudeArc),
    Chamfer(#[serde(with = "snapshot")] ChamferSurface),
    Fillet(#[serde(with = "snapshot")] FilletSurface),
}
snapshot::snapshot_type!(ExtrudeSurface, ExtrudeSurfaceSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ChamferSurface")]
struct ChamferSurfaceSnapshot {
    face_id: uuid::Uuid,
    #[serde(with = "snapshot")]
    tag: Option<Node<TagDeclarator>>,
    #[serde(with = "snapshot")]
    geo_meta: GeoMeta,
}
snapshot::snapshot_type!(ChamferSurface, ChamferSurfaceSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "FilletSurface")]
struct FilletSurfaceSnapshot {
    face_id: uuid::Uuid,
    #[serde(with = "snapshot")]
    tag: Option<Node<TagDeclarator>>,
    #[serde(with = "snapshot")]
    geo_meta: GeoMeta,
}
snapshot::snapshot_type!(FilletSurface, FilletSurfaceSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ExtrudePlane")]
struct ExtrudePlaneSnapshot {
    face_id: uuid::Uuid,
    #[serde(with = "snapshot")]
    tag: Option<Node<TagDeclarator>>,
    #[serde(with = "snapshot")]
    geo_meta: GeoMeta,
}
snapshot::snapshot_type!(ExtrudePlane, ExtrudePlaneSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ExtrudeArc")]
struct ExtrudeArcSnapshot {
    face_id: uuid::Uuid,
    #[serde(with = "snapshot")]
    tag: Option<Node<TagDeclarator>>,
    #[serde(with = "snapshot")]
    geo_meta: GeoMeta,
}
snapshot::snapshot_type!(ExtrudeArc, ExtrudeArcSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SketchVar")]
struct SketchVarSnapshot {
    #[serde(with = "snapshot")]
    id: SketchVarId,
    initial_value: f64,
    ty: NumericType,
    node_path: Option<NodePath>,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(SketchVar, SketchVarSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "UnsolvedExpr")]
enum UnsolvedExprSnapshot {
    Known(TyF64),
    Unknown(#[serde(with = "snapshot")] SketchVarId),
}
snapshot::snapshot_type!(UnsolvedExpr, UnsolvedExprSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ConstrainablePoint2d")]
struct ConstrainablePoint2dSnapshot {
    #[serde(with = "snapshot")]
    vars: kcl_api::Point2d<SketchVarId>,
    object_id: ObjectId,
}
snapshot::snapshot_type!(ConstrainablePoint2d, ConstrainablePoint2dSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ConstrainablePoint2dOrOrigin")]
enum ConstrainablePoint2dOrOriginSnapshot {
    Point(#[serde(with = "snapshot")] ConstrainablePoint2d),
    Origin,
}
snapshot::snapshot_type!(ConstrainablePoint2dOrOrigin, ConstrainablePoint2dOrOriginSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ConstrainableLine2d")]
struct ConstrainableLine2dSnapshot {
    #[serde(with = "snapshot")]
    vars: [kcl_api::Point2d<SketchVarId>; 2],
    object_id: ObjectId,
}
snapshot::snapshot_type!(ConstrainableLine2d, ConstrainableLine2dSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "UnsolvedSegment")]
struct UnsolvedSegmentSnapshot {
    id: Uuid,
    object_id: ObjectId,
    #[serde(with = "snapshot")]
    kind: UnsolvedSegmentKind,
    #[serde(with = "snapshot")]
    tag: Option<TagIdentifier>,
    node_path: Option<NodePath>,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(UnsolvedSegment, UnsolvedSegmentSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "UnsolvedSegmentKind")]
enum UnsolvedSegmentKindSnapshot {
    Point {
        #[serde(with = "snapshot")]
        position: UnsolvedPoint2dExpr,
        ctor: Box<PointCtor>,
    },
    Line {
        #[serde(with = "snapshot")]
        start: UnsolvedPoint2dExpr,
        #[serde(with = "snapshot")]
        end: UnsolvedPoint2dExpr,
        ctor: Box<LineCtor>,
        start_object_id: ObjectId,
        end_object_id: ObjectId,
        construction: bool,
    },
    Arc {
        #[serde(with = "snapshot")]
        start: UnsolvedPoint2dExpr,
        #[serde(with = "snapshot")]
        end: UnsolvedPoint2dExpr,
        #[serde(with = "snapshot")]
        center: UnsolvedPoint2dExpr,
        ctor: Box<ArcCtor>,
        start_object_id: ObjectId,
        end_object_id: ObjectId,
        center_object_id: ObjectId,
        direction: ArcDirection,
        construction: bool,
    },
    Circle {
        #[serde(with = "snapshot")]
        start: UnsolvedPoint2dExpr,
        #[serde(with = "snapshot")]
        center: UnsolvedPoint2dExpr,
        ctor: Box<CircleCtor>,
        start_object_id: ObjectId,
        center_object_id: ObjectId,
        construction: bool,
    },
    ControlPointSpline {
        #[serde(with = "snapshot")]
        controls: Vec<UnsolvedPoint2dExpr>,
        ctor: Box<ControlPointSplineCtor>,
        control_object_ids: Vec<ObjectId>,
        control_polygon_edge_object_ids: Vec<ObjectId>,
        degree: u32,
        construction: bool,
    },
}
snapshot::snapshot_type!(UnsolvedSegmentKind, UnsolvedSegmentKindSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Segment")]
struct SegmentSnapshot {
    id: Uuid,
    object_id: ObjectId,
    #[serde(with = "snapshot")]
    kind: SegmentKind,
    #[serde(with = "snapshot")]
    surface: SketchSurface,
    sketch_id: Uuid,
    #[serde(with = "snapshot")]
    sketch: Option<Arc<Sketch>>,
    #[serde(with = "snapshot")]
    tag: Option<TagIdentifier>,
    node_path: Option<NodePath>,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(Segment, SegmentSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SegmentKind")]
enum SegmentKindSnapshot {
    Point {
        position: [TyF64; 2],
        ctor: Box<PointCtor>,
        freedom: Option<Freedom>,
    },
    Line {
        start: [TyF64; 2],
        end: [TyF64; 2],
        ctor: Box<LineCtor>,
        start_object_id: ObjectId,
        end_object_id: ObjectId,
        start_freedom: Option<Freedom>,
        end_freedom: Option<Freedom>,
        construction: bool,
    },
    Arc {
        start: [TyF64; 2],
        end: [TyF64; 2],
        center: [TyF64; 2],
        ctor: Box<ArcCtor>,
        start_object_id: ObjectId,
        end_object_id: ObjectId,
        center_object_id: ObjectId,
        start_freedom: Option<Freedom>,
        end_freedom: Option<Freedom>,
        center_freedom: Option<Freedom>,
        direction: ArcDirection,
        construction: bool,
    },
    Circle {
        start: [TyF64; 2],
        center: [TyF64; 2],
        ctor: Box<CircleCtor>,
        start_object_id: ObjectId,
        center_object_id: ObjectId,
        start_freedom: Option<Freedom>,
        center_freedom: Option<Freedom>,
        construction: bool,
    },
    ControlPointSpline {
        controls: Vec<[TyF64; 2]>,
        ctor: Box<ControlPointSplineCtor>,
        control_object_ids: Vec<ObjectId>,
        control_polygon_edge_object_ids: Vec<ObjectId>,
        control_freedoms: Vec<Option<Freedom>>,
        degree: u32,
        construction: bool,
    },
}
snapshot::snapshot_type!(SegmentKind, SegmentKindSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "AbstractSegment")]
struct AbstractSegmentSnapshot {
    #[serde(with = "snapshot")]
    repr: SegmentRepr,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(AbstractSegment, AbstractSegmentSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SegmentRepr")]
enum SegmentReprSnapshot {
    Unsolved {
        #[serde(with = "snapshot")]
        segment: Box<UnsolvedSegment>,
    },
    Solved {
        #[serde(with = "snapshot")]
        segment: Box<Segment>,
    },
}
snapshot::snapshot_type!(SegmentRepr, SegmentReprSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SketchConstraint")]
struct SketchConstraintSnapshot {
    #[serde(with = "snapshot")]
    kind: SketchConstraintKind,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(SketchConstraint, SketchConstraintSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "AngleSector")]
enum AngleSectorSnapshot {
    One,
    Two,
    Three,
    Four,
}
snapshot::snapshot_type!(AngleSector, AngleSectorSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "AngleConstraintMode")]
enum AngleConstraintModeSnapshot {
    LinesAtAngle,
    PointsAtAngle {
        #[serde(with = "snapshot")]
        sector: AngleSector,
        inverse: bool,
    },
}
snapshot::snapshot_type!(AngleConstraintMode, AngleConstraintModeSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SketchConstraintKind")]
enum SketchConstraintKindSnapshot {
    Angle {
        #[serde(with = "snapshot")]
        line0: ConstrainableLine2d,
        #[serde(with = "snapshot")]
        line1: ConstrainableLine2d,
        #[serde(with = "snapshot")]
        mode: AngleConstraintMode,
        label_position: Option<ApiPoint2d<Number>>,
    },
    Distance {
        #[serde(with = "snapshot")]
        points: [ConstrainablePoint2dOrOrigin; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    PointLineDistance {
        #[serde(with = "snapshot")]
        point: ConstrainablePoint2dOrOrigin,
        #[serde(with = "snapshot")]
        line: ConstrainableLine2d,
        input_object_ids: [Option<ObjectId>; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    LineLineDistance {
        #[serde(with = "snapshot")]
        line0: ConstrainableLine2d,
        #[serde(with = "snapshot")]
        line1: ConstrainableLine2d,
        input_object_ids: [ObjectId; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    PointCircularDistance {
        #[serde(with = "snapshot")]
        point: ConstrainablePoint2dOrOrigin,
        #[serde(with = "snapshot")]
        center: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        start: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        end: Option<ConstrainablePoint2d>,
        input_object_ids: [Option<ObjectId>; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    LineCircularDistance {
        #[serde(with = "snapshot")]
        line: ConstrainableLine2d,
        #[serde(with = "snapshot")]
        center: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        start: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        end: Option<ConstrainablePoint2d>,
        input_object_ids: [ObjectId; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    CircularCircularDistance {
        #[serde(with = "snapshot")]
        center0: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        start0: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        end0: Option<ConstrainablePoint2d>,
        #[serde(with = "snapshot")]
        center1: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        start1: ConstrainablePoint2d,
        #[serde(with = "snapshot")]
        end1: Option<ConstrainablePoint2d>,
        input_object_ids: [ObjectId; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    Radius {
        #[serde(with = "snapshot")]
        points: [ConstrainablePoint2d; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    Diameter {
        #[serde(with = "snapshot")]
        points: [ConstrainablePoint2d; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    HorizontalDistance {
        #[serde(with = "snapshot")]
        points: [ConstrainablePoint2dOrOrigin; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
    VerticalDistance {
        #[serde(with = "snapshot")]
        points: [ConstrainablePoint2dOrOrigin; 2],
        label_position: Option<ApiPoint2d<Number>>,
    },
}
snapshot::snapshot_type!(SketchConstraintKind, SketchConstraintKindSnapshot);
