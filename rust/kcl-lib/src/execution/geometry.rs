use std::ops::{Add, AddAssign, Mul, Sub, SubAssign};

use anyhow::Result;
use indexmap::IndexMap;
use kcl_error::SourceRange;
use kittycad_modeling_cmds::{
    self as kcmc, ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, units::UnitLength, websocket::ModelingCmdReq,
};
use parse_display::{Display, FromStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    engine::{DEFAULT_PLANE_INFO, PlaneName},
    errors::{KclError, KclErrorDetails},
    exec::KclValue,
    execution::{
        ArtifactId, ExecState, ExecutorContext, Metadata, TagEngineInfo, TagIdentifier, normalize_to_solver_unit,
        types::{NumericType, adjust_length},
    },
    front::{ArcCtor, Freedom, LineCtor, ObjectId, PointCtor},
    parsing::ast::types::{Node, NodeRef, TagDeclarator, TagNode},
    std::{
        Args,
        args::TyF64,
        sketch::{FaceTag, PlaneData},
    },
};

type Point3D = kcmc::shared::Point3d<f64>;

/// A GD&T annotation.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct GdtAnnotation {
    /// The engine ID.
    pub id: uuid::Uuid,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

/// A geometry.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
                if s.len() == 1
                    && let Some(s) = s.pop()
                {
                    crate::execution::KclValue::Solid { value: Box::new(s) }
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
                if s.len() == 1
                    && let Some(s) = s.pop()
                {
                    crate::execution::KclValue::Sketch { value: Box::new(s) }
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
                if s.len() == 1
                    && let Some(s) = s.pop()
                {
                    crate::execution::KclValue::Solid { value: Box::new(s) }
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Helix {
    /// The id of the helix.
    pub value: uuid::Uuid,
    /// The artifact ID.
    pub artifact_id: ArtifactId,
    /// Number of revolutions.
    pub revolutions: f64,
    /// Start angle (in degrees).
    pub angle_start: f64,
    /// Is the helix rotation counter clockwise?
    pub ccw: bool,
    /// The cylinder the helix was created on.
    pub cylinder_id: Option<uuid::Uuid>,
    pub units: UnitLength,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    /// The id of the plane.
    pub id: uuid::Uuid,
    /// The artifact ID.
    pub artifact_id: ArtifactId,
    /// The scene object ID. If this is None, then the plane has not been
    /// sent to the engine yet. It must be sent before it is used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object_id: Option<ObjectId>,
    /// The kind of plane or custom.
    pub kind: PlaneKind,
    /// The information for the plane.
    #[serde(flatten)]
    pub info: PlaneInfo,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlaneInfo {
    /// Origin of the plane.
    pub origin: Point3d,
    /// What should the plane's X axis be?
    pub x_axis: Point3d,
    /// What should the plane's Y axis be?
    pub y_axis: Point3d,
    /// What should the plane's Z axis be?
    pub z_axis: Point3d,
}

impl PlaneInfo {
    pub(crate) fn into_plane_data(self) -> PlaneData {
        if self.origin.is_zero() {
            match self {
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: Some(UnitLength::Millimeters),
                        },
                    x_axis:
                        Point3d {
                            x: 1.0,
                            y: 0.0,
                            z: 0.0,
                            units: _,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 1.0,
                            z: 0.0,
                            units: _,
                        },
                    z_axis: _,
                } => return PlaneData::XY,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: Some(UnitLength::Millimeters),
                        },
                    x_axis:
                        Point3d {
                            x: -1.0,
                            y: 0.0,
                            z: 0.0,
                            units: _,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 1.0,
                            z: 0.0,
                            units: _,
                        },
                    z_axis: _,
                } => return PlaneData::NegXY,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: Some(UnitLength::Millimeters),
                        },
                    x_axis:
                        Point3d {
                            x: 1.0,
                            y: 0.0,
                            z: 0.0,
                            units: _,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: _,
                        },
                    z_axis: _,
                } => return PlaneData::XZ,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: Some(UnitLength::Millimeters),
                        },
                    x_axis:
                        Point3d {
                            x: -1.0,
                            y: 0.0,
                            z: 0.0,
                            units: _,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: _,
                        },
                    z_axis: _,
                } => return PlaneData::NegXZ,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: Some(UnitLength::Millimeters),
                        },
                    x_axis:
                        Point3d {
                            x: 0.0,
                            y: 1.0,
                            z: 0.0,
                            units: _,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: _,
                        },
                    z_axis: _,
                } => return PlaneData::YZ,
                Self {
                    origin:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            units: Some(UnitLength::Millimeters),
                        },
                    x_axis:
                        Point3d {
                            x: 0.0,
                            y: -1.0,
                            z: 0.0,
                            units: _,
                        },
                    y_axis:
                        Point3d {
                            x: 0.0,
                            y: 0.0,
                            z: 1.0,
                            units: _,
                        },
                    z_axis: _,
                } => return PlaneData::NegYZ,
                _ => {}
            }
        }

        PlaneData::Plane(Self {
            origin: self.origin,
            x_axis: self.x_axis,
            y_axis: self.y_axis,
            z_axis: self.z_axis,
        })
    }

    pub(crate) fn is_right_handed(&self) -> bool {
        // Katie's formula:
        // dot(cross(x, y), z) ~= sqrt(dot(x, x) * dot(y, y) * dot(z, z))
        let lhs = self
            .x_axis
            .axes_cross_product(&self.y_axis)
            .axes_dot_product(&self.z_axis);
        let rhs_x = self.x_axis.axes_dot_product(&self.x_axis);
        let rhs_y = self.y_axis.axes_dot_product(&self.y_axis);
        let rhs_z = self.z_axis.axes_dot_product(&self.z_axis);
        let rhs = (rhs_x * rhs_y * rhs_z).sqrt();
        // Check LHS ~= RHS
        (lhs - rhs).abs() <= 0.0001
    }

    #[cfg(test)]
    pub(crate) fn is_left_handed(&self) -> bool {
        !self.is_right_handed()
    }

    pub(crate) fn make_right_handed(self) -> Self {
        if self.is_right_handed() {
            return self;
        }
        // To make it right-handed, negate X, i.e. rotate the plane 180 degrees.
        Self {
            origin: self.origin,
            x_axis: self.x_axis.negated(),
            y_axis: self.y_axis,
            z_axis: self.z_axis,
        }
    }
}

impl TryFrom<PlaneData> for PlaneInfo {
    type Error = KclError;

    fn try_from(value: PlaneData) -> Result<Self, Self::Error> {
        let name = match value {
            PlaneData::XY => PlaneName::Xy,
            PlaneData::NegXY => PlaneName::NegXy,
            PlaneData::XZ => PlaneName::Xz,
            PlaneData::NegXZ => PlaneName::NegXz,
            PlaneData::YZ => PlaneName::Yz,
            PlaneData::NegYZ => PlaneName::NegYz,
            PlaneData::Plane(info) => {
                return Ok(info);
            }
        };

        let info = DEFAULT_PLANE_INFO.get(&name).ok_or_else(|| {
            KclError::new_internal(KclErrorDetails::new(
                format!("Plane {name} not found"),
                Default::default(),
            ))
        })?;

        Ok(info.clone())
    }
}

impl From<&PlaneData> for PlaneKind {
    fn from(value: &PlaneData) -> Self {
        match value {
            PlaneData::XY => PlaneKind::XY,
            PlaneData::NegXY => PlaneKind::XY,
            PlaneData::XZ => PlaneKind::XZ,
            PlaneData::NegXZ => PlaneKind::XZ,
            PlaneData::YZ => PlaneKind::YZ,
            PlaneData::NegYZ => PlaneKind::YZ,
            PlaneData::Plane(_) => PlaneKind::Custom,
        }
    }
}

impl From<&PlaneInfo> for PlaneKind {
    fn from(value: &PlaneInfo) -> Self {
        let data = PlaneData::Plane(value.clone());
        PlaneKind::from(&data)
    }
}

impl From<PlaneInfo> for PlaneKind {
    fn from(value: PlaneInfo) -> Self {
        let data = PlaneData::Plane(value);
        PlaneKind::from(&data)
    }
}

impl Plane {
    #[cfg(test)]
    pub(crate) fn from_plane_data_skipping_engine(
        value: PlaneData,
        exec_state: &mut ExecState,
    ) -> Result<Self, KclError> {
        let id = exec_state.next_uuid();
        let kind = PlaneKind::from(&value);
        Ok(Plane {
            id,
            artifact_id: id.into(),
            info: PlaneInfo::try_from(value)?,
            object_id: None,
            kind,
            meta: vec![],
        })
    }

    /// Returns true if the plane has been sent to the engine.
    pub fn is_initialized(&self) -> bool {
        self.object_id.is_some()
    }

    /// Returns true if the plane has not been sent to the engine yet.
    pub fn is_uninitialized(&self) -> bool {
        !self.is_initialized()
    }

    /// The standard planes are XY, YZ and XZ (in both positive and negative)
    pub fn is_standard(&self) -> bool {
        match &self.kind {
            PlaneKind::XY | PlaneKind::YZ | PlaneKind::XZ => true,
            PlaneKind::Custom => false,
        }
    }

    /// Project a point onto a plane by calculating how far away it is and moving it along the
    /// normal of the plane so that it now lies on the plane.
    pub fn project(&self, point: Point3d) -> Point3d {
        let v = point - self.info.origin;
        let dot = v.axes_dot_product(&self.info.z_axis);

        point - self.info.z_axis * dot
    }
}

/// A face.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    /// The id of the face.
    pub id: uuid::Uuid,
    /// The artifact ID.
    pub artifact_id: ArtifactId,
    /// The scene object ID.
    pub object_id: ObjectId,
    /// The tag of the face.
    pub value: String,
    /// What should the face's X axis be?
    pub x_axis: Point3d,
    /// What should the face's Y axis be?
    pub y_axis: Point3d,
    /// The solid the face is on.
    pub solid: Box<Solid>,
    pub units: UnitLength,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

/// Kind of plane.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS, FromStr, Display)]
#[ts(export)]
#[display(style = "camelCase")]
pub enum PlaneKind {
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
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct Sketch {
    /// The id of the sketch (this will change when the engine's reference to it changes).
    pub id: uuid::Uuid,
    /// The paths in the sketch.
    /// Only paths on the "outside" i.e. the perimeter.
    /// Does not include paths "inside" the profile (for example, edges made by subtracting a profile)
    pub paths: Vec<Path>,
    /// Inner paths, resulting from subtract2d to carve profiles out of the sketch.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inner_paths: Vec<Path>,
    /// What the sketch is on (can be a plane or a face).
    pub on: SketchSurface,
    /// The starting path.
    pub start: BasePath,
    /// Tag identifiers that have been declared in this sketch.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub tags: IndexMap<String, TagIdentifier>,
    /// The original id of the sketch. This stays the same even if the sketch is
    /// is sketched on face etc.
    pub artifact_id: ArtifactId,
    #[ts(skip)]
    pub original_id: uuid::Uuid,
    /// If the sketch includes a mirror.
    #[serde(skip)]
    pub mirror: Option<uuid::Uuid>,
    /// If the sketch is a clone of another sketch.
    #[serde(skip)]
    pub clone: Option<uuid::Uuid>,
    pub units: UnitLength,
    /// Metadata.
    #[serde(skip)]
    pub meta: Vec<Metadata>,
    /// Has the profile been closed?
    /// If not given, defaults to yes, closed explicitly.
    #[serde(
        default = "ProfileClosed::explicitly",
        skip_serializing_if = "ProfileClosed::is_explicitly"
    )]
    pub is_closed: ProfileClosed,
}

impl ProfileClosed {
    #[expect(dead_code, reason = "it's not actually dead, it's called by serde")]
    fn explicitly() -> Self {
        Self::Explicitly
    }

    fn is_explicitly(&self) -> bool {
        matches!(self, ProfileClosed::Explicitly)
    }
}

/// Has the profile been closed?
#[derive(Debug, Serialize, Eq, PartialEq, Clone, Copy, Hash, Ord, PartialOrd, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum ProfileClosed {
    /// It's definitely open.
    No,
    /// Unknown.
    Maybe,
    /// Yes, by adding a segment which loops back to the start.
    Implicitly,
    /// Yes, by calling `close()` or by making a closed shape (e.g. circle).
    Explicitly,
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
                cmd: ModelingCmd::from(
                    mcmd::EnableSketchMode::builder()
                        .animated(false)
                        .ortho(false)
                        .entity_id(self.on.id())
                        .adjust_camera(false)
                        .maybe_planar_normal(if let SketchSurface::Plane(plane) = &self.on {
                            // We pass in the normal for the plane here.
                            let normal = plane.info.x_axis.axes_cross_product(&plane.info.y_axis);
                            Some(normal.into())
                        } else {
                            None
                        })
                        .build(),
                ),
                cmd_id: exec_state.next_uuid().into(),
            },
            inner_cmd,
            ModelingCmdReq {
                cmd: ModelingCmd::SketchModeDisable(mcmd::SketchModeDisable::builder().build()),
                cmd_id: exec_state.next_uuid().into(),
            },
        ]
    }
}

/// A sketch type.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
            SketchSurface::Plane(plane) => plane.info.x_axis,
            SketchSurface::Face(face) => face.x_axis,
        }
    }
    pub(crate) fn y_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.info.y_axis,
            SketchSurface::Face(face) => face.y_axis,
        }
    }

    pub(crate) fn object_id(&self) -> Option<ObjectId> {
        match self {
            SketchSurface::Plane(plane) => plane.object_id,
            SketchSurface::Face(face) => Some(face.object_id),
        }
    }

    pub(crate) fn set_object_id(&mut self, object_id: ObjectId) {
        match self {
            SketchSurface::Plane(plane) => plane.object_id = Some(object_id),
            SketchSurface::Face(face) => face.object_id = object_id,
        }
    }
}

/// A Sketch, Face, or TaggedFace.
#[derive(Debug, Clone, PartialEq)]
pub enum Extrudable {
    /// Sketch.
    Sketch(Box<Sketch>),
    /// Face.
    Face(FaceTag),
}

impl Extrudable {
    /// Get the relevant id.
    pub async fn id_to_extrude(
        &self,
        exec_state: &mut ExecState,
        args: &Args,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        match self {
            Extrudable::Sketch(sketch) => Ok(sketch.id),
            Extrudable::Face(face_tag) => face_tag.get_face_id_from_tag(exec_state, args, must_be_planar).await,
        }
    }

    pub fn as_sketch(&self) -> Option<Sketch> {
        match self {
            Extrudable::Sketch(sketch) => Some((**sketch).clone()),
            Extrudable::Face(face_tag) => match face_tag.geometry() {
                Some(Geometry::Sketch(sketch)) => Some(sketch),
                Some(Geometry::Solid(solid)) => Some(solid.sketch),
                None => None,
            },
        }
    }

    pub fn is_closed(&self) -> ProfileClosed {
        match self {
            Extrudable::Sketch(sketch) => sketch.is_closed,
            Extrudable::Face(face_tag) => match face_tag.geometry() {
                Some(Geometry::Sketch(sketch)) => sketch.is_closed,
                Some(Geometry::Solid(solid)) => solid.sketch.is_closed,
                _ => ProfileClosed::Maybe,
            },
        }
    }
}

impl From<Sketch> for Extrudable {
    fn from(value: Sketch) -> Self {
        Extrudable::Sketch(Box::new(value))
    }
}

#[derive(Debug, Clone)]
pub(crate) enum GetTangentialInfoFromPathsResult {
    PreviousPoint([f64; 2]),
    Arc {
        center: [f64; 2],
        ccw: bool,
    },
    Circle {
        center: [f64; 2],
        ccw: bool,
        radius: f64,
    },
    Ellipse {
        center: [f64; 2],
        ccw: bool,
        major_axis: [f64; 2],
        _minor_radius: f64,
    },
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
            GetTangentialInfoFromPathsResult::Ellipse {
                center,
                major_axis,
                ccw,
                ..
            } => [center[0] + major_axis[0], center[1] + if *ccw { -1.0 } else { 1.0 }],
        }
    }
}

impl Sketch {
    pub(crate) fn add_tag(
        &mut self,
        tag: NodeRef<'_, TagDeclarator>,
        current_path: &Path,
        exec_state: &ExecState,
        surface: Option<&ExtrudeSurface>,
    ) {
        let mut tag_identifier: TagIdentifier = tag.into();
        let base = current_path.get_base();
        let mut sketch_copy = self.clone();
        sketch_copy.tags.clear();
        tag_identifier.info.push((
            exec_state.stack().current_epoch(),
            TagEngineInfo {
                id: base.geo_meta.id,
                geometry: Geometry::Sketch(sketch_copy),
                path: Some(current_path.clone()),
                surface: surface.cloned(),
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

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct Solid {
    /// The id of the solid.
    pub id: uuid::Uuid,
    /// The artifact ID of the solid.  Unlike `id`, this doesn't change.
    pub artifact_id: ArtifactId,
    /// The extrude surfaces.
    pub value: Vec<ExtrudeSurface>,
    /// The sketch.
    pub sketch: Sketch,
    /// The id of the extrusion start cap
    pub start_cap_id: Option<uuid::Uuid>,
    /// The id of the extrusion end cap
    pub end_cap_id: Option<uuid::Uuid>,
    /// Chamfers or fillets on this solid.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<EdgeCut>,
    /// The units of the solid.
    pub units: UnitLength,
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
}

/// A fillet or a chamfer.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
            EdgeCut::Fillet { id: i, .. } => *i = id,
            EdgeCut::Chamfer { id: i, .. } => *i = id,
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
            EdgeCut::Fillet { edge_id: i, .. } => *i = id,
            EdgeCut::Chamfer { edge_id: i, .. } => *i = id,
        }
    }

    pub fn tag(&self) -> Option<TagNode> {
        match self {
            EdgeCut::Fillet { tag, .. } => *tag.clone(),
            EdgeCut::Chamfer { tag, .. } => *tag.clone(),
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Clone, Copy, ts_rs::TS)]
#[ts(export)]
pub struct Point2d {
    pub x: f64,
    pub y: f64,
    pub units: UnitLength,
}

impl Point2d {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        units: UnitLength::Millimeters,
    };

    pub fn new(x: f64, y: f64, units: UnitLength) -> Self {
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

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, Copy, ts_rs::TS, Default)]
#[ts(export)]
pub struct Point3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub units: Option<UnitLength>,
}

impl Point3d {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        units: Some(UnitLength::Millimeters),
    };

    pub fn new(x: f64, y: f64, z: f64, units: Option<UnitLength>) -> Self {
        Self { x, y, z, units }
    }

    pub const fn is_zero(&self) -> bool {
        self.x == 0.0 && self.y == 0.0 && self.z == 0.0
    }

    /// Calculate the cross product of this vector with another.
    ///
    /// This should only be applied to axes or other vectors which represent only a direction (and
    /// no magnitude) since units are ignored.
    pub fn axes_cross_product(&self, other: &Self) -> Self {
        Self {
            x: self.y * other.z - self.z * other.y,
            y: self.z * other.x - self.x * other.z,
            z: self.x * other.y - self.y * other.x,
            units: None,
        }
    }

    /// Calculate the dot product of this vector with another.
    ///
    /// This should only be applied to axes or other vectors which represent only a direction (and
    /// no magnitude) since units are ignored.
    pub fn axes_dot_product(&self, other: &Self) -> f64 {
        let x = self.x * other.x;
        let y = self.y * other.y;
        let z = self.z * other.z;
        x + y + z
    }

    pub fn normalize(&self) -> Self {
        let len = f64::sqrt(self.x * self.x + self.y * self.y + self.z * self.z);
        Point3d {
            x: self.x / len,
            y: self.y / len,
            z: self.z / len,
            units: None,
        }
    }

    pub fn as_3_dims(&self) -> ([f64; 3], Option<UnitLength>) {
        let p = [self.x, self.y, self.z];
        let u = self.units;
        (p, u)
    }

    pub(crate) fn negated(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
            z: -self.z,
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
            units: p[0].ty.as_length(),
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
        if let Some(units) = p.units {
            Self {
                x: LengthUnit(adjust_length(units, p.x, UnitLength::Millimeters).0),
                y: LengthUnit(adjust_length(units, p.y, UnitLength::Millimeters).0),
                z: LengthUnit(adjust_length(units, p.z, UnitLength::Millimeters).0),
            }
        } else {
            Self {
                x: LengthUnit(p.x),
                y: LengthUnit(p.y),
                z: LengthUnit(p.z),
            }
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

impl Sub for Point3d {
    type Output = Point3d;

    fn sub(self, rhs: Self) -> Self::Output {
        let (x, y, z) = if rhs.units != self.units
            && let Some(sunits) = self.units
            && let Some(runits) = rhs.units
        {
            (
                adjust_length(runits, rhs.x, sunits).0,
                adjust_length(runits, rhs.y, sunits).0,
                adjust_length(runits, rhs.z, sunits).0,
            )
        } else {
            (rhs.x, rhs.y, rhs.z)
        };
        Point3d {
            x: self.x - x,
            y: self.y - y,
            z: self.z - z,
            units: self.units,
        }
    }
}

impl SubAssign for Point3d {
    fn sub_assign(&mut self, rhs: Self) {
        *self = *self - rhs
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BasePath {
    /// The from point.
    #[ts(type = "[number, number]")]
    pub from: [f64; 2],
    /// The to point.
    #[ts(type = "[number, number]")]
    pub to: [f64; 2],
    pub units: UnitLength,
    /// The tag of the path.
    pub tag: Option<TagNode>,
    /// Metadata.
    #[serde(rename = "__geoMeta")]
    pub geo_meta: GeoMeta,
}

impl BasePath {
    pub fn get_to(&self) -> [TyF64; 2] {
        let ty: NumericType = self.units.into();
        [TyF64::new(self.to[0], ty), TyF64::new(self.to[1], ty)]
    }

    pub fn get_from(&self) -> [TyF64; 2] {
        let ty: NumericType = self.units.into();
        [TyF64::new(self.from[0], ty), TyF64::new(self.from[1], ty)]
    }
}

/// Geometry metadata.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Path {
    /// A straight line which ends at the given point.
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
    Ellipse {
        #[serde(flatten)]
        base: BasePath,
        center: [f64; 2],
        major_axis: [f64; 2],
        minor_radius: f64,
        ccw: bool,
    },
    //TODO: (bc) figure this out
    Conic {
        #[serde(flatten)]
        base: BasePath,
    },
    /// A cubic Bezier curve.
    Bezier {
        #[serde(flatten)]
        base: BasePath,
        /// First control point (absolute coordinates).
        #[ts(type = "[number, number]")]
        control1: [f64; 2],
        /// Second control point (absolute coordinates).
        #[ts(type = "[number, number]")]
        control2: [f64; 2],
    },
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
            Path::Ellipse { base, .. } => base.geo_meta.id,
            Path::Conic { base, .. } => base.geo_meta.id,
            Path::Bezier { base, .. } => base.geo_meta.id,
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
            Path::Ellipse { base, .. } => base.geo_meta.id = id,
            Path::Conic { base, .. } => base.geo_meta.id = id,
            Path::Bezier { base, .. } => base.geo_meta.id = id,
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
            Path::Ellipse { base, .. } => base.tag.clone(),
            Path::Conic { base, .. } => base.tag.clone(),
            Path::Bezier { base, .. } => base.tag.clone(),
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
            Path::Ellipse { base, .. } => base,
            Path::Conic { base, .. } => base,
            Path::Bezier { base, .. } => base,
        }
    }

    /// Where does this path segment start?
    pub fn get_from(&self) -> [TyF64; 2] {
        let p = &self.get_base().from;
        let ty: NumericType = self.get_base().units.into();
        [TyF64::new(p[0], ty), TyF64::new(p[1], ty)]
    }

    /// Where does this path segment end?
    pub fn get_to(&self) -> [TyF64; 2] {
        let p = &self.get_base().to;
        let ty: NumericType = self.get_base().units.into();
        [TyF64::new(p[0], ty), TyF64::new(p[1], ty)]
    }

    /// The path segment start point and its type.
    pub fn start_point_components(&self) -> ([f64; 2], NumericType) {
        let p = &self.get_base().from;
        let ty: NumericType = self.get_base().units.into();
        (*p, ty)
    }

    /// The path segment end point and its type.
    pub fn end_point_components(&self) -> ([f64; 2], NumericType) {
        let p = &self.get_base().to;
        let ty: NumericType = self.get_base().units.into();
        (*p, ty)
    }

    /// Length of this path segment, in cartesian plane. Not all segment types
    /// are supported.
    pub fn length(&self) -> Option<TyF64> {
        let n = match self {
            Self::ToPoint { .. } | Self::Base { .. } | Self::Horizontal { .. } | Self::AngledLineTo { .. } => {
                Some(linear_distance(&self.get_base().from, &self.get_base().to))
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
                Some(linear_distance(&self.get_base().from, &self.get_base().to))
            }
            Self::Circle { radius, .. } => Some(2.0 * std::f64::consts::PI * radius),
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
                Some(2.0 * std::f64::consts::PI * radius)
            }
            Self::Arc { .. } => {
                // TODO: Call engine utils to figure this out.
                Some(linear_distance(&self.get_base().from, &self.get_base().to))
            }
            Self::ArcThreePoint { .. } => {
                // TODO: Call engine utils to figure this out.
                Some(linear_distance(&self.get_base().from, &self.get_base().to))
            }
            Self::Ellipse { .. } => {
                // Not supported.
                None
            }
            Self::Conic { .. } => {
                // Not supported.
                None
            }
            Self::Bezier { .. } => {
                // Not supported - Bezier curve length requires numerical integration.
                None
            }
        };
        n.map(|n| TyF64::new(n, self.get_base().units.into()))
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
            Path::Ellipse { base, .. } => Some(base),
            Path::Conic { base, .. } => Some(base),
            Path::Bezier { base, .. } => Some(base),
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
            // TODO: (bc) fix me
            Path::Ellipse {
                center,
                major_axis,
                minor_radius,
                ccw,
                ..
            } => GetTangentialInfoFromPathsResult::Ellipse {
                center: *center,
                major_axis: *major_axis,
                _minor_radius: *minor_radius,
                ccw: *ccw,
            },
            Path::Conic { .. }
            | Path::ToPoint { .. }
            | Path::Horizontal { .. }
            | Path::AngledLineTo { .. }
            | Path::Base { .. }
            | Path::Bezier { .. } => {
                let base = self.get_base();
                GetTangentialInfoFromPathsResult::PreviousPoint(base.from)
            }
        }
    }

    /// i.e. not a curve
    pub(crate) fn is_straight_line(&self) -> bool {
        matches!(self, Path::AngledLineTo { .. } | Path::ToPoint { .. })
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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

    pub fn face_id(&self) -> uuid::Uuid {
        match self {
            ExtrudeSurface::ExtrudePlane(ep) => ep.face_id,
            ExtrudeSurface::ExtrudeArc(ea) => ea.face_id,
            ExtrudeSurface::Fillet(f) => f.face_id,
            ExtrudeSurface::Chamfer(c) => c.face_id,
        }
    }

    pub fn set_face_id(&mut self, face_id: uuid::Uuid) {
        match self {
            ExtrudeSurface::ExtrudePlane(ep) => ep.face_id = face_id,
            ExtrudeSurface::ExtrudeArc(ea) => ea.face_id = face_id,
            ExtrudeSurface::Fillet(f) => f.face_id = face_id,
            ExtrudeSurface::Chamfer(c) => c.face_id = face_id,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ts_rs::TS)]
pub struct SketchVarId(pub usize);

impl SketchVarId {
    pub fn to_constraint_id(self, range: SourceRange) -> Result<kcl_ezpz::Id, KclError> {
        self.0.try_into().map_err(|_| {
            KclError::new_type(KclErrorDetails::new(
                "Cannot convert to constraint ID since the sketch variable ID is too large".to_owned(),
                vec![range],
            ))
        })
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchVar {
    pub id: SketchVarId,
    pub initial_value: f64,
    pub ty: NumericType,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

impl SketchVar {
    pub fn initial_value_to_solver_units(
        &self,
        exec_state: &mut ExecState,
        source_range: SourceRange,
        description: &str,
    ) -> Result<TyF64, KclError> {
        let x_initial_value = KclValue::Number {
            value: self.initial_value,
            ty: self.ty,
            meta: vec![source_range.into()],
        };
        let normalized_value = normalize_to_solver_unit(&x_initial_value, source_range, exec_state, description)?;
        normalized_value.as_ty_f64().ok_or_else(|| {
            let message = format!(
                "Expected number after coercion, but found {}",
                normalized_value.human_friendly_type()
            );
            debug_assert!(false, "{}", &message);
            KclError::new_internal(KclErrorDetails::new(message, vec![source_range]))
        })
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(tag = "type")]
pub enum UnsolvedExpr {
    Known(TyF64),
    Unknown(SketchVarId),
}

impl UnsolvedExpr {
    pub fn var(&self) -> Option<SketchVarId> {
        match self {
            UnsolvedExpr::Known(_) => None,
            UnsolvedExpr::Unknown(id) => Some(*id),
        }
    }
}

pub type UnsolvedPoint2dExpr = [UnsolvedExpr; 2];

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub struct ConstrainablePoint2d {
    pub vars: crate::front::Point2d<SketchVarId>,
    pub object_id: ObjectId,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub struct UnsolvedSegment {
    /// The engine ID.
    pub id: Uuid,
    pub object_id: ObjectId,
    pub kind: UnsolvedSegmentKind,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub enum UnsolvedSegmentKind {
    Point {
        position: UnsolvedPoint2dExpr,
        ctor: Box<PointCtor>,
    },
    Line {
        start: UnsolvedPoint2dExpr,
        end: UnsolvedPoint2dExpr,
        ctor: Box<LineCtor>,
        start_object_id: ObjectId,
        end_object_id: ObjectId,
        construction: bool,
    },
    Arc {
        start: UnsolvedPoint2dExpr,
        end: UnsolvedPoint2dExpr,
        center: UnsolvedPoint2dExpr,
        ctor: Box<ArcCtor>,
        start_object_id: ObjectId,
        end_object_id: ObjectId,
        center_object_id: ObjectId,
        construction: bool,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// The engine ID.
    pub id: Uuid,
    pub object_id: ObjectId,
    pub kind: SegmentKind,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

impl Segment {
    pub fn is_construction(&self) -> bool {
        match &self.kind {
            SegmentKind::Point { .. } => true,
            SegmentKind::Line { construction, .. } => *construction,
            SegmentKind::Arc { construction, .. } => *construction,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub enum SegmentKind {
    Point {
        position: [TyF64; 2],
        ctor: Box<PointCtor>,
        #[serde(skip_serializing_if = "Option::is_none")]
        freedom: Option<Freedom>,
    },
    Line {
        start: [TyF64; 2],
        end: [TyF64; 2],
        ctor: Box<LineCtor>,
        start_object_id: ObjectId,
        end_object_id: ObjectId,
        #[serde(skip_serializing_if = "Option::is_none")]
        start_freedom: Option<Freedom>,
        #[serde(skip_serializing_if = "Option::is_none")]
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
        #[serde(skip_serializing_if = "Option::is_none")]
        start_freedom: Option<Freedom>,
        #[serde(skip_serializing_if = "Option::is_none")]
        end_freedom: Option<Freedom>,
        #[serde(skip_serializing_if = "Option::is_none")]
        center_freedom: Option<Freedom>,
        construction: bool,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub struct AbstractSegment {
    pub repr: SegmentRepr,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
pub enum SegmentRepr {
    Unsolved { segment: UnsolvedSegment },
    Solved { segment: Segment },
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchConstraint {
    pub kind: SketchConstraintKind,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Geometry.ts")]
#[serde(rename_all = "camelCase")]
pub enum SketchConstraintKind {
    Distance { points: [ConstrainablePoint2d; 2] },
    Radius { points: [ConstrainablePoint2d; 2] },
    Diameter { points: [ConstrainablePoint2d; 2] },
    HorizontalDistance { points: [ConstrainablePoint2d; 2] },
    VerticalDistance { points: [ConstrainablePoint2d; 2] },
}

impl SketchConstraintKind {
    pub fn name(&self) -> &'static str {
        match self {
            SketchConstraintKind::Distance { .. } => "distance",
            SketchConstraintKind::Radius { .. } => "radius",
            SketchConstraintKind::Diameter { .. } => "diameter",
            SketchConstraintKind::HorizontalDistance { .. } => "horizontalDistance",
            SketchConstraintKind::VerticalDistance { .. } => "verticalDistance",
        }
    }
}
