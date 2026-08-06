use std::collections::BTreeMap;

use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;

use crate::SketchConstraintStatus;
use crate::front::Freedom;
use crate::front::ObjectId;

const DEFAULT_WIDTH: u32 = 1024;
const DEFAULT_HEIGHT: u32 = 1024;
const DEFAULT_PADDING: u32 = 48;
const DEFAULT_CONTACT_TOLERANCE: f64 = 1.0e-6;

/// Selects which sketch to visualize from an execution outcome.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum SketchSelector {
    #[default]
    First,
    Name(String),
    Id(ObjectId),
}

/// The visual color strategy for rendered sketch geometry.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SketchVisualizationColorScheme {
    /// Color geometry by solver degree-of-freedom state.
    #[default]
    Dof,
    /// Color primary geometry by stable per-segment ID colors.
    Ids,
}

/// The static visualization theme.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SketchVisualizationTheme {
    #[default]
    Dark,
    Light,
}

/// Options controlling sketch visualization output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SketchVisualizationOptions {
    pub width: u32,
    pub height: u32,
    pub padding: u32,
    pub theme: SketchVisualizationTheme,
    pub contact_tolerance: f64,
    pub color_scheme: SketchVisualizationColorScheme,
    pub show_control_polygons: bool,
}

impl Default for SketchVisualizationOptions {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            padding: DEFAULT_PADDING,
            theme: SketchVisualizationTheme::Dark,
            contact_tolerance: DEFAULT_CONTACT_TOLERANCE,
            color_scheme: SketchVisualizationColorScheme::Dof,
            show_control_polygons: false,
        }
    }
}

/// A rendered sketch PNG plus machine-readable sidecar data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualization {
    pub png: Vec<u8>,
    pub data: SketchVisualizationData,
}

/// JSON-friendly facts used to interpret the visualization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationData {
    pub sketch: SketchVisualizationSketchInfo,
    pub bounds: SketchVisualizationBounds,
    pub units: Vec<String>,
    pub color_scheme: SketchVisualizationColorScheme,
    pub constraint_status: Option<SketchConstraintStatus>,
    pub dof: SketchVisualizationDofData,
    pub points: Vec<SketchVisualizationPointData>,
    pub segments: Vec<SketchVisualizationSegmentData>,
    pub constraints: Vec<SketchVisualizationConstraintData>,
    pub id_color_map: BTreeMap<usize, String>,
    pub contact_groups: Vec<SketchVisualizationPointGroup>,
    pub coincident_groups: Vec<SketchVisualizationCoincidentGroup>,
    pub connected_components: Vec<SketchVisualizationConnectedComponent>,
    pub open_endpoints: Vec<usize>,
    pub closedness_hints: Vec<SketchVisualizationClosednessHint>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationSketchInfo {
    pub id: usize,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationBounds {
    pub min: SketchVisualizationPoint,
    pub max: SketchVisualizationPoint,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationPointData {
    pub id: usize,
    pub position: SketchVisualizationPoint,
    pub owner: Option<usize>,
    pub contact_group: Option<usize>,
    pub coincident_group: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationDofData {
    #[serde(rename = "default")]
    pub default_state: Freedom,
    pub points: SketchVisualizationDofBuckets,
    pub segments: SketchVisualizationDofBuckets,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationDofBuckets {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fixed: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflict: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown: Vec<usize>,
}

impl SketchVisualizationDofBuckets {
    pub(super) fn insert(&mut self, id: usize, freedom: Option<Freedom>) {
        match freedom {
            Some(Freedom::Fixed) => self.fixed.push(id),
            Some(Freedom::Conflict) => self.conflict.push(id),
            Some(Freedom::Free) => {}
            None => self.unknown.push(id),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SketchVisualizationSegmentKind {
    Point,
    Line,
    Arc,
    Circle,
    ControlPointSpline,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationSegmentData {
    pub id: usize,
    pub kind: SketchVisualizationSegmentKind,
    pub point_ids: Vec<usize>,
    pub endpoint_ids: Vec<usize>,
    pub construction: bool,
    pub component_id: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered_color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationConstraintData {
    pub id: usize,
    pub kind: String,
    pub targets: Vec<SketchVisualizationConstraintTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SketchVisualizationConstraintTarget {
    Object { id: usize },
    Origin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationPointGroup {
    pub id: usize,
    pub point_ids: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationCoincidentGroup {
    pub id: usize,
    pub point_ids: Vec<usize>,
    pub includes_origin: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationConnectedComponent {
    pub id: usize,
    pub segment_ids: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationClosednessHint {
    pub component_id: usize,
    pub is_closed: bool,
    pub open_endpoint_ids: Vec<usize>,
}

#[derive(Debug, Error)]
pub enum SketchVisualizationError {
    #[error("no sketch was found in the execution scene objects")]
    NoSketches,
    #[error("sketch named `{0}` was not found in the execution scene objects")]
    SketchNameNotFound(String),
    #[error("sketch with object id {0} was not found in the execution scene objects")]
    SketchIdNotFound(usize),
    #[error("object id {id} was missing from the execution scene objects")]
    MissingObject { id: usize },
    #[error("object id {id} was expected to be {expected}, found {actual}")]
    UnexpectedObjectKind {
        id: usize,
        expected: &'static str,
        actual: &'static str,
    },
    #[error("invalid visualization canvas: width={width}, height={height}, padding={padding}")]
    InvalidCanvas { width: u32, height: u32, padding: u32 },
    #[error("failed to encode sketch visualization PNG: {0}")]
    Image(#[from] image::ImageError),
}
