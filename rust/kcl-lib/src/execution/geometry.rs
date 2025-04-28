use std::ops::{Add, AddAssign, Mul};

use anyhow::Result;
use indexmap::IndexMap;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::{each_cmd as mcmd, length_unit::LengthUnit, websocket::ModelingCmdReq, ModelingCmd};
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[cfg(feature = "artifact-graph")]
use crate::execution::ArtifactId;
use crate::{
    errors::KclError,
    execution::{types::NumericType, ExecState, ExecutorContext, Metadata, TagEngineInfo, TagIdentifier, UnitLen},
    parsing::ast::types::{Node, NodeRef, TagDeclarator, TagNode},
    std::{args::TyF64, sketch::PlaneData},
};

type Point3D = kcmc::shared::Point3d<f64>;

/// A geometry.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Geometry {
    Sketch(Sketch),
    Solid(Solid),
}

impl Geometry {
    pub fn id(&self) -> uuid::Uuid {
        match self {
            Geometry::Sketch(s) => s.id,
            Geometry::Solid(e) => e.id,
        }
    }

    /// If this geometry is the result of a pattern, then return the ID of
    /// the original sketch which was patterned.
    /// Equivalent to the `id()` method if this isn't a pattern.
    pub fn original_id(&self) -> uuid::Uuid {
        match self {
            Geometry::Sketch(s) => s.original_id,
            Geometry::Solid(e) => e.sketch.original_id,
        }
    }
}

/// A geometry including an imported geometry.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum GeometryWithImportedGeometry {
    Sketch(Sketch),
    Solid(Solid),
    ImportedGeometry(Box<ImportedGeometry>),
}

impl GeometryWithImportedGeometry {
    pub async fn id(&mut self, ctx: &ExecutorContext) -> Result<uuid::Uuid, KclError> {
        match self {
            GeometryWithImportedGeometry::Sketch(s) => Ok(s.id),
            GeometryWithImportedGeometry::Solid(e) => Ok(e.id),
            GeometryWithImportedGeometry::ImportedGeometry(i) => {
                let id = i.id(ctx).await?;
                Ok(id)
            }
        }
    }
}

/// A set of geometry.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::vec_box)]
pub enum Geometries {
    Sketches(Vec<Sketch>),
    Solids(Vec<Solid>),
}

impl From<Geometry> for Geometries {
    fn from(value: Geometry) -> Self {
        match value {
            Geometry::Sketch(x) => Self::Sketches(vec![x]),
            Geometry::Solid(x) => Self::Solids(vec![x]),
        }
    }
}

/// Data for an imported geometry.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGeometry {
    /// The ID of the imported geometry.
    pub id: uuid::Uuid,
    /// The original file paths.
    pub value: Vec<String>,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
    /// If the imported geometry has completed.
    #[serde(skip)]
    completed: bool,
}

impl ImportedGeometry {
    pub fn new(id: uuid::Uuid, value: Vec<String>, meta: Vec<Metadata>) -> Self {
        Self {
            id,
            value,
            meta,
            completed: false,
        }
    }

    async fn wait_for_finish(&mut self, ctx: &ExecutorContext) -> Result<(), KclError> {
        if self.completed {
            return Ok(());
        }

        ctx.engine
            .ensure_async_command_completed(self.id, self.meta.first().map(|m| m.source_range))
            .await?;

        self.completed = true;

        Ok(())
    }

    pub async fn id(&mut self, ctx: &ExecutorContext) -> Result<uuid::Uuid, KclError> {
        if !self.completed {
            self.wait_for_finish(ctx).await?;
        }

        Ok(self.id)
    }
}

/// Data for a solid, sketch, or an imported geometry.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::vec_box)]
pub enum SolidOrSketchOrImportedGeometry {
    ImportedGeometry(Box<ImportedGeometry>),
    SolidSet(Vec<Solid>),
    SketchSet(Vec<Sketch>),
}

impl From<SolidOrSketchOrImportedGeometry> for crate::execution::KclValue {
    fn from(value: SolidOrSketchOrImportedGeometry) -> Self {
        match value {
            SolidOrSketchOrImportedGeometry::ImportedGeometry(s) => crate::execution::KclValue::ImportedGeometry(*s),
            SolidOrSketchOrImportedGeometry::SolidSet(mut s) => {
                if s.len() == 1 {
                    crate::execution::KclValue::Solid {
                        value: Box::new(s.pop().unwrap()),
                    }
                } else {
                    crate::execution::KclValue::HomArray {
                        value: s
                            .into_iter()
                            .map(|s| crate::execution::KclValue::Solid { value: Box::new(s) })
                            .collect(),
                        ty: crate::execution::types::RuntimeType::solid(),
                    }
                }
            }
            SolidOrSketchOrImportedGeometry::SketchSet(mut s) => {
                if s.len() == 1 {
                    crate::execution::KclValue::Sketch {
                        value: Box::new(s.pop().unwrap()),
                    }
                } else {
                    crate::execution::KclValue::HomArray {
                        value: s
                            .into_iter()
                            .map(|s| crate::execution::KclValue::Sketch { value: Box::new(s) })
                            .collect(),
                        ty: crate::execution::types::RuntimeType::sketch(),
                    }
                }
            }
        }
    }
}

impl SolidOrSketchOrImportedGeometry {
    pub(crate) async fn ids(&mut self, ctx: &ExecutorContext) -> Result<Vec<uuid::Uuid>, KclError> {
        match self {
            SolidOrSketchOrImportedGeometry::ImportedGeometry(s) => {
                let id = s.id(ctx).await?;

                Ok(vec![id])
            }
            SolidOrSketchOrImportedGeometry::SolidSet(s) => Ok(s.iter().map(|s| s.id).collect()),
            SolidOrSketchOrImportedGeometry::SketchSet(s) => Ok(s.iter().map(|s| s.id).collect()),
        }
    }
}

/// Data for a solid or an imported geometry.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::vec_box)]
pub enum SolidOrImportedGeometry {
    ImportedGeometry(Box<ImportedGeometry>),
    SolidSet(Vec<Solid>),
}

impl From<SolidOrImportedGeometry> for crate::execution::KclValue {
    fn from(value: SolidOrImportedGeometry) -> Self {
        match value {
            SolidOrImportedGeometry::ImportedGeometry(s) => crate::execution::KclValue::ImportedGeometry(*s),
            SolidOrImportedGeometry::SolidSet(mut s) => {
                if s.len() == 1 {
                    crate::execution::KclValue::Solid {
                        value: Box::new(s.pop().unwrap()),
                    }
                } else {
                    crate::execution::KclValue::HomArray {
                        value: s
                            .into_iter()
                            .map(|s| crate::execution::KclValue::Solid { value: Box::new(s) })
                            .collect(),
                        ty: crate::execution::types::RuntimeType::solid(),
                    }
                }
            }
        }
    }
}

impl SolidOrImportedGeometry {
    pub(crate) async fn ids(&mut self, ctx: &ExecutorContext) -> Result<Vec<uuid::Uuid>, KclError> {
        match self {
            SolidOrImportedGeometry::ImportedGeometry(s) => {
                let id = s.id(ctx).await?;

                Ok(vec![id])
            }
            SolidOrImportedGeometry::SolidSet(s) => Ok(s.iter().map(|s| s.id).collect()),
        }
    }
}

/// A helix.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Helix {
    /// The id of the helix.
    pub value: uuid::Uuid,
    /// The artifact ID.
    #[cfg(feature = "artifact-graph")]
    pub artifact_id: ArtifactId,
    /// Number of revolutions.
    pub revolutions: f64,
    /// Start angle (in degrees).
    pub angle_start: f64,
    /// Is the helix rotation counter clockwise?
    pub ccw: bool,
    /// The cylinder the helix was created on.
    pub cylinder_id: Option<uuid::Uuid>,
    pub units: UnitLen,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    /// The id of the plane.
    pub id: uuid::Uuid,
    /// The artifact ID.
    #[cfg(feature = "artifact-graph")]
    pub artifact_id: ArtifactId,
    // The code for the plane either a string or custom.
    pub value: PlaneType,
    /// Origin of the plane.
    pub origin: Point3d,
    /// What should the plane's X axis be?
    pub x_axis: Point3d,
    /// What should the plane's Y axis be?
    pub y_axis: Point3d,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

impl Plane {
    pub(crate) fn into_plane_data(self) -> PlaneData {
        if self.origin.is_zero() {
            match self {
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    x_axis:
                        Point3d {
                            x: 1.0,
                            y: 0.0,
                            z: 0.0,
                            // TODO axes must be normalized, so maybe these should all be count
                            // rather than mm?
                            units: UnitLen::Mm,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 1.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    ..
                } => return PlaneData::XY,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    x_axis:
                        Point3d {
                            x: -1.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 1.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    ..
                } => return PlaneData::NegXY,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    x_axis:
                        Point3d {
                            x: 1.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: UnitLen::Mm,
                        },
                    ..
                } => return PlaneData::XZ,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    x_axis:
                        Point3d {
                            x: -1.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: UnitLen::Mm,
                        },
                    ..
                } => return PlaneData::NegXZ,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    x_axis:
                        Point3d {
                            x: 0.0,
                            y: 1.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: UnitLen::Mm,
                        },
                    ..
                } => return PlaneData::YZ,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    x_axis:
                        Point3d {
                            x: 0.0,
                            y: -1.0,
                            z: 0.0,
                            units: UnitLen::Mm,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: UnitLen::Mm,
                        },
                    ..
                } => return PlaneData::NegYZ,
                _ => {}
            }
        }

        PlaneData::Plane {
            origin: self.origin,
            x_axis: self.x_axis,
            y_axis: self.y_axis,
        }
    }

    pub(crate) fn from_plane_data(value: PlaneData, exec_state: &mut ExecState) -> Self {
        let id = exec_state.next_uuid();
        match value {
            PlaneData::XY => Plane {
                id,
                #[cfg(feature = "artifact-graph")]
                artifact_id: id.into(),
                origin: Point3d::new(0.0, 0.0, 0.0, UnitLen::Mm),
                x_axis: Point3d::new(1.0, 0.0, 0.0, UnitLen::Mm),
                y_axis: Point3d::new(0.0, 1.0, 0.0, UnitLen::Mm),
                value: PlaneType::XY,
                meta: vec![],
            },
            PlaneData::NegXY => Plane {
                id,
                #[cfg(feature = "artifact-graph")]
                artifact_id: id.into(),
                origin: Point3d::new(0.0, 0.0, 0.0, UnitLen::Mm),
                x_axis: Point3d::new(-1.0, 0.0, 0.0, UnitLen::Mm),
                y_axis: Point3d::new(0.0, 1.0, 0.0, UnitLen::Mm),
                value: PlaneType::XY,
                meta: vec![],
            },
            PlaneData::XZ => Plane {
                id,
                #[cfg(feature = "artifact-graph")]
                artifact_id: id.into(),
                origin: Point3d::new(0.0, 0.0, 0.0, UnitLen::Mm),
                x_axis: Point3d::new(1.0, 0.0, 0.0, UnitLen::Mm),
                y_axis: Point3d::new(0.0, 0.0, 1.0, UnitLen::Mm),
                value: PlaneType::XZ,
                meta: vec![],
            },
            PlaneData::NegXZ => Plane {
                id,
                #[cfg(feature = "artifact-graph")]
                artifact_id: id.into(),
                origin: Point3d::new(0.0, 0.0, 0.0, UnitLen::Mm),
                x_axis: Point3d::new(-1.0, 0.0, 0.0, UnitLen::Mm),
                y_axis: Point3d::new(0.0, 0.0, 1.0, UnitLen::Mm),
                value: PlaneType::XZ,
                meta: vec![],
            },
            PlaneData::YZ => Plane {
                id,
                #[cfg(feature = "artifact-graph")]
                artifact_id: id.into(),
                origin: Point3d::new(0.0, 0.0, 0.0, UnitLen::Mm),
                x_axis: Point3d::new(0.0, 1.0, 0.0, UnitLen::Mm),
                y_axis: Point3d::new(0.0, 0.0, 1.0, UnitLen::Mm),
                value: PlaneType::YZ,
                meta: vec![],
            },
            PlaneData::NegYZ => Plane {
                id,
                #[cfg(feature = "artifact-graph")]
                artifact_id: id.into(),
                origin: Point3d::new(0.0, 0.0, 0.0, UnitLen::Mm),
                x_axis: Point3d::new(0.0, -1.0, 0.0, UnitLen::Mm),
                y_axis: Point3d::new(0.0, 0.0, 1.0, UnitLen::Mm),
                value: PlaneType::YZ,
                meta: vec![],
            },
            PlaneData::Plane { origin, x_axis, y_axis } => {
                let id = exec_state.next_uuid();
                Plane {
                    id,
                    #[cfg(feature = "artifact-graph")]
                    artifact_id: id.into(),
                    origin,
                    x_axis,
                    y_axis,
                    value: PlaneType::Custom,
                    meta: vec![],
                }
            }
        }
    }

    /// The standard planes are XY, YZ and XZ (in both positive and negative)
    pub fn is_standard(&self) -> bool {
        !matches!(self.value, PlaneType::Custom | PlaneType::Uninit)
    }
}

/// A face.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    /// The id of the face.
    pub id: uuid::Uuid,
    /// The artifact ID.
    #[cfg(feature = "artifact-graph")]
    pub artifact_id: ArtifactId,
    /// The tag of the face.
    pub value: String,
    /// What should the face's X axis be?
    pub x_axis: Point3d,
    /// What should the face's Y axis be?
    pub y_axis: Point3d,
    /// The solid the face is on.
    pub solid: Box<Solid>,
    pub units: UnitLen,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

/// Type for a plane.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
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
    #[display("Custom")]
    Custom,
    /// A custom plane which has not been sent to the engine. It must be sent before it is used.
    #[display("Uninit")]
    Uninit,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
    #[cfg(feature = "artifact-graph")]
    pub artifact_id: ArtifactId,
    #[ts(skip)]
    pub original_id: uuid::Uuid,
    /// If the sketch includes a mirror.
    #[serde(skip)]
    pub mirror: Option<uuid::Uuid>,
    pub units: UnitLen,
    /// Metadata.
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

impl Sketch {
    // Tell the engine to enter sketch mode on the sketch.
    // Run a specific command, then exit sketch mode.
    pub(crate) fn build_sketch_mode_cmds(
        &self,
        exec_state: &mut ExecState,
        inner_cmd: ModelingCmdReq,
    ) -> Vec<ModelingCmdReq> {
        vec![
            // Before we extrude, we need to enable the sketch mode.
            // We do this here in case extrude is called out of order.
            ModelingCmdReq {
                cmd: ModelingCmd::from(mcmd::EnableSketchMode {
                    animated: false,
                    ortho: false,
                    entity_id: self.on.id(),
                    adjust_camera: false,
                    planar_normal: if let SketchSurface::Plane(plane) = &self.on {
                        // We pass in the normal for the plane here.
                        let normal = plane.x_axis.cross(&plane.y_axis);
                        Some(normal.into())
                    } else {
                        None
                    },
                }),
                cmd_id: exec_state.next_uuid().into(),
            },
            inner_cmd,
            ModelingCmdReq {
                cmd: ModelingCmd::SketchModeDisable(mcmd::SketchModeDisable::default()),
                cmd_id: exec_state.next_uuid().into(),
            },
        ]
    }
}

/// A sketch type.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
}

#[derive(Debug, Clone)]
pub(crate) enum GetTangentialInfoFromPathsResult {
    PreviousPoint([f64; 2]),
    Arc { center: [f64; 2], ccw: bool },
    Circle { center: [f64; 2], ccw: bool, radius: f64 },
}

impl GetTangentialInfoFromPathsResult {
    pub(crate) fn tan_previous_point(&self, last_arc_end: [f64; 2]) -> [f64; 2] {
        match self {
            GetTangentialInfoFromPathsResult::PreviousPoint(p) => *p,
            GetTangentialInfoFromPathsResult::Arc { center, ccw } => {
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
    pub(crate) fn add_tag(&mut self, tag: NodeRef<'_, TagDeclarator>, current_path: &Path, exec_state: &ExecState) {
        let mut tag_identifier: TagIdentifier = tag.into();
        let base = current_path.get_base();
        tag_identifier.info.push((
            exec_state.stack().current_epoch(),
            TagEngineInfo {
                id: base.geo_meta.id,
                sketch: self.id,
                path: Some(current_path.clone()),
                surface: None,
            },
        ));

        self.tags.insert(tag.name.to_string(), tag_identifier);
    }

    pub(crate) fn merge_tags<'a>(&mut self, tags: impl Iterator<Item = &'a TagIdentifier>) {
        for t in tags {
            match self.tags.get_mut(&t.value) {
                Some(id) => {
                    id.merge_info(t);
                }
                None => {
                    self.tags.insert(t.value.clone(), t.clone());
                }
            }
        }
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
            return Ok(Point2d::new(self.start.to[0], self.start.to[1], self.start.units));
        };

        let to = path.get_base().to;
        Ok(Point2d::new(to[0], to[1], path.get_base().units))
    }

    pub(crate) fn get_tangential_info_from_paths(&self) -> GetTangentialInfoFromPathsResult {
        let Some(path) = self.latest_path() else {
            return GetTangentialInfoFromPathsResult::PreviousPoint(self.start.to);
        };
        path.get_tangential_info()
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct Solid {
    /// The id of the solid.
    pub id: uuid::Uuid,
    /// The artifact ID of the solid.  Unlike `id`, this doesn't change.
    #[cfg(feature = "artifact-graph")]
    pub artifact_id: ArtifactId,
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
    /// The units of the solid.
    pub units: UnitLen,
    /// Is this a sectional solid?
    pub sectional: bool,
    /// Metadata.
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

impl Solid {
    pub(crate) fn get_all_edge_cut_ids(&self) -> impl Iterator<Item = uuid::Uuid> + '_ {
        self.edge_cuts.iter().map(|foc| foc.id())
    }

    pub(crate) fn height_in_mm(&self) -> f64 {
        self.units.adjust_to(self.height, UnitLen::Mm).0
    }
}

/// A fillet or a chamfer.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EdgeCut {
    /// A fillet.
    Fillet {
        /// The id of the engine command that called this fillet.
        id: uuid::Uuid,
        radius: TyF64,
        /// The engine id of the edge to fillet.
        #[serde(rename = "edgeId")]
        edge_id: uuid::Uuid,
        tag: Box<Option<TagNode>>,
    },
    /// A chamfer.
    Chamfer {
        /// The id of the engine command that called this chamfer.
        id: uuid::Uuid,
        length: TyF64,
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

    pub fn set_id(&mut self, id: uuid::Uuid) {
        match self {
            EdgeCut::Fillet { id: ref mut i, .. } => *i = id,
            EdgeCut::Chamfer { id: ref mut i, .. } => *i = id,
        }
    }

    pub fn edge_id(&self) -> uuid::Uuid {
        match self {
            EdgeCut::Fillet { edge_id, .. } => *edge_id,
            EdgeCut::Chamfer { edge_id, .. } => *edge_id,
        }
    }

    pub fn set_edge_id(&mut self, id: uuid::Uuid) {
        match self {
            EdgeCut::Fillet { edge_id: ref mut i, .. } => *i = id,
            EdgeCut::Chamfer { edge_id: ref mut i, .. } => *i = id,
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
    pub units: UnitLen,
}

impl Point2d {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        units: UnitLen::Mm,
    };

    pub fn new(x: f64, y: f64, units: UnitLen) -> Self {
        Self { x, y, units }
    }

    pub fn into_x(self) -> TyF64 {
        TyF64::new(self.x, self.units.into())
    }

    pub fn into_y(self) -> TyF64 {
        TyF64::new(self.y, self.units.into())
    }

    pub fn ignore_units(self) -> [f64; 2] {
        [self.x, self.y]
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, Copy, ts_rs::TS, JsonSchema, Default)]
#[ts(export)]
pub struct Point3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub units: UnitLen,
}

impl Point3d {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        units: UnitLen::Mm,
    };

    pub fn new(x: f64, y: f64, z: f64, units: UnitLen) -> Self {
        Self { x, y, z, units }
    }

    pub const fn is_zero(&self) -> bool {
        self.x == 0.0 && self.y == 0.0 && self.z == 0.0
    }

    /// Calculate the cross product of this vector with another
    pub fn cross(&self, other: &Self) -> Self {
        let other = if other.units == self.units {
            other
        } else {
            &Point3d {
                x: self.units.adjust_to(other.x, self.units).0,
                y: self.units.adjust_to(other.y, self.units).0,
                z: self.units.adjust_to(other.z, self.units).0,
                units: self.units,
            }
        };

        Self {
            x: self.y * other.z - self.z * other.y,
            y: self.z * other.x - self.x * other.z,
            z: self.x * other.y - self.y * other.x,
            units: self.units,
        }
    }
}

impl From<[TyF64; 3]> for Point3d {
    fn from(p: [TyF64; 3]) -> Self {
        Self {
            x: p[0].n,
            y: p[1].n,
            z: p[2].n,
            units: p[0].ty.expect_length(),
        }
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
            x: LengthUnit(p.units.adjust_to(p.x, UnitLen::Mm).0),
            y: LengthUnit(p.units.adjust_to(p.y, UnitLen::Mm).0),
            z: LengthUnit(p.units.adjust_to(p.z, UnitLen::Mm).0),
        }
    }
}

impl Add for Point3d {
    type Output = Point3d;

    fn add(self, rhs: Self) -> Self::Output {
        // TODO should assert that self and rhs the same units or coerce them
        Point3d {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
            z: self.z + rhs.z,
            units: self.units,
        }
    }
}

impl AddAssign for Point3d {
    fn add_assign(&mut self, rhs: Self) {
        *self = *self + rhs
    }
}

impl Mul<f64> for Point3d {
    type Output = Point3d;

    fn mul(self, rhs: f64) -> Self::Output {
        Point3d {
            x: self.x * rhs,
            y: self.y * rhs,
            z: self.z * rhs,
            units: self.units,
        }
    }
}

/// A base path.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BasePath {
    /// The from point.
    #[ts(type = "[number, number]")]
    pub from: [f64; 2],
    /// The to point.
    #[ts(type = "[number, number]")]
    pub to: [f64; 2],
    pub units: UnitLen,
    /// The tag of the path.
    pub tag: Option<TagNode>,
    /// Metadata.
    #[serde(rename = "__geoMeta")]
    pub geo_meta: GeoMeta,
}

impl BasePath {
    pub fn get_to(&self) -> [TyF64; 2] {
        let ty: NumericType = self.units.into();
        [TyF64::new(self.to[0], ty.clone()), TyF64::new(self.to[1], ty)]
    }

    pub fn get_from(&self) -> [TyF64; 2] {
        let ty: NumericType = self.units.into();
        [TyF64::new(self.from[0], ty.clone()), TyF64::new(self.from[1], ty)]
    }
}

/// Geometry metadata.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
    CircleThreePoint {
        #[serde(flatten)]
        base: BasePath,
        /// Point 1 of the circle
        #[ts(type = "[number, number]")]
        p1: [f64; 2],
        /// Point 2 of the circle
        #[ts(type = "[number, number]")]
        p2: [f64; 2],
        /// Point 3 of the circle
        #[ts(type = "[number, number]")]
        p3: [f64; 2],
    },
    ArcThreePoint {
        #[serde(flatten)]
        base: BasePath,
        /// Point 1 of the arc (base on the end of previous segment)
        #[ts(type = "[number, number]")]
        p1: [f64; 2],
        /// Point 2 of the arc (interiorAbsolute kwarg)
        #[ts(type = "[number, number]")]
        p2: [f64; 2],
        /// Point 3 of the arc (endAbsolute kwarg)
        #[ts(type = "[number, number]")]
        p3: [f64; 2],
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
    CircleThreePoint,
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
            Path::CircleThreePoint { .. } => Self::CircleThreePoint,
            Path::Horizontal { .. } => Self::Horizontal,
            Path::AngledLineTo { .. } => Self::AngledLineTo,
            Path::Base { .. } => Self::Base,
            Path::Arc { .. } => Self::Arc,
            Path::ArcThreePoint { .. } => Self::Arc,
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
            Path::CircleThreePoint { base, .. } => base.geo_meta.id,
            Path::Arc { base, .. } => base.geo_meta.id,
            Path::ArcThreePoint { base, .. } => base.geo_meta.id,
        }
    }

    pub fn set_id(&mut self, id: uuid::Uuid) {
        match self {
            Path::ToPoint { base } => base.geo_meta.id = id,
            Path::Horizontal { base, .. } => base.geo_meta.id = id,
            Path::AngledLineTo { base, .. } => base.geo_meta.id = id,
            Path::Base { base } => base.geo_meta.id = id,
            Path::TangentialArcTo { base, .. } => base.geo_meta.id = id,
            Path::TangentialArc { base, .. } => base.geo_meta.id = id,
            Path::Circle { base, .. } => base.geo_meta.id = id,
            Path::CircleThreePoint { base, .. } => base.geo_meta.id = id,
            Path::Arc { base, .. } => base.geo_meta.id = id,
            Path::ArcThreePoint { base, .. } => base.geo_meta.id = id,
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
            Path::CircleThreePoint { base, .. } => base.tag.clone(),
            Path::Arc { base, .. } => base.tag.clone(),
            Path::ArcThreePoint { base, .. } => base.tag.clone(),
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
            Path::CircleThreePoint { base, .. } => base,
            Path::Arc { base, .. } => base,
            Path::ArcThreePoint { base, .. } => base,
        }
    }

    /// Where does this path segment start?
    pub fn get_from(&self) -> [TyF64; 2] {
        let p = &self.get_base().from;
        let ty: NumericType = self.get_base().units.into();
        [TyF64::new(p[0], ty.clone()), TyF64::new(p[1], ty)]
    }

    /// Where does this path segment end?
    pub fn get_to(&self) -> [TyF64; 2] {
        let p = &self.get_base().to;
        let ty: NumericType = self.get_base().units.into();
        [TyF64::new(p[0], ty.clone()), TyF64::new(p[1], ty)]
    }

    /// Length of this path segment, in cartesian plane.
    pub fn length(&self) -> TyF64 {
        let n = match self {
            Self::ToPoint { .. } | Self::Base { .. } | Self::Horizontal { .. } | Self::AngledLineTo { .. } => {
                linear_distance(&self.get_base().from, &self.get_base().to)
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
                let radius = linear_distance(&self.get_base().from, center);
                debug_assert_eq!(radius, linear_distance(&self.get_base().to, center));
                // TODO: Call engine utils to figure this out.
                linear_distance(&self.get_base().from, &self.get_base().to)
            }
            Self::Circle { radius, .. } => 2.0 * std::f64::consts::PI * radius,
            Self::CircleThreePoint { .. } => {
                let circle_center = crate::std::utils::calculate_circle_from_3_points([
                    self.get_base().from,
                    self.get_base().to,
                    self.get_base().to,
                ]);
                let radius = linear_distance(
                    &[circle_center.center[0], circle_center.center[1]],
                    &self.get_base().from,
                );
                2.0 * std::f64::consts::PI * radius
            }
            Self::Arc { .. } => {
                // TODO: Call engine utils to figure this out.
                linear_distance(&self.get_base().from, &self.get_base().to)
            }
            Self::ArcThreePoint { .. } => {
                // TODO: Call engine utils to figure this out.
                linear_distance(&self.get_base().from, &self.get_base().to)
            }
        };
        TyF64::new(n, self.get_base().units.into())
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
            Path::CircleThreePoint { base, .. } => Some(base),
            Path::Arc { base, .. } => Some(base),
            Path::ArcThreePoint { base, .. } => Some(base),
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
            Path::ArcThreePoint { p1, p2, p3, .. } => {
                let circle = crate::std::utils::calculate_circle_from_3_points([*p1, *p2, *p3]);
                GetTangentialInfoFromPathsResult::Arc {
                    center: circle.center,
                    ccw: crate::std::utils::is_points_ccw(&[*p1, *p2, *p3]) > 0,
                }
            }
            Path::Circle {
                center, ccw, radius, ..
            } => GetTangentialInfoFromPathsResult::Circle {
                center: *center,
                ccw: *ccw,
                radius: *radius,
            },
            Path::CircleThreePoint { p1, p2, p3, .. } => {
                let circle = crate::std::utils::calculate_circle_from_3_points([*p1, *p2, *p3]);
                let center_point = [circle.center[0], circle.center[1]];
                GetTangentialInfoFromPathsResult::Circle {
                    center: center_point,
                    // Note: a circle is always ccw regardless of the order of points
                    ccw: true,
                    radius: circle.radius,
                }
            }
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
