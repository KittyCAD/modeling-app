use anyhow::Result;
use indexmap::IndexMap;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{ExecState, Metadata, TagEngineInfo, TagIdentifier, UnitLen},
    parsing::ast::types::{Node, NodeRef, TagDeclarator, TagNode},
};

type Point2D = kcmc::shared::Point2d<f64>;
type Point3D = kcmc::shared::Point3d<f64>;

/// A geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Geometry {
    Sketch(Box<Sketch>),
    Solid(Box<Solid>),
}

impl Geometry {
    pub fn id(&self) -> uuid::Uuid {
        match self {
            Geometry::Sketch(s) => s.id,
            Geometry::Solid(e) => e.id,
        }
    }
}

/// A set of geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::vec_box)]
pub enum Geometries {
    Sketches(Vec<Box<Sketch>>),
    Solids(Vec<Box<Solid>>),
}

impl From<Geometry> for Geometries {
    fn from(value: Geometry) -> Self {
        match value {
            Geometry::Sketch(x) => Self::Sketches(vec![x]),
            Geometry::Solid(x) => Self::Solids(vec![x]),
        }
    }
}

/// A sketch or a group of sketches.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::vec_box)]
pub enum SketchSet {
    Sketch(Box<Sketch>),
    Sketches(Vec<Box<Sketch>>),
}

impl SketchSet {
    pub fn meta(&self) -> Vec<Metadata> {
        match self {
            SketchSet::Sketch(sg) => sg.meta.clone(),
            SketchSet::Sketches(sg) => sg.iter().flat_map(|sg| sg.meta.clone()).collect(),
        }
    }
}

impl From<SketchSet> for Vec<Sketch> {
    fn from(value: SketchSet) -> Self {
        match value {
            SketchSet::Sketch(sg) => vec![*sg],
            SketchSet::Sketches(sgs) => sgs.into_iter().map(|sg| *sg).collect(),
        }
    }
}

impl From<Sketch> for SketchSet {
    fn from(sg: Sketch) -> Self {
        SketchSet::Sketch(Box::new(sg))
    }
}

impl From<Box<Sketch>> for SketchSet {
    fn from(sg: Box<Sketch>) -> Self {
        SketchSet::Sketch(sg)
    }
}

impl From<Vec<Sketch>> for SketchSet {
    fn from(sg: Vec<Sketch>) -> Self {
        if sg.len() == 1 {
            SketchSet::Sketch(Box::new(sg[0].clone()))
        } else {
            SketchSet::Sketches(sg.into_iter().map(Box::new).collect())
        }
    }
}

impl From<Vec<Box<Sketch>>> for SketchSet {
    fn from(sg: Vec<Box<Sketch>>) -> Self {
        if sg.len() == 1 {
            SketchSet::Sketch(sg[0].clone())
        } else {
            SketchSet::Sketches(sg)
        }
    }
}

impl From<SketchSet> for Vec<Box<Sketch>> {
    fn from(sg: SketchSet) -> Self {
        match sg {
            SketchSet::Sketch(sg) => vec![sg],
            SketchSet::Sketches(sgs) => sgs,
        }
    }
}

impl From<&Sketch> for Vec<Box<Sketch>> {
    fn from(sg: &Sketch) -> Self {
        vec![Box::new(sg.clone())]
    }
}

impl From<Box<Sketch>> for Vec<Box<Sketch>> {
    fn from(sg: Box<Sketch>) -> Self {
        vec![sg]
    }
}

/// A solid or a group of solids.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::vec_box)]
pub enum SolidSet {
    Solid(Box<Solid>),
    Solids(Vec<Box<Solid>>),
}

impl From<Solid> for SolidSet {
    fn from(eg: Solid) -> Self {
        SolidSet::Solid(Box::new(eg))
    }
}

impl From<Box<Solid>> for SolidSet {
    fn from(eg: Box<Solid>) -> Self {
        SolidSet::Solid(eg)
    }
}

impl From<Vec<Solid>> for SolidSet {
    fn from(eg: Vec<Solid>) -> Self {
        if eg.len() == 1 {
            SolidSet::Solid(Box::new(eg[0].clone()))
        } else {
            SolidSet::Solids(eg.into_iter().map(Box::new).collect())
        }
    }
}

impl From<Vec<Box<Solid>>> for SolidSet {
    fn from(eg: Vec<Box<Solid>>) -> Self {
        if eg.len() == 1 {
            SolidSet::Solid(eg[0].clone())
        } else {
            SolidSet::Solids(eg)
        }
    }
}

impl From<SolidSet> for Vec<Box<Solid>> {
    fn from(eg: SolidSet) -> Self {
        match eg {
            SolidSet::Solid(eg) => vec![eg],
            SolidSet::Solids(egs) => egs,
        }
    }
}

impl From<&Solid> for Vec<Box<Solid>> {
    fn from(eg: &Solid) -> Self {
        vec![Box::new(eg.clone())]
    }
}

impl From<Box<Solid>> for Vec<Box<Solid>> {
    fn from(eg: Box<Solid>) -> Self {
        vec![eg]
    }
}

/// Data for an imported geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGeometry {
    /// The ID of the imported geometry.
    pub id: uuid::Uuid,
    /// The original file paths.
    pub value: Vec<String>,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// A helix.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Helix {
    /// The id of the helix.
    pub value: uuid::Uuid,
    /// Number of revolutions.
    pub revolutions: f64,
    /// Start angle (in degrees).
    pub angle_start: f64,
    /// Is the helix rotation counter clockwise?
    pub ccw: bool,
    pub units: UnitLen,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// A plane.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    /// The id of the plane.
    pub id: uuid::Uuid,
    // The code for the plane either a string or custom.
    pub value: PlaneType,
    /// Origin of the plane.
    pub origin: Point3d,
    /// What should the plane’s X axis be?
    pub x_axis: Point3d,
    /// What should the plane’s Y axis be?
    pub y_axis: Point3d,
    /// The z-axis (normal).
    pub z_axis: Point3d,
    pub units: UnitLen,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl Plane {
    pub(crate) fn from_plane_data(value: crate::std::sketch::PlaneData, exec_state: &mut ExecState) -> Self {
        let id = exec_state.global.id_generator.next_uuid();
        match value {
            crate::std::sketch::PlaneData::XY => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 1.0, 0.0),
                z_axis: Point3d::new(0.0, 0.0, 1.0),
                value: PlaneType::XY,
                units: exec_state.length_unit(),
                meta: vec![],
            },
            crate::std::sketch::PlaneData::NegXY => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 1.0, 0.0),
                z_axis: Point3d::new(0.0, 0.0, -1.0),
                value: PlaneType::XY,
                units: exec_state.length_unit(),
                meta: vec![],
            },
            crate::std::sketch::PlaneData::XZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(0.0, -1.0, 0.0),
                value: PlaneType::XZ,
                units: exec_state.length_unit(),
                meta: vec![],
            },
            crate::std::sketch::PlaneData::NegXZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(-1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(0.0, 1.0, 0.0),
                value: PlaneType::XZ,
                units: exec_state.length_unit(),
                meta: vec![],
            },
            crate::std::sketch::PlaneData::YZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(0.0, 1.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(1.0, 0.0, 0.0),
                value: PlaneType::YZ,
                units: exec_state.length_unit(),
                meta: vec![],
            },
            crate::std::sketch::PlaneData::NegYZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(0.0, 1.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(-1.0, 0.0, 0.0),
                value: PlaneType::YZ,
                units: exec_state.length_unit(),
                meta: vec![],
            },
            crate::std::sketch::PlaneData::Plane {
                origin,
                x_axis,
                y_axis,
                z_axis,
            } => Plane {
                id,
                origin: *origin,
                x_axis: *x_axis,
                y_axis: *y_axis,
                z_axis: *z_axis,
                value: PlaneType::Custom,
                units: exec_state.length_unit(),
                meta: vec![],
            },
        }
    }

    /// The standard planes are XY, YZ and XZ (in both positive and negative)
    pub fn is_standard(&self) -> bool {
        !self.is_custom()
    }

    /// The standard planes are XY, YZ and XZ (in both positive and negative)
    /// Custom planes are any other plane that the user might specify.
    pub fn is_custom(&self) -> bool {
        matches!(self.value, PlaneType::Custom)
    }
}

/// A face.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    /// The id of the face.
    pub id: uuid::Uuid,
    /// The tag of the face.
    pub value: String,
    /// What should the face’s X axis be?
    pub x_axis: Point3d,
    /// What should the face’s Y axis be?
    pub y_axis: Point3d,
    /// The z-axis (normal).
    pub z_axis: Point3d,
    /// The solid the face is on.
    pub solid: Box<Solid>,
    pub units: UnitLen,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// Type for a plane.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
#[display(style = "camelCase")]
pub enum PlaneType {
    #[serde(rename = "XY", alias = "xy")]
    #[display("XY")]
    XY,
    #[serde(rename = "XZ", alias = "xz")]
    #[display("XZ")]
    XZ,
    #[serde(rename = "YZ", alias = "yz")]
    #[display("YZ")]
    YZ,
    /// A custom plane.
    #[serde(rename = "Custom")]
    #[display("Custom")]
    Custom,
}

/// A sketch is a collection of paths.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct Sketch {
    /// The id of the sketch (this will change when the engine's reference to it changes).
    pub id: uuid::Uuid,
    /// The paths in the sketch.
    pub paths: Vec<Path>,
    /// What the sketch is on (can be a plane or a face).
    pub on: SketchSurface,
    /// The starting path.
    pub start: BasePath,
    /// Tag identifiers that have been declared in this sketch.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub tags: IndexMap<String, TagIdentifier>,
    /// The original id of the sketch. This stays the same even if the sketch is
    /// is sketched on face etc.
    #[serde(skip)]
    pub original_id: uuid::Uuid,
    pub units: UnitLen,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// A sketch type.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SketchSurface {
    Plane(Box<Plane>),
    Face(Box<Face>),
}

impl SketchSurface {
    pub(crate) fn id(&self) -> uuid::Uuid {
        match self {
            SketchSurface::Plane(plane) => plane.id,
            SketchSurface::Face(face) => face.id,
        }
    }
    pub(crate) fn x_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.x_axis,
            SketchSurface::Face(face) => face.x_axis,
        }
    }
    pub(crate) fn y_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.y_axis,
            SketchSurface::Face(face) => face.y_axis,
        }
    }
    pub(crate) fn z_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.z_axis,
            SketchSurface::Face(face) => face.z_axis,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) enum GetTangentialInfoFromPathsResult {
    PreviousPoint([f64; 2]),
    Arc { center: [f64; 2], ccw: bool },
    Circle { center: [f64; 2], ccw: bool, radius: f64 },
}

impl GetTangentialInfoFromPathsResult {
    pub(crate) fn tan_previous_point(&self, last_arc_end: crate::std::utils::Coords2d) -> [f64; 2] {
        match self {
            GetTangentialInfoFromPathsResult::PreviousPoint(p) => *p,
            GetTangentialInfoFromPathsResult::Arc { center, ccw, .. } => {
                crate::std::utils::get_tangent_point_from_previous_arc(*center, *ccw, last_arc_end)
            }
            // The circle always starts at 0 degrees, so a suitable tangent
            // point is either directly above or below.
            GetTangentialInfoFromPathsResult::Circle {
                center, radius, ccw, ..
            } => [center[0] + radius, center[1] + if *ccw { -1.0 } else { 1.0 }],
        }
    }
}

impl Sketch {
    pub(crate) fn add_tag(&mut self, tag: NodeRef<'_, TagDeclarator>, current_path: &Path) {
        let mut tag_identifier: TagIdentifier = tag.into();
        let base = current_path.get_base();
        tag_identifier.info = Some(TagEngineInfo {
            id: base.geo_meta.id,
            sketch: self.id,
            path: Some(current_path.clone()),
            surface: None,
        });

        self.tags.insert(tag.name.to_string(), tag_identifier);
    }

    /// Get the path most recently sketched.
    pub(crate) fn latest_path(&self) -> Option<&Path> {
        self.paths.last()
    }

    /// The "pen" is an imaginary pen drawing the path.
    /// This gets the current point the pen is hovering over, i.e. the point
    /// where the last path segment ends, and the next path segment will begin.
    pub(crate) fn current_pen_position(&self) -> Result<Point2d, KclError> {
        let Some(path) = self.latest_path() else {
            return Ok(self.start.to.into());
        };

        let base = path.get_base();
        Ok(base.to.into())
    }

    pub(crate) fn get_tangential_info_from_paths(&self) -> GetTangentialInfoFromPathsResult {
        let Some(path) = self.latest_path() else {
            return GetTangentialInfoFromPathsResult::PreviousPoint(self.start.to);
        };
        path.get_tangential_info()
    }
}

/// An solid is a collection of extrude surfaces.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct Solid {
    /// The id of the solid.
    pub id: uuid::Uuid,
    /// The extrude surfaces.
    pub value: Vec<ExtrudeSurface>,
    /// The sketch.
    pub sketch: Sketch,
    /// The height of the solid.
    pub height: f64,
    /// The id of the extrusion start cap
    pub start_cap_id: Option<uuid::Uuid>,
    /// The id of the extrusion end cap
    pub end_cap_id: Option<uuid::Uuid>,
    /// Chamfers or fillets on this solid.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<EdgeCut>,
    pub units: UnitLen,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl Solid {
    pub(crate) fn get_all_edge_cut_ids(&self) -> Vec<uuid::Uuid> {
        self.edge_cuts.iter().map(|foc| foc.id()).collect()
    }
}

/// An solid ID and its fillet and chamfer IDs.  This is needed for lazy
/// fillet evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct SolidLazyIds {
    pub solid_id: uuid::Uuid,
    pub sketch_id: uuid::Uuid,
    /// Chamfers or fillets on this solid.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<uuid::Uuid>,
}

impl From<&Solid> for SolidLazyIds {
    fn from(eg: &Solid) -> Self {
        Self {
            solid_id: eg.id,
            sketch_id: eg.sketch.id,
            edge_cuts: eg.edge_cuts.iter().map(|foc| foc.id()).collect(),
        }
    }
}

/// A fillet or a chamfer.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EdgeCut {
    /// A fillet.
    Fillet {
        /// The id of the engine command that called this fillet.
        id: uuid::Uuid,
        radius: f64,
        /// The engine id of the edge to fillet.
        #[serde(rename = "edgeId")]
        edge_id: uuid::Uuid,
        tag: Box<Option<TagNode>>,
    },
    /// A chamfer.
    Chamfer {
        /// The id of the engine command that called this chamfer.
        id: uuid::Uuid,
        length: f64,
        /// The engine id of the edge to chamfer.
        #[serde(rename = "edgeId")]
        edge_id: uuid::Uuid,
        tag: Box<Option<TagNode>>,
    },
}

impl EdgeCut {
    pub fn id(&self) -> uuid::Uuid {
        match self {
            EdgeCut::Fillet { id, .. } => *id,
            EdgeCut::Chamfer { id, .. } => *id,
        }
    }

    pub fn edge_id(&self) -> uuid::Uuid {
        match self {
            EdgeCut::Fillet { edge_id, .. } => *edge_id,
            EdgeCut::Chamfer { edge_id, .. } => *edge_id,
        }
    }

    pub fn tag(&self) -> Option<TagNode> {
        match self {
            EdgeCut::Fillet { tag, .. } => *tag.clone(),
            EdgeCut::Chamfer { tag, .. } => *tag.clone(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, Copy, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Point2d {
    pub x: f64,
    pub y: f64,
}

impl From<[f64; 2]> for Point2d {
    fn from(p: [f64; 2]) -> Self {
        Self { x: p[0], y: p[1] }
    }
}

impl From<&[f64; 2]> for Point2d {
    fn from(p: &[f64; 2]) -> Self {
        Self { x: p[0], y: p[1] }
    }
}

impl From<Point2d> for [f64; 2] {
    fn from(p: Point2d) -> Self {
        [p.x, p.y]
    }
}

impl From<Point2d> for Point2D {
    fn from(p: Point2d) -> Self {
        Self { x: p.x, y: p.y }
    }
}

impl Point2d {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };
    pub fn scale(self, scalar: f64) -> Self {
        Self {
            x: self.x * scalar,
            y: self.y * scalar,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, Copy, ts_rs::TS, JsonSchema, Default)]
#[ts(export)]
pub struct Point3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3d {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0, z: 0.0 };
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
}

impl From<Point3d> for Point3D {
    fn from(p: Point3d) -> Self {
        Self { x: p.x, y: p.y, z: p.z }
    }
}
impl From<Point3d> for kittycad_modeling_cmds::shared::Point3d<LengthUnit> {
    fn from(p: Point3d) -> Self {
        Self {
            x: LengthUnit(p.x),
            y: LengthUnit(p.y),
            z: LengthUnit(p.z),
        }
    }
}

/// A base path.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BasePath {
    /// The from point.
    #[ts(type = "[number, number]")]
    pub from: [f64; 2],
    /// The to point.
    #[ts(type = "[number, number]")]
    pub to: [f64; 2],
    /// The tag of the path.
    pub tag: Option<TagNode>,
    /// Metadata.
    #[serde(rename = "__geoMeta")]
    pub geo_meta: GeoMeta,
}

/// Geometry metadata.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GeoMeta {
    /// The id of the geometry.
    pub id: uuid::Uuid,
    /// Metadata.
    #[serde(flatten)]
    pub metadata: Metadata,
}

/// A path.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Path {
    /// A path that goes to a point.
    ToPoint {
        #[serde(flatten)]
        base: BasePath,
    },
    /// A arc that is tangential to the last path segment that goes to a point
    TangentialArcTo {
        #[serde(flatten)]
        base: BasePath,
        /// the arc's center
        #[ts(type = "[number, number]")]
        center: [f64; 2],
        /// arc's direction
        ccw: bool,
    },
    /// A arc that is tangential to the last path segment
    TangentialArc {
        #[serde(flatten)]
        base: BasePath,
        /// the arc's center
        #[ts(type = "[number, number]")]
        center: [f64; 2],
        /// arc's direction
        ccw: bool,
    },
    // TODO: consolidate segment enums, remove Circle. https://github.com/KittyCAD/modeling-app/issues/3940
    /// a complete arc
    Circle {
        #[serde(flatten)]
        base: BasePath,
        /// the arc's center
        #[ts(type = "[number, number]")]
        center: [f64; 2],
        /// the arc's radius
        radius: f64,
        /// arc's direction
        /// This is used to compute the tangential angle.
        ccw: bool,
    },
    /// A path that is horizontal.
    Horizontal {
        #[serde(flatten)]
        base: BasePath,
        /// The x coordinate.
        x: f64,
    },
    /// An angled line to.
    AngledLineTo {
        #[serde(flatten)]
        base: BasePath,
        /// The x coordinate.
        x: Option<f64>,
        /// The y coordinate.
        y: Option<f64>,
    },
    /// A base path.
    Base {
        #[serde(flatten)]
        base: BasePath,
    },
    /// A circular arc, not necessarily tangential to the current point.
    Arc {
        #[serde(flatten)]
        base: BasePath,
        /// Center of the circle that this arc is drawn on.
        center: [f64; 2],
        /// Radius of the circle that this arc is drawn on.
        radius: f64,
        /// True if the arc is counterclockwise.
        ccw: bool,
    },
}

/// What kind of path is this?
#[derive(Display)]
enum PathType {
    ToPoint,
    Base,
    TangentialArc,
    TangentialArcTo,
    Circle,
    Horizontal,
    AngledLineTo,
    Arc,
}

impl From<&Path> for PathType {
    fn from(value: &Path) -> Self {
        match value {
            Path::ToPoint { .. } => Self::ToPoint,
            Path::TangentialArcTo { .. } => Self::TangentialArcTo,
            Path::TangentialArc { .. } => Self::TangentialArc,
            Path::Circle { .. } => Self::Circle,
            Path::Horizontal { .. } => Self::Horizontal,
            Path::AngledLineTo { .. } => Self::AngledLineTo,
            Path::Base { .. } => Self::Base,
            Path::Arc { .. } => Self::Arc,
        }
    }
}

impl Path {
    pub fn get_id(&self) -> uuid::Uuid {
        match self {
            Path::ToPoint { base } => base.geo_meta.id,
            Path::Horizontal { base, .. } => base.geo_meta.id,
            Path::AngledLineTo { base, .. } => base.geo_meta.id,
            Path::Base { base } => base.geo_meta.id,
            Path::TangentialArcTo { base, .. } => base.geo_meta.id,
            Path::TangentialArc { base, .. } => base.geo_meta.id,
            Path::Circle { base, .. } => base.geo_meta.id,
            Path::Arc { base, .. } => base.geo_meta.id,
        }
    }

    pub fn get_tag(&self) -> Option<TagNode> {
        match self {
            Path::ToPoint { base } => base.tag.clone(),
            Path::Horizontal { base, .. } => base.tag.clone(),
            Path::AngledLineTo { base, .. } => base.tag.clone(),
            Path::Base { base } => base.tag.clone(),
            Path::TangentialArcTo { base, .. } => base.tag.clone(),
            Path::TangentialArc { base, .. } => base.tag.clone(),
            Path::Circle { base, .. } => base.tag.clone(),
            Path::Arc { base, .. } => base.tag.clone(),
        }
    }

    pub fn get_base(&self) -> &BasePath {
        match self {
            Path::ToPoint { base } => base,
            Path::Horizontal { base, .. } => base,
            Path::AngledLineTo { base, .. } => base,
            Path::Base { base } => base,
            Path::TangentialArcTo { base, .. } => base,
            Path::TangentialArc { base, .. } => base,
            Path::Circle { base, .. } => base,
            Path::Arc { base, .. } => base,
        }
    }

    /// Where does this path segment start?
    pub fn get_from(&self) -> &[f64; 2] {
        &self.get_base().from
    }
    /// Where does this path segment end?
    pub fn get_to(&self) -> &[f64; 2] {
        &self.get_base().to
    }

    /// Length of this path segment, in cartesian plane.
    pub fn length(&self) -> f64 {
        match self {
            Self::ToPoint { .. } | Self::Base { .. } | Self::Horizontal { .. } | Self::AngledLineTo { .. } => {
                linear_distance(self.get_from(), self.get_to())
            }
            Self::TangentialArc {
                base: _,
                center,
                ccw: _,
            }
            | Self::TangentialArcTo {
                base: _,
                center,
                ccw: _,
            } => {
                // The radius can be calculated as the linear distance between `to` and `center`,
                // or between `from` and `center`. They should be the same.
                let radius = linear_distance(self.get_from(), center);
                debug_assert_eq!(radius, linear_distance(self.get_to(), center));
                // TODO: Call engine utils to figure this out.
                linear_distance(self.get_from(), self.get_to())
            }
            Self::Circle { radius, .. } => 2.0 * std::f64::consts::PI * radius,
            Self::Arc { .. } => {
                // TODO: Call engine utils to figure this out.
                linear_distance(self.get_from(), self.get_to())
            }
        }
    }

    pub fn get_base_mut(&mut self) -> Option<&mut BasePath> {
        match self {
            Path::ToPoint { base } => Some(base),
            Path::Horizontal { base, .. } => Some(base),
            Path::AngledLineTo { base, .. } => Some(base),
            Path::Base { base } => Some(base),
            Path::TangentialArcTo { base, .. } => Some(base),
            Path::TangentialArc { base, .. } => Some(base),
            Path::Circle { base, .. } => Some(base),
            Path::Arc { base, .. } => Some(base),
        }
    }

    pub(crate) fn get_tangential_info(&self) -> GetTangentialInfoFromPathsResult {
        match self {
            Path::TangentialArc { center, ccw, .. }
            | Path::TangentialArcTo { center, ccw, .. }
            | Path::Arc { center, ccw, .. } => GetTangentialInfoFromPathsResult::Arc {
                center: *center,
                ccw: *ccw,
            },
            Path::Circle {
                center, ccw, radius, ..
            } => GetTangentialInfoFromPathsResult::Circle {
                center: *center,
                ccw: *ccw,
                radius: *radius,
            },
            Path::ToPoint { .. } | Path::Horizontal { .. } | Path::AngledLineTo { .. } | Path::Base { .. } => {
                let base = self.get_base();
                GetTangentialInfoFromPathsResult::PreviousPoint(base.from)
            }
        }
    }
}

/// Compute the straight-line distance between a pair of (2D) points.
#[rustfmt::skip]
fn linear_distance(
    [x0, y0]: &[f64; 2],
    [x1, y1]: &[f64; 2]
) -> f64 {
    let y_sq = (y1 - y0).powi(2);
    let x_sq = (x1 - x0).powi(2);
    (y_sq + x_sq).sqrt()
}

/// An extrude surface.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtrudeSurface {
    /// An extrude plane.
    ExtrudePlane(ExtrudePlane),
    ExtrudeArc(ExtrudeArc),
    Chamfer(ChamferSurface),
    Fillet(FilletSurface),
}

// Chamfer surface.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChamferSurface {
    /// The id for the chamfer surface.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

// Fillet surface.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FilletSurface {
    /// The id for the fillet surface.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

/// An extruded plane.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExtrudePlane {
    /// The face id for the extrude plane.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

/// An extruded arc.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExtrudeArc {
    /// The face id for the extrude plane.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

impl ExtrudeSurface {
    pub fn get_id(&self) -> uuid::Uuid {
        match self {
            ExtrudeSurface::ExtrudePlane(ep) => ep.geo_meta.id,
            ExtrudeSurface::ExtrudeArc(ea) => ea.geo_meta.id,
            ExtrudeSurface::Fillet(f) => f.geo_meta.id,
            ExtrudeSurface::Chamfer(c) => c.geo_meta.id,
        }
    }

    pub fn get_tag(&self) -> Option<Node<TagDeclarator>> {
        match self {
            ExtrudeSurface::ExtrudePlane(ep) => ep.tag.clone(),
            ExtrudeSurface::ExtrudeArc(ea) => ea.tag.clone(),
            ExtrudeSurface::Fillet(f) => f.tag.clone(),
            ExtrudeSurface::Chamfer(c) => c.tag.clone(),
        }
    }
}
