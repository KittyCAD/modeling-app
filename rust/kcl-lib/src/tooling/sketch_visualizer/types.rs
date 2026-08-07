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

/// The selected visualization diagnostic.
///
/// Each mode owns both parts of the contract: the color mapping used for the PNG
/// and the sidecar block that explains that mapping.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SketchVisualizationMode {
    /// Color geometry by solver degree-of-freedom state and emit DoF graph data.
    #[default]
    Dof,
    /// Color primary geometry by stable per-segment ID colors and emit the ID map.
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
    #[serde(alias = "colorScheme", alias = "color_scheme")]
    pub mode: SketchVisualizationMode,
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
            mode: SketchVisualizationMode::Dof,
            show_control_polygons: false,
        }
    }
}

/// A rendered sketch PNG plus machine-readable sidecar data.
///
/// The PNG is optimized for quick visual inspection. The sidecar data carries
/// the exact IDs, grouping, colors, and freedom facts needed by Zookeeper, CLI,
/// and MCP consumers that need to reason about the sketch without reading pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualization {
    pub png: Vec<u8>,
    pub data: SketchVisualizationData,
}

/// JSON-friendly facts used to interpret the visualization.
///
/// This is intentionally more graph-like than UI-like. The stable core records
/// source sketch entities and their IDs, while mode-specific sidecars explain
/// only the diagnostic overlay selected by `mode`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationData {
    /// The selected sketch object and best-effort display name.
    pub sketch: SketchVisualizationSketchInfo,
    /// World-space bounds used to fit the PNG camera.
    pub bounds: SketchVisualizationBounds,
    /// Unit suffixes discovered while extracting point positions.
    pub units: Vec<String>,
    /// The selected visualization diagnostic.
    pub mode: SketchVisualizationMode,
    /// Solver-level constraint summary for the whole sketch in DoF mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraint_status: Option<SketchConstraintStatus>,
    /// Compact degree-of-freedom facts, keyed by point and primary-segment IDs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dof: Option<SketchVisualizationDofData>,
    /// All owned sketch points, including control points.
    pub points: Vec<SketchVisualizationPointData>,
    /// Primary sketch geometry, excluding helper/control-polygon geometry.
    pub segments: Vec<SketchVisualizationSegmentData>,
    /// Constraint sidecar data attached to the selected sketch.
    pub constraints: Vec<SketchVisualizationConstraintData>,
    /// Stable per-segment colors emitted for IDs mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_color_map: Option<BTreeMap<usize, String>>,
    /// Groups of points whose coordinates are within `contact_tolerance`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contact_groups: Option<Vec<SketchVisualizationPointGroup>>,
    /// Groups of points joined by explicit coincident constraints.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coincident_groups: Option<Vec<SketchVisualizationCoincidentGroup>>,
    /// Connected sets of primary segments after contact and coincidence are applied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connected_components: Option<Vec<SketchVisualizationConnectedComponent>>,
    /// Endpoint point IDs that are not connected to any other endpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_endpoints: Option<Vec<usize>>,
    /// Per-component closedness hints derived from `open_endpoints`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closedness_hints: Option<Vec<SketchVisualizationClosednessHint>>,
    /// Recoverable extraction problems that did not prevent rendering.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contact_group: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coincident_group: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationDofData {
    /// The implicit state for IDs that do not appear in any bucket.
    #[serde(rename = "default")]
    pub default_state: Freedom,
    /// Non-default point DoF buckets.
    pub points: SketchVisualizationDofBuckets,
    /// Non-default primary-segment DoF buckets.
    pub segments: SketchVisualizationDofBuckets,
}

/// Compact DoF representation.
///
/// Free is the default state and is intentionally omitted to keep large sketches
/// readable. `unknown` is reserved for entities where the source data did not
/// provide a freedom value.
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
    /// DoF-mode connected component ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_id: Option<usize>,
    /// Actual render color in DoF mode. In IDs mode this is omitted because it
    /// would duplicate `id_color_map[id]`.
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

/// A coordinate-contact group.
///
/// These groups are geometric: points are grouped when their positions are equal
/// within the configured tolerance, even if no constraint backs that contact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SketchVisualizationPointGroup {
    pub id: usize,
    pub point_ids: Vec<usize>,
}

/// A group backed by coincident constraints.
///
/// This stays separate from contact groups so callers can tell inferred touching
/// geometry apart from explicit sketch intent.
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
