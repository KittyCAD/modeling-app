//! Static 2D sketch visualization for non-frontend consumers.
//!
//! This module renders the sketch scene objects produced by KCL execution into
//! a plain PNG and a JSON-friendly sidecar model. It is intentionally a debug
//! visualizer, not a port of the interactive sketch-mode UI.

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::f64::consts::TAU;
use std::io::Cursor;

use image::DynamicImage;
use image::ImageFormat;
use image::Rgba;
use image::RgbaImage;
use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;

use crate::ExecOutcome;
use crate::KclValueView;
use crate::SketchConstraintStatus;
use crate::SourceRange;
use crate::execution::ArtifactId;
use crate::execution::SegmentRepr;
use crate::execution::sketch_constraint_status_for_sketch;
use crate::front::ArcDirection;
use crate::front::Constraint;
use crate::front::Freedom;
use crate::front::Horizontal;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::front::Point2d;
use crate::front::Segment;
use crate::front::SourceRef;
use crate::front::Vertical;
use crate::frontend::sketch::ConstraintSegment;

const DEFAULT_WIDTH: u32 = 1024;
const DEFAULT_HEIGHT: u32 = 1024;
const DEFAULT_PADDING: u32 = 48;
const DEFAULT_CONTACT_TOLERANCE: f64 = 1.0e-6;
const SPLINE_SAMPLES_PER_SPAN: usize = 24;
const ARC_SAMPLE_COUNT: usize = 100;
const PRIMARY_LINE_WIDTH: f64 = 3.0;
const CONTROL_POLYGON_LINE_WIDTH: f64 = 1.25;
const POINT_RADIUS: f64 = 4.0;
const GROUPED_POINT_RADIUS: f64 = 5.0;

const FREE_COLOR: Color = Color::rgb(0x3c, 0x73, 0xff);
const CONFLICT_COLOR: Color = Color::rgb(0xff, 0x5e, 0x5b);
const FIXED_DARK_THEME_COLOR: Color = Color::rgb(0xff, 0xff, 0xff);
const FIXED_LIGHT_THEME_COLOR: Color = Color::rgb(0x00, 0x00, 0x00);
const DARK_BACKGROUND: Color = Color::rgb(0x18, 0x1a, 0x1f);
const LIGHT_BACKGROUND: Color = Color::rgb(0xfa, 0xfa, 0xfa);
const CONTROL_POLYGON_COLOR: Color = Color::rgb(0x8a, 0x8a, 0x8a);
const POINT_OUTLINE_DARK: Color = Color::rgb(0x18, 0x1a, 0x1f);
const POINT_OUTLINE_LIGHT: Color = Color::rgb(0xfa, 0xfa, 0xfa);

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
    pub freedom: Freedom,
    pub owner: Option<usize>,
    pub contact_group: Option<usize>,
    pub coincident_group: Option<usize>,
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
    pub freedom: Option<Freedom>,
    pub component_id: usize,
    pub rendered_color: String,
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

impl ExecOutcome {
    pub fn visualize_sketch(
        &self,
        selector: SketchSelector,
        options: SketchVisualizationOptions,
    ) -> Result<SketchVisualization, SketchVisualizationError> {
        visualize_scene_objects_with_variables(&self.scene_objects, Some(&self.variables), selector, options)
    }
}

pub fn visualize_scene_objects(
    scene_objects: &[Object],
    selector: SketchSelector,
    options: SketchVisualizationOptions,
) -> Result<SketchVisualization, SketchVisualizationError> {
    visualize_scene_objects_with_variables(scene_objects, None, selector, options)
}

fn visualize_scene_objects_with_variables(
    scene_objects: &[Object],
    variables: Option<&IndexMap<String, KclValueView>>,
    selector: SketchSelector,
    options: SketchVisualizationOptions,
) -> Result<SketchVisualization, SketchVisualizationError> {
    validate_canvas(&options)?;

    let sketch_object = select_sketch(scene_objects, variables, &selector)?;
    let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
        return Err(SketchVisualizationError::UnexpectedObjectKind {
            id: sketch_object.id.0,
            expected: "sketch",
            actual: object_kind_name(&sketch_object.kind),
        });
    };

    let selected_name = match &selector {
        SketchSelector::Name(name) => Some(name.clone()),
        SketchSelector::First | SketchSelector::Id(_) => None,
    };
    let mut extraction = Extraction::new(scene_objects, sketch_object, options, selected_name);
    extraction.collect_points_and_segments(sketch)?;
    extraction.collect_constraints(sketch)?;
    extraction.finish()
}

#[derive(Debug)]
struct Extraction<'a> {
    scene_objects: &'a [Object],
    sketch_object: &'a Object,
    options: SketchVisualizationOptions,
    selected_name: Option<String>,
    points: BTreeMap<usize, InternalPoint>,
    primary_segments: BTreeMap<usize, InternalSegment>,
    control_polygons: Vec<InternalPolyline>,
    constraints: Vec<SketchVisualizationConstraintData>,
    units: BTreeSet<String>,
    warnings: Vec<String>,
}

impl<'a> Extraction<'a> {
    fn new(
        scene_objects: &'a [Object],
        sketch_object: &'a Object,
        options: SketchVisualizationOptions,
        selected_name: Option<String>,
    ) -> Self {
        Self {
            scene_objects,
            sketch_object,
            options,
            selected_name,
            points: BTreeMap::new(),
            primary_segments: BTreeMap::new(),
            control_polygons: Vec::new(),
            constraints: Vec::new(),
            units: BTreeSet::new(),
            warnings: Vec::new(),
        }
    }

    fn collect_points_and_segments(&mut self, sketch: &crate::front::Sketch) -> Result<(), SketchVisualizationError> {
        for &object_id in &sketch.segments {
            let object = object_by_id(self.scene_objects, object_id)?;
            let ObjectKind::Segment { segment } = &object.kind else {
                self.warnings.push(format!(
                    "Sketch references object {}, but it is {} instead of a segment",
                    object.id.0,
                    object_kind_name(&object.kind)
                ));
                continue;
            };

            match segment {
                Segment::Point(point) => {
                    self.insert_point(object.id, point)?;
                    if point.owner.is_none() {
                        self.primary_segments.insert(
                            object.id.0,
                            InternalSegment {
                                id: object.id.0,
                                kind: SketchVisualizationSegmentKind::Point,
                                point_ids: vec![object.id.0],
                                endpoint_ids: vec![object.id.0],
                                construction: false,
                                freedom: Some(point.freedom()),
                                polylines: vec![vec![position_to_point(&point.position)]],
                            },
                        );
                    }
                }
                Segment::Line(line) => {
                    if line.owner.is_some() {
                        if let Some(polyline) = self.line_polyline(line) {
                            self.control_polygons.push(InternalPolyline {
                                points: polyline,
                                dashed: true,
                            });
                        }
                        continue;
                    }

                    let Some(polyline) = self.line_polyline(line) else {
                        self.warnings.push(format!(
                            "Line segment {} has missing endpoint point objects",
                            object.id.0
                        ));
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::Line,
                            point_ids: vec![line.start.0, line.end.0],
                            endpoint_ids: vec![line.start.0, line.end.0],
                            construction: line.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::Arc(arc) => {
                    let Some(polyline) = self.arc_polyline(arc.start, arc.end, arc.center, arc.direction) else {
                        self.warnings
                            .push(format!("Arc segment {} has missing point objects", object.id.0));
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::Arc,
                            point_ids: vec![arc.start.0, arc.end.0, arc.center.0],
                            endpoint_ids: vec![arc.start.0, arc.end.0],
                            construction: arc.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::Circle(circle) => {
                    let Some(polyline) = self.circle_polyline(circle.start, circle.center) else {
                        self.warnings
                            .push(format!("Circle segment {} has missing point objects", object.id.0));
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::Circle,
                            point_ids: vec![circle.start.0, circle.center.0],
                            endpoint_ids: Vec::new(),
                            construction: circle.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::ControlPointSpline(spline) => {
                    let control_points = spline
                        .controls
                        .iter()
                        .filter_map(|id| self.points.get(&id.0).map(|point| point.position))
                        .collect::<Vec<_>>();
                    if control_points.len() != spline.controls.len() {
                        self.warnings.push(format!(
                            "Control point spline segment {} has missing control point objects",
                            object.id.0
                        ));
                        continue;
                    }
                    let polyline = sample_control_point_spline(&control_points, spline.degree as usize);
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::ControlPointSpline,
                            point_ids: spline.controls.iter().map(|id| id.0).collect(),
                            endpoint_ids: spline
                                .controls
                                .first()
                                .into_iter()
                                .chain(spline.controls.last())
                                .map(|id| id.0)
                                .collect(),
                            construction: spline.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
            }
        }

        Ok(())
    }

    fn collect_constraints(&mut self, sketch: &crate::front::Sketch) -> Result<(), SketchVisualizationError> {
        for &constraint_id in &sketch.constraints {
            let object = object_by_id(self.scene_objects, constraint_id)?;
            let ObjectKind::Constraint { constraint } = &object.kind else {
                self.warnings.push(format!(
                    "Sketch references object {} as a constraint, but it is {}",
                    object.id.0,
                    object_kind_name(&object.kind)
                ));
                continue;
            };
            self.constraints.push(SketchVisualizationConstraintData {
                id: object.id.0,
                kind: constraint_kind_name(constraint).to_owned(),
                targets: constraint_targets(constraint),
            });
        }
        Ok(())
    }

    fn finish(self) -> Result<SketchVisualization, SketchVisualizationError> {
        let id_color_map = self.id_color_map();
        let contact_groups = contact_groups(&self.points, self.options.contact_tolerance);
        let coincident_groups = coincident_groups(&self.constraints, &self.points);
        let component_result = connected_components(&self.primary_segments, &contact_groups, &coincident_groups);

        let point_contact_group = point_group_index(&contact_groups);
        let point_coincident_group = point_group_index(
            &coincident_groups
                .iter()
                .map(|group| SketchVisualizationPointGroup {
                    id: group.id,
                    point_ids: group.point_ids.clone(),
                })
                .collect::<Vec<_>>(),
        );

        let rendered_colors = self.rendered_colors(&id_color_map);
        let mut segment_data = Vec::with_capacity(self.primary_segments.len());
        for segment in self.primary_segments.values() {
            let component_id = component_result
                .segment_to_component
                .get(&segment.id)
                .copied()
                .unwrap_or_default();
            segment_data.push(SketchVisualizationSegmentData {
                id: segment.id,
                kind: segment.kind,
                point_ids: segment.point_ids.clone(),
                endpoint_ids: segment.endpoint_ids.clone(),
                construction: segment.construction,
                freedom: segment.freedom,
                component_id,
                rendered_color: rendered_colors
                    .get(&segment.id)
                    .cloned()
                    .unwrap_or_else(|| FREE_COLOR.to_hex_string()),
            });
        }

        let mut point_data = Vec::with_capacity(self.points.len());
        for point in self.points.values() {
            point_data.push(SketchVisualizationPointData {
                id: point.id,
                position: point.position,
                freedom: point.freedom,
                owner: point.owner,
                contact_group: point_contact_group.get(&point.id).copied(),
                coincident_group: point_coincident_group.get(&point.id).copied(),
            });
        }

        let bounds = self.bounds();
        let data = SketchVisualizationData {
            sketch: SketchVisualizationSketchInfo {
                id: self.sketch_object.id.0,
                name: non_empty_name(&self.sketch_object.label).or(self.selected_name),
            },
            bounds,
            units: self.units.into_iter().collect(),
            color_scheme: self.options.color_scheme,
            constraint_status: sketch_constraint_status_for_sketch(self.scene_objects, self.sketch_object),
            points: point_data,
            segments: segment_data,
            constraints: self.constraints.clone(),
            id_color_map,
            contact_groups,
            coincident_groups,
            connected_components: component_result.components,
            open_endpoints: component_result.open_endpoints,
            closedness_hints: component_result.closedness_hints,
            warnings: self.warnings.clone(),
        };

        let png = render_png(
            &self.primary_segments,
            &self.control_polygons,
            &self.points,
            &rendered_colors,
            &point_contact_group,
            bounds,
            &self.options,
        )?;

        Ok(SketchVisualization { png, data })
    }

    fn insert_point(&mut self, id: ObjectId, point: &crate::front::Point) -> Result<(), SketchVisualizationError> {
        collect_units(&mut self.units, &point.position);
        self.points.insert(
            id.0,
            InternalPoint {
                id: id.0,
                position: position_to_point(&point.position),
                owner: point.owner.map(|owner| owner.0),
                freedom: point.freedom(),
            },
        );
        Ok(())
    }

    fn point_freedom(&self, id: ObjectId) -> Option<Freedom> {
        self.points.get(&id.0).map(|point| point.freedom)
    }

    fn line_polyline(&self, line: &crate::front::Line) -> Option<Vec<SketchVisualizationPoint>> {
        Some(vec![
            self.points.get(&line.start.0)?.position,
            self.points.get(&line.end.0)?.position,
        ])
    }

    fn arc_polyline(
        &self,
        start_id: ObjectId,
        end_id: ObjectId,
        center_id: ObjectId,
        direction: ArcDirection,
    ) -> Option<Vec<SketchVisualizationPoint>> {
        let start = self.points.get(&start_id.0)?.position;
        let end = self.points.get(&end_id.0)?.position;
        let center = self.points.get(&center_id.0)?.position;
        Some(sample_arc(center, start, end, direction.is_ccw(), ARC_SAMPLE_COUNT))
    }

    fn circle_polyline(&self, start_id: ObjectId, center_id: ObjectId) -> Option<Vec<SketchVisualizationPoint>> {
        let start = self.points.get(&start_id.0)?.position;
        let center = self.points.get(&center_id.0)?.position;
        let radius = distance(start, center);
        Some(sample_circle(center, radius, ARC_SAMPLE_COUNT))
    }

    fn id_color_map(&self) -> BTreeMap<usize, String> {
        self.primary_segments
            .keys()
            .map(|id| (*id, id_color(*id).to_hex_string()))
            .collect()
    }

    fn rendered_colors(&self, id_color_map: &BTreeMap<usize, String>) -> BTreeMap<usize, String> {
        self.primary_segments
            .values()
            .map(|segment| {
                let color = match self.options.color_scheme {
                    SketchVisualizationColorScheme::Ids => id_color_map
                        .get(&segment.id)
                        .cloned()
                        .unwrap_or_else(|| id_color(segment.id).to_hex_string()),
                    SketchVisualizationColorScheme::Dof => {
                        dof_color(segment.freedom, self.options.theme).to_hex_string()
                    }
                };
                (segment.id, color)
            })
            .collect()
    }

    fn bounds(&self) -> SketchVisualizationBounds {
        let mut bounds = BoundsBuilder::default();
        for segment in self.primary_segments.values() {
            for polyline in &segment.polylines {
                for point in polyline {
                    bounds.include(*point);
                }
            }
        }
        for point in self.points.values() {
            bounds.include(point.position);
        }
        bounds.finish()
    }
}

#[derive(Debug, Clone)]
struct InternalPoint {
    id: usize,
    position: SketchVisualizationPoint,
    owner: Option<usize>,
    freedom: Freedom,
}

#[derive(Debug, Clone)]
struct InternalSegment {
    id: usize,
    kind: SketchVisualizationSegmentKind,
    point_ids: Vec<usize>,
    endpoint_ids: Vec<usize>,
    construction: bool,
    freedom: Option<Freedom>,
    polylines: Vec<Vec<SketchVisualizationPoint>>,
}

#[derive(Debug, Clone)]
struct InternalPolyline {
    points: Vec<SketchVisualizationPoint>,
    dashed: bool,
}

#[derive(Debug, Clone)]
struct ComponentResult {
    components: Vec<SketchVisualizationConnectedComponent>,
    segment_to_component: BTreeMap<usize, usize>,
    open_endpoints: Vec<usize>,
    closedness_hints: Vec<SketchVisualizationClosednessHint>,
}

fn validate_canvas(options: &SketchVisualizationOptions) -> Result<(), SketchVisualizationError> {
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

fn select_sketch<'a>(
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

fn object_by_id(scene_objects: &[Object], id: ObjectId) -> Result<&Object, SketchVisualizationError> {
    scene_objects
        .get(id.0)
        .filter(|object| object.id == id)
        .or_else(|| scene_objects.iter().find(|object| object.id == id))
        .ok_or(SketchVisualizationError::MissingObject { id: id.0 })
}

fn collect_units(units: &mut BTreeSet<String>, point: &Point2d<Number>) {
    units.insert(format!("{:?}", point.x.units));
    units.insert(format!("{:?}", point.y.units));
}

fn position_to_point(point: &Point2d<Number>) -> SketchVisualizationPoint {
    SketchVisualizationPoint {
        x: point.x.value,
        y: point.y.value,
    }
}

fn non_empty_name(name: &str) -> Option<String> {
    if name.is_empty() { None } else { Some(name.to_owned()) }
}

fn object_kind_name(kind: &ObjectKind) -> &'static str {
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

fn constraint_kind_name(constraint: &Constraint) -> &'static str {
    match constraint {
        Constraint::Coincident(_) => "coincident",
        Constraint::Distance(_) => "distance",
        Constraint::Angle(_) => "angle",
        Constraint::Diameter(_) => "diameter",
        Constraint::EqualRadius(_) => "equal_radius",
        Constraint::Fixed(_) => "fixed",
        Constraint::HorizontalDistance(_) => "horizontal_distance",
        Constraint::VerticalDistance(_) => "vertical_distance",
        Constraint::Horizontal(_) => "horizontal",
        Constraint::LinesEqualLength(_) => "lines_equal_length",
        Constraint::Midpoint(_) => "midpoint",
        Constraint::Parallel(_) => "parallel",
        Constraint::Perpendicular(_) => "perpendicular",
        Constraint::Radius(_) => "radius",
        Constraint::Symmetric(_) => "symmetric",
        Constraint::Tangent(_) => "tangent",
        Constraint::Vertical(_) => "vertical",
    }
}

fn constraint_targets(constraint: &Constraint) -> Vec<SketchVisualizationConstraintTarget> {
    match constraint {
        Constraint::Coincident(coincident) => coincident.segments.iter().map(constraint_segment_target).collect(),
        Constraint::Distance(distance)
        | Constraint::HorizontalDistance(distance)
        | Constraint::VerticalDistance(distance) => distance.points.iter().map(constraint_segment_target).collect(),
        Constraint::Angle(angle) => angle.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Diameter(diameter) => vec![object_target(diameter.arc)],
        Constraint::EqualRadius(equal_radius) => equal_radius.input.iter().map(|id| object_target(*id)).collect(),
        Constraint::Fixed(fixed) => fixed.points.iter().map(|point| object_target(point.point)).collect(),
        Constraint::Horizontal(horizontal) => match horizontal {
            Horizontal::Line { line } => vec![object_target(*line)],
            Horizontal::Points { points } => points.iter().map(constraint_segment_target).collect(),
        },
        Constraint::LinesEqualLength(equal_length) => equal_length.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Midpoint(midpoint) => vec![
            constraint_segment_target(&midpoint.point),
            object_target(midpoint.segment),
        ],
        Constraint::Parallel(parallel) => parallel.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Perpendicular(perpendicular) => perpendicular.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Radius(radius) => vec![object_target(radius.arc)],
        Constraint::Symmetric(symmetric) => symmetric
            .input
            .iter()
            .chain(std::iter::once(&symmetric.axis))
            .map(|id| object_target(*id))
            .collect(),
        Constraint::Tangent(tangent) => tangent.input.iter().map(|id| object_target(*id)).collect(),
        Constraint::Vertical(vertical) => match vertical {
            Vertical::Line { line } => vec![object_target(*line)],
            Vertical::Points { points } => points.iter().map(constraint_segment_target).collect(),
        },
    }
}

fn constraint_segment_target(segment: &ConstraintSegment) -> SketchVisualizationConstraintTarget {
    match segment {
        ConstraintSegment::Segment(id) => object_target(*id),
        ConstraintSegment::Origin(_) => SketchVisualizationConstraintTarget::Origin,
    }
}

fn object_target(id: ObjectId) -> SketchVisualizationConstraintTarget {
    SketchVisualizationConstraintTarget::Object { id: id.0 }
}

fn contact_groups(
    points: &BTreeMap<usize, InternalPoint>,
    contact_tolerance: f64,
) -> Vec<SketchVisualizationPointGroup> {
    let point_ids = points.keys().copied().collect::<Vec<_>>();
    let mut union = UnionFind::new(point_ids.iter().copied());
    let tolerance = libm::fmax(contact_tolerance, 0.0);

    for (left_index, left_id) in point_ids.iter().enumerate() {
        for right_id in point_ids.iter().skip(left_index + 1) {
            let left = points[left_id].position;
            let right = points[right_id].position;
            if distance(left, right) <= tolerance {
                union.union(*left_id, *right_id);
            }
        }
    }

    point_groups_from_union(point_ids, &mut union)
}

fn coincident_groups(
    constraints: &[SketchVisualizationConstraintData],
    points: &BTreeMap<usize, InternalPoint>,
) -> Vec<SketchVisualizationCoincidentGroup> {
    let mut union = UnionFind::new(points.keys().copied());
    let mut active_point_ids = BTreeSet::new();
    let mut origin_anchor = None;
    let mut roots_including_origin = BTreeSet::new();

    for constraint in constraints.iter().filter(|constraint| constraint.kind == "coincident") {
        let mut point_ids = Vec::new();
        let mut includes_origin = false;
        for target in &constraint.targets {
            match target {
                SketchVisualizationConstraintTarget::Object { id } if points.contains_key(id) => point_ids.push(*id),
                SketchVisualizationConstraintTarget::Object { .. } => {}
                SketchVisualizationConstraintTarget::Origin => includes_origin = true,
            }
        }
        point_ids.sort_unstable();
        point_ids.dedup();
        active_point_ids.extend(point_ids.iter().copied());
        union_all(&mut union, &point_ids);

        if includes_origin && let Some(first_point_id) = point_ids.first().copied() {
            if let Some(anchor) = origin_anchor {
                union.union(anchor, first_point_id);
            } else {
                origin_anchor = Some(first_point_id);
            }
            roots_including_origin.insert(first_point_id);
        }
    }

    let mut root_to_points = BTreeMap::<usize, Vec<usize>>::new();
    for point_id in active_point_ids {
        root_to_points.entry(union.find(point_id)).or_default().push(point_id);
    }

    let mut root_includes_origin = BTreeSet::new();
    for point_id in roots_including_origin {
        root_includes_origin.insert(union.find(point_id));
    }

    root_to_points
        .into_iter()
        .filter_map(|(root, mut point_ids)| {
            point_ids.sort_unstable();
            let includes_origin = root_includes_origin.contains(&root);
            if point_ids.len() > 1 || includes_origin {
                Some(SketchVisualizationCoincidentGroup {
                    id: 0,
                    point_ids,
                    includes_origin,
                })
            } else {
                None
            }
        })
        .enumerate()
        .map(|(id, mut group)| {
            group.id = id;
            group
        })
        .collect()
}

fn point_group_index(groups: &[SketchVisualizationPointGroup]) -> BTreeMap<usize, usize> {
    groups
        .iter()
        .flat_map(|group| group.point_ids.iter().map(move |point_id| (*point_id, group.id)))
        .collect()
}

fn connected_components(
    segments: &BTreeMap<usize, InternalSegment>,
    contact_groups: &[SketchVisualizationPointGroup],
    coincident_groups: &[SketchVisualizationCoincidentGroup],
) -> ComponentResult {
    let segment_ids = segments.keys().copied().collect::<Vec<_>>();
    let mut union = UnionFind::new(segment_ids.iter().copied());
    let endpoint_to_segments = endpoint_to_segments(segments);

    for segment_ids_for_endpoint in endpoint_to_segments.values() {
        union_all(&mut union, segment_ids_for_endpoint);
    }
    for group in contact_groups {
        let touching_segments = segments_touching_points(&endpoint_to_segments, &group.point_ids);
        union_all(&mut union, &touching_segments);
    }
    for group in coincident_groups {
        let coincident_segments = segments_touching_points(&endpoint_to_segments, &group.point_ids);
        union_all(&mut union, &coincident_segments);
    }

    let mut root_to_segments: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for segment_id in segment_ids {
        root_to_segments
            .entry(union.find(segment_id))
            .or_default()
            .push(segment_id);
    }

    let mut segment_to_component = BTreeMap::new();
    let mut components = Vec::new();
    for (component_id, (_, mut component_segment_ids)) in root_to_segments.into_iter().enumerate() {
        component_segment_ids.sort_unstable();
        for segment_id in &component_segment_ids {
            segment_to_component.insert(*segment_id, component_id);
        }
        components.push(SketchVisualizationConnectedComponent {
            id: component_id,
            segment_ids: component_segment_ids,
        });
    }

    let mut endpoint_connection_union = UnionFind::new(
        segments
            .values()
            .flat_map(|segment| segment.endpoint_ids.iter().copied()),
    );
    for group in contact_groups {
        union_all(&mut endpoint_connection_union, &group.point_ids);
    }
    for group in coincident_groups {
        union_all(&mut endpoint_connection_union, &group.point_ids);
    }

    let mut endpoint_counts_by_connection_root = BTreeMap::<usize, usize>::new();
    for segment in segments.values() {
        for endpoint_id in &segment.endpoint_ids {
            let root = endpoint_connection_union.find(*endpoint_id);
            *endpoint_counts_by_connection_root.entry(root).or_default() += 1;
        }
    }

    let mut open_endpoints_by_component = BTreeMap::<usize, Vec<usize>>::new();
    let mut open_endpoints = Vec::new();
    for segment in segments.values() {
        let component_id = segment_to_component.get(&segment.id).copied().unwrap_or_default();
        for endpoint_id in &segment.endpoint_ids {
            let root = endpoint_connection_union.find(*endpoint_id);
            let connected_count = endpoint_counts_by_connection_root
                .get(&root)
                .copied()
                .unwrap_or_default();
            if connected_count < 2 {
                open_endpoints.push(*endpoint_id);
                open_endpoints_by_component
                    .entry(component_id)
                    .or_default()
                    .push(*endpoint_id);
            }
        }
    }
    open_endpoints.sort_unstable();
    open_endpoints.dedup();

    let closedness_hints = components
        .iter()
        .map(|component| {
            let mut component_open_endpoints = open_endpoints_by_component.remove(&component.id).unwrap_or_default();
            component_open_endpoints.sort_unstable();
            component_open_endpoints.dedup();
            SketchVisualizationClosednessHint {
                component_id: component.id,
                is_closed: component_open_endpoints.is_empty(),
                open_endpoint_ids: component_open_endpoints,
            }
        })
        .collect();

    ComponentResult {
        components,
        segment_to_component,
        open_endpoints,
        closedness_hints,
    }
}

fn endpoint_to_segments(segments: &BTreeMap<usize, InternalSegment>) -> BTreeMap<usize, Vec<usize>> {
    let mut endpoints = BTreeMap::<usize, Vec<usize>>::new();
    for segment in segments.values() {
        for endpoint_id in &segment.endpoint_ids {
            endpoints.entry(*endpoint_id).or_default().push(segment.id);
        }
    }
    endpoints
}

fn segments_touching_points(endpoint_to_segments: &BTreeMap<usize, Vec<usize>>, point_ids: &[usize]) -> Vec<usize> {
    let mut segment_ids = point_ids
        .iter()
        .filter_map(|point_id| endpoint_to_segments.get(point_id))
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    segment_ids.sort_unstable();
    segment_ids.dedup();
    segment_ids
}

fn union_all(union: &mut UnionFind, ids: &[usize]) {
    let Some(first) = ids.first().copied() else {
        return;
    };
    for id in ids.iter().skip(1) {
        union.union(first, *id);
    }
}

fn point_groups_from_union(mut point_ids: Vec<usize>, union: &mut UnionFind) -> Vec<SketchVisualizationPointGroup> {
    point_ids.sort_unstable();
    let mut root_to_points: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for point_id in point_ids {
        root_to_points.entry(union.find(point_id)).or_default().push(point_id);
    }

    root_to_points
        .into_values()
        .filter(|point_ids| point_ids.len() > 1)
        .enumerate()
        .map(|(id, point_ids)| SketchVisualizationPointGroup { id, point_ids })
        .collect()
}

#[derive(Debug, Clone)]
struct UnionFind {
    parent: BTreeMap<usize, usize>,
}

impl UnionFind {
    fn new(ids: impl IntoIterator<Item = usize>) -> Self {
        Self {
            parent: ids.into_iter().map(|id| (id, id)).collect(),
        }
    }

    fn find(&mut self, id: usize) -> usize {
        let parent = *self.parent.entry(id).or_insert(id);
        if parent == id {
            id
        } else {
            let root = self.find(parent);
            self.parent.insert(id, root);
            root
        }
    }

    fn union(&mut self, a: usize, b: usize) {
        let root_a = self.find(a);
        let root_b = self.find(b);
        if root_a == root_b {
            return;
        }
        let (low, high) = if root_a < root_b {
            (root_a, root_b)
        } else {
            (root_b, root_a)
        };
        self.parent.insert(high, low);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Color {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

impl Color {
    const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b, a: 255 }
    }

    fn to_rgba(self) -> Rgba<u8> {
        Rgba([self.r, self.g, self.b, self.a])
    }

    fn to_hex_string(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

fn dof_color(freedom: Option<Freedom>, theme: SketchVisualizationTheme) -> Color {
    match freedom {
        Some(Freedom::Conflict) => CONFLICT_COLOR,
        Some(Freedom::Fixed) => match theme {
            SketchVisualizationTheme::Dark => FIXED_DARK_THEME_COLOR,
            SketchVisualizationTheme::Light => FIXED_LIGHT_THEME_COLOR,
        },
        Some(Freedom::Free) | None => FREE_COLOR,
    }
}

fn id_color(id: usize) -> Color {
    let hash = stable_id_hash(id as u64);
    let hue = ((hash % 360) as f64) / 360.0;
    let saturation = 0.62 + (((hash >> 32) % 18) as f64 / 100.0);
    let value = 0.82 + (((hash >> 40) % 14) as f64 / 100.0);
    hsv_to_rgb(hue, saturation, value)
}

fn stable_id_hash(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn hsv_to_rgb(h: f64, s: f64, v: f64) -> Color {
    let i = (h * 6.0).floor();
    let f = h * 6.0 - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - f * s);
    let t = v * (1.0 - (1.0 - f) * s);
    let (r, g, b) = match (i as u32) % 6 {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    Color::rgb(float_channel(r), float_channel(g), float_channel(b))
}

fn float_channel(value: f64) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn render_png(
    segments: &BTreeMap<usize, InternalSegment>,
    control_polygons: &[InternalPolyline],
    points: &BTreeMap<usize, InternalPoint>,
    rendered_colors: &BTreeMap<usize, String>,
    point_contact_group: &BTreeMap<usize, usize>,
    bounds: SketchVisualizationBounds,
    options: &SketchVisualizationOptions,
) -> Result<Vec<u8>, SketchVisualizationError> {
    let background = match options.theme {
        SketchVisualizationTheme::Dark => DARK_BACKGROUND,
        SketchVisualizationTheme::Light => LIGHT_BACKGROUND,
    };
    let point_outline = match options.theme {
        SketchVisualizationTheme::Dark => POINT_OUTLINE_DARK,
        SketchVisualizationTheme::Light => POINT_OUTLINE_LIGHT,
    };
    let mut image = RgbaImage::from_pixel(options.width, options.height, background.to_rgba());
    let transform = Transform::new(bounds, options);

    if options.show_control_polygons {
        for polyline in control_polygons {
            draw_polyline(
                &mut image,
                &polyline.points,
                CONTROL_POLYGON_COLOR,
                CONTROL_POLYGON_LINE_WIDTH,
                polyline.dashed,
                &transform,
            );
        }
    }

    for segment in segments.values() {
        let color = rendered_colors
            .get(&segment.id)
            .and_then(|hex| Color::from_hex(hex))
            .unwrap_or(FREE_COLOR);
        for polyline in &segment.polylines {
            if segment.kind == SketchVisualizationSegmentKind::Point {
                continue;
            }
            draw_polyline(
                &mut image,
                polyline,
                color,
                PRIMARY_LINE_WIDTH,
                segment.construction,
                &transform,
            );
        }
    }

    for point in points.values() {
        let owner_color = point
            .owner
            .and_then(|owner| rendered_colors.get(&owner))
            .and_then(|hex| Color::from_hex(hex));
        let color = owner_color.unwrap_or_else(|| dof_color(Some(point.freedom), options.theme));
        let radius = if point_contact_group.contains_key(&point.id) {
            GROUPED_POINT_RADIUS
        } else {
            POINT_RADIUS
        };
        let screen = transform.point(point.position);
        draw_filled_circle(&mut image, screen, radius + 1.5, point_outline);
        draw_filled_circle(&mut image, screen, radius, color);
    }

    let dynamic = DynamicImage::ImageRgba8(image);
    let mut cursor = Cursor::new(Vec::new());
    dynamic.write_to(&mut cursor, ImageFormat::Png)?;
    Ok(cursor.into_inner())
}

impl Color {
    fn from_hex(hex: &str) -> Option<Self> {
        let hex = hex.strip_prefix('#').unwrap_or(hex);
        if hex.len() != 6 {
            return None;
        }
        let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
        let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
        let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
        Some(Self::rgb(r, g, b))
    }
}

#[derive(Debug, Clone, Copy)]
struct Transform {
    scale: f64,
    offset_x: f64,
    offset_y: f64,
}

impl Transform {
    fn new(bounds: SketchVisualizationBounds, options: &SketchVisualizationOptions) -> Self {
        let content_width = (options.width - options.padding * 2) as f64;
        let content_height = (options.height - options.padding * 2) as f64;
        let world_width = libm::fmax((bounds.max.x - bounds.min.x).abs(), 1.0);
        let world_height = libm::fmax((bounds.max.y - bounds.min.y).abs(), 1.0);
        let scale = libm::fmin(content_width / world_width, content_height / world_height);
        let world_center_x = (bounds.min.x + bounds.max.x) * 0.5;
        let world_center_y = (bounds.min.y + bounds.max.y) * 0.5;
        let screen_center_x = options.width as f64 * 0.5;
        let screen_center_y = options.height as f64 * 0.5;
        Self {
            scale,
            offset_x: screen_center_x - world_center_x * scale,
            offset_y: screen_center_y + world_center_y * scale,
        }
    }

    fn point(self, point: SketchVisualizationPoint) -> ScreenPoint {
        ScreenPoint {
            x: point.x * self.scale + self.offset_x,
            y: -point.y * self.scale + self.offset_y,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ScreenPoint {
    x: f64,
    y: f64,
}

fn draw_polyline(
    image: &mut RgbaImage,
    points: &[SketchVisualizationPoint],
    color: Color,
    width: f64,
    dashed: bool,
    transform: &Transform,
) {
    for segment in points.windows(2) {
        let start = transform.point(segment[0]);
        let end = transform.point(segment[1]);
        if dashed {
            draw_dashed_line(image, start, end, color, width);
        } else {
            draw_line(image, start, end, color, width);
        }
    }
}

fn draw_dashed_line(image: &mut RgbaImage, start: ScreenPoint, end: ScreenPoint, color: Color, width: f64) {
    let length = screen_distance(start, end);
    if length <= f64::EPSILON {
        return;
    }

    let dash = 12.0;
    let gap = 8.0;
    let step = dash + gap;
    let mut cursor = 0.0;
    while cursor < length {
        let dash_end = libm::fmin(cursor + dash, length);
        let from = interpolate_screen(start, end, cursor / length);
        let to = interpolate_screen(start, end, dash_end / length);
        draw_line(image, from, to, color, width);
        cursor += step;
    }
}

fn draw_line(image: &mut RgbaImage, start: ScreenPoint, end: ScreenPoint, color: Color, width: f64) {
    let length = screen_distance(start, end);
    if length <= f64::EPSILON {
        draw_filled_circle(image, start, width * 0.5, color);
        return;
    }

    let samples = length.ceil() as usize;
    for index in 0..=samples {
        let t = index as f64 / samples as f64;
        draw_filled_circle(image, interpolate_screen(start, end, t), width * 0.5, color);
    }
}

fn draw_filled_circle(image: &mut RgbaImage, center: ScreenPoint, radius: f64, color: Color) {
    let min_x = (center.x - radius).floor() as i32;
    let max_x = (center.x + radius).ceil() as i32;
    let min_y = (center.y - radius).floor() as i32;
    let max_y = (center.y + radius).ceil() as i32;
    let radius_sq = radius * radius;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            if x < 0 || y < 0 || x >= image.width() as i32 || y >= image.height() as i32 {
                continue;
            }
            let dx = x as f64 + 0.5 - center.x;
            let dy = y as f64 + 0.5 - center.y;
            if dx * dx + dy * dy <= radius_sq {
                image.put_pixel(x as u32, y as u32, color.to_rgba());
            }
        }
    }
}

fn screen_distance(a: ScreenPoint, b: ScreenPoint) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn interpolate_screen(a: ScreenPoint, b: ScreenPoint, t: f64) -> ScreenPoint {
    ScreenPoint {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}

#[derive(Default)]
struct BoundsBuilder {
    min_x: Option<f64>,
    min_y: Option<f64>,
    max_x: Option<f64>,
    max_y: Option<f64>,
}

impl BoundsBuilder {
    fn include(&mut self, point: SketchVisualizationPoint) {
        if !point.x.is_finite() || !point.y.is_finite() {
            return;
        }
        self.min_x = Some(self.min_x.map_or(point.x, |value| libm::fmin(value, point.x)));
        self.min_y = Some(self.min_y.map_or(point.y, |value| libm::fmin(value, point.y)));
        self.max_x = Some(self.max_x.map_or(point.x, |value| libm::fmax(value, point.x)));
        self.max_y = Some(self.max_y.map_or(point.y, |value| libm::fmax(value, point.y)));
    }

    fn finish(self) -> SketchVisualizationBounds {
        let min_x = self.min_x.unwrap_or(-1.0);
        let min_y = self.min_y.unwrap_or(-1.0);
        let max_x = self.max_x.unwrap_or(1.0);
        let max_y = self.max_y.unwrap_or(1.0);
        let pad_x = if (max_x - min_x).abs() < f64::EPSILON { 0.5 } else { 0.0 };
        let pad_y = if (max_y - min_y).abs() < f64::EPSILON { 0.5 } else { 0.0 };
        SketchVisualizationBounds {
            min: SketchVisualizationPoint {
                x: min_x - pad_x,
                y: min_y - pad_y,
            },
            max: SketchVisualizationPoint {
                x: max_x + pad_x,
                y: max_y + pad_y,
            },
        }
    }
}

fn sample_arc(
    center: SketchVisualizationPoint,
    start: SketchVisualizationPoint,
    end: SketchVisualizationPoint,
    ccw: bool,
    samples: usize,
) -> Vec<SketchVisualizationPoint> {
    let radius = (distance(center, start) + distance(center, end)) * 0.5;
    let start_angle = libm::atan2(start.y - center.y, start.x - center.x);
    let end_angle = libm::atan2(end.y - center.y, end.x - center.x);
    let mut sweep = if ccw {
        positive_angle_delta(end_angle - start_angle)
    } else {
        -positive_angle_delta(start_angle - end_angle)
    };
    if sweep.abs() <= 1.0e-12 {
        sweep = if ccw { TAU } else { -TAU };
    }
    (0..=samples)
        .map(|index| {
            let t = index as f64 / samples.max(1) as f64;
            let angle = start_angle + sweep * t;
            SketchVisualizationPoint {
                x: center.x + radius * libm::cos(angle),
                y: center.y + radius * libm::sin(angle),
            }
        })
        .collect()
}

fn sample_circle(center: SketchVisualizationPoint, radius: f64, samples: usize) -> Vec<SketchVisualizationPoint> {
    (0..=samples)
        .map(|index| {
            let angle = TAU * index as f64 / samples.max(1) as f64;
            SketchVisualizationPoint {
                x: center.x + radius * libm::cos(angle),
                y: center.y + radius * libm::sin(angle),
            }
        })
        .collect()
}

fn positive_angle_delta(delta: f64) -> f64 {
    let mut normalized = delta % TAU;
    if normalized < 0.0 {
        normalized += TAU;
    }
    normalized
}

fn sample_control_point_spline(points: &[SketchVisualizationPoint], degree: usize) -> Vec<SketchVisualizationPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let effective_degree = degree.max(1).min(points.len() - 1);
    if effective_degree == 1 {
        return points.to_vec();
    }

    let knots = build_open_uniform_knot_vector(points.len(), effective_degree);
    let span_count = (points.len() - effective_degree).max(1);
    let sample_count = (span_count * SPLINE_SAMPLES_PER_SPAN).max(2);

    (0..=sample_count)
        .map(|index| {
            let u = if index == sample_count {
                1.0
            } else {
                index as f64 / sample_count as f64
            };
            de_boor_point(points, effective_degree, &knots, u)
        })
        .collect()
}

fn build_open_uniform_knot_vector(point_count: usize, degree: usize) -> Vec<f64> {
    let order = degree + 1;
    let knot_count = point_count + order;
    let interior_count = knot_count.saturating_sub(2 * order);
    (0..knot_count)
        .map(|index| {
            if index < order {
                0.0
            } else if index >= knot_count - order {
                1.0
            } else {
                (index - degree) as f64 / (interior_count + 1) as f64
            }
        })
        .collect()
}

fn find_knot_span(u: f64, degree: usize, knots: &[f64]) -> usize {
    let point_count = knots.len() - degree - 1;
    let last_span = point_count - 1;
    if u >= knots[last_span + 1] {
        return last_span;
    }
    if u <= knots[degree] {
        return degree;
    }

    let mut low = degree;
    let mut high = last_span + 1;
    let mut mid = (low + high) / 2;
    while u < knots[mid] || u >= knots[mid + 1] {
        if u < knots[mid] {
            high = mid;
        } else {
            low = mid;
        }
        mid = (low + high) / 2;
    }
    mid
}

fn de_boor_point(
    points: &[SketchVisualizationPoint],
    degree: usize,
    knots: &[f64],
    u: f64,
) -> SketchVisualizationPoint {
    let span = find_knot_span(u, degree, knots);
    let mut d = (0..=degree)
        .map(|offset| points[span - degree + offset])
        .collect::<Vec<_>>();

    for r in 1..=degree {
        for j in (r..=degree).rev() {
            let knot_index = span - degree + j;
            let denom = knots[knot_index + degree - r + 1] - knots[knot_index];
            let alpha = if denom == 0.0 {
                0.0
            } else {
                (u - knots[knot_index]) / denom
            };
            d[j] = SketchVisualizationPoint {
                x: (1.0 - alpha) * d[j - 1].x + alpha * d[j].x,
                y: (1.0 - alpha) * d[j - 1].y + alpha * d[j].y,
            };
        }
    }

    d[degree]
}

fn distance(a: SketchVisualizationPoint, b: SketchVisualizationPoint) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::*;
    use crate::SourceRange;
    use crate::execution::ArtifactId;
    use crate::execution::ExecState;
    use crate::front::Arc;
    use crate::front::ArcCtor;
    use crate::front::Circle;
    use crate::front::CircleCtor;
    use crate::front::Coincident;
    use crate::front::Constraint;
    use crate::front::ControlPointSpline;
    use crate::front::ControlPointSplineCtor;
    use crate::front::Line;
    use crate::front::LineCtor;
    use crate::front::Point;
    use crate::front::PointCtor;
    use crate::front::SegmentCtor;
    use crate::front::Sketch;
    use crate::front::SketchCtor;
    use crate::front::SourceRef;
    use crate::front::{Expr, Plane};
    use crate::frontend::sketch::ConstraintSegment;
    use crate::pretty::NumericSuffix;
    use crate::{ExecutorContext, ExecutorSettings, Program, TypedPath};
    use serde::Deserialize;

    #[test]
    fn dof_is_default_and_id_color_map_is_always_emitted() {
        let outcome = simple_two_line_outcome(false);
        let visualization = outcome
            .visualize_sketch(SketchSelector::First, SketchVisualizationOptions::default())
            .unwrap();

        assert_eq!(visualization.data.color_scheme, SketchVisualizationColorScheme::Dof);
        assert_eq!(visualization.data.id_color_map.len(), 2);
        assert_eq!(
            visualization.data.segments[0].rendered_color,
            dof_color(Some(Freedom::Free), SketchVisualizationTheme::Dark).to_hex_string()
        );
        assert!(visualization.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    }

    #[test]
    fn ids_color_scheme_uses_id_color_map_as_rendered_color() {
        let outcome = simple_two_line_outcome(false);
        let visualization = outcome
            .visualize_sketch(
                SketchSelector::First,
                SketchVisualizationOptions {
                    color_scheme: SketchVisualizationColorScheme::Ids,
                    ..Default::default()
                },
            )
            .unwrap();

        for segment in &visualization.data.segments {
            assert_eq!(
                Some(&segment.rendered_color),
                visualization.data.id_color_map.get(&segment.id)
            );
        }
    }

    #[test]
    fn id_color_map_is_deterministic_across_color_schemes() {
        let outcome = simple_two_line_outcome(false);
        let dof_visualization = outcome
            .visualize_sketch(SketchSelector::First, SketchVisualizationOptions::default())
            .unwrap();
        let ids_visualization = outcome
            .visualize_sketch(
                SketchSelector::First,
                SketchVisualizationOptions {
                    color_scheme: SketchVisualizationColorScheme::Ids,
                    ..Default::default()
                },
            )
            .unwrap();

        assert_eq!(dof_visualization.data.id_color_map, ids_visualization.data.id_color_map);
        assert_eq!(
            ids_visualization.data.id_color_map,
            outcome
                .visualize_sketch(
                    SketchSelector::First,
                    SketchVisualizationOptions {
                        color_scheme: SketchVisualizationColorScheme::Ids,
                        width: 512,
                        height: 512,
                        ..Default::default()
                    },
                )
                .unwrap()
                .data
                .id_color_map
        );
    }

    #[test]
    fn selector_finds_sketch_by_name_and_id() {
        let outcome = simple_two_line_outcome(false);

        let by_name = outcome
            .visualize_sketch(
                SketchSelector::Name("sketch001".to_owned()),
                SketchVisualizationOptions::default(),
            )
            .unwrap();
        let by_id = outcome
            .visualize_sketch(SketchSelector::Id(ObjectId(0)), SketchVisualizationOptions::default())
            .unwrap();

        assert_eq!(by_name.data.sketch.id, 0);
        assert_eq!(by_id.data.sketch.id, 0);

        let missing = outcome
            .visualize_sketch(
                SketchSelector::Name("missing".to_owned()),
                SketchVisualizationOptions::default(),
            )
            .unwrap_err();
        assert!(matches!(
            missing,
            SketchVisualizationError::SketchNameNotFound(name) if name == "missing"
        ));
    }

    #[test]
    fn touching_line_endpoints_are_grouped_into_one_component() {
        let outcome = simple_two_line_outcome(true);
        let visualization = outcome
            .visualize_sketch(SketchSelector::First, SketchVisualizationOptions::default())
            .unwrap();

        assert_eq!(visualization.data.contact_groups.len(), 1);
        assert_eq!(visualization.data.connected_components.len(), 1);
        assert_eq!(visualization.data.open_endpoints.len(), 2);
        assert!(!visualization.data.closedness_hints[0].is_closed);
    }

    #[test]
    fn separated_line_endpoints_remain_in_separate_components() {
        let outcome = simple_two_line_outcome(false);
        let visualization = outcome
            .visualize_sketch(SketchSelector::First, SketchVisualizationOptions::default())
            .unwrap();

        assert!(visualization.data.contact_groups.is_empty());
        assert_eq!(visualization.data.connected_components.len(), 2);
        assert_eq!(visualization.data.open_endpoints.len(), 4);
    }

    #[test]
    fn coincident_constraints_group_points_and_connect_components() {
        let outcome = simple_two_line_outcome_with_constraints(
            false,
            vec![coincident_constraint_object(
                ObjectId(7),
                vec![ObjectId(2), ObjectId(4)],
            )],
        );
        let visualization = outcome
            .visualize_sketch(SketchSelector::First, SketchVisualizationOptions::default())
            .unwrap();

        assert!(visualization.data.contact_groups.is_empty());
        assert_eq!(
            visualization.data.coincident_groups,
            vec![SketchVisualizationCoincidentGroup {
                id: 0,
                point_ids: vec![2, 4],
                includes_origin: false,
            }]
        );
        assert_eq!(visualization.data.connected_components.len(), 1);
        assert_eq!(visualization.data.open_endpoints, vec![1, 5]);
    }

    #[test]
    fn control_polygons_are_controlled_by_top_level_option() {
        let outcome = control_polygon_outcome();
        let hidden = outcome
            .visualize_sketch(SketchSelector::First, SketchVisualizationOptions::default())
            .unwrap();
        let shown = outcome
            .visualize_sketch(
                SketchSelector::First,
                SketchVisualizationOptions {
                    show_control_polygons: true,
                    ..Default::default()
                },
            )
            .unwrap();

        assert_eq!(hidden.data.segments.len(), 1);
        assert_eq!(shown.data.segments.len(), 1);
        assert_ne!(hidden.png, shown.png);
    }

    #[test]
    fn invalid_canvas_returns_error() {
        let outcome = simple_two_line_outcome(false);
        let error = outcome
            .visualize_sketch(
                SketchSelector::First,
                SketchVisualizationOptions {
                    width: 8,
                    height: 8,
                    padding: 8,
                    ..Default::default()
                },
            )
            .unwrap_err();

        assert!(matches!(error, SketchVisualizationError::InvalidCanvas { .. }));
    }

    #[test]
    fn snapshots_data_and_png_for_dof_and_ids_modes() {
        let outcome = snapshot_visualizer_outcome();

        assert_visualization_snapshots(
            "sketch_visualizer_dof",
            &outcome,
            SketchVisualizationOptions {
                width: 240,
                height: 180,
                padding: 20,
                ..Default::default()
            },
        );
        assert_visualization_snapshots(
            "sketch_visualizer_ids_control_polygons",
            &outcome,
            SketchVisualizationOptions {
                width: 240,
                height: 180,
                padding: 20,
                color_scheme: SketchVisualizationColorScheme::Ids,
                show_control_polygons: true,
                ..Default::default()
            },
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn snapshots_kcl_visualizer_manifest_cases() {
        let manifest = sketch_visualizer_snapshot_manifest();

        for case in manifest.cases {
            let input_path = sketch_visualizer_test_root().join(&case.input);
            let outcome = execute_visualizer_kcl(&input_path).await;
            let selector = case
                .sketch
                .as_ref()
                .map(|name| SketchSelector::Name(name.clone()))
                .unwrap_or(SketchSelector::First);

            for snapshot in &case.visualizations {
                let visualization = outcome
                    .visualize_sketch(selector.clone(), snapshot.options())
                    .unwrap_or_else(|err| {
                        panic!(
                            "failed to visualize sketch for case `{}` snapshot `{}`: {err:?}",
                            case.name, snapshot.name
                        )
                    });

                assert_kcl_visualization_snapshots(&case.name, &snapshot.name, &visualization);
            }
        }
    }

    fn assert_visualization_snapshots(name: &str, outcome: &ExecOutcome, options: SketchVisualizationOptions) {
        let visualization = outcome.visualize_sketch(SketchSelector::First, options).unwrap();
        let mut settings = insta::Settings::clone_current();
        settings.set_omit_expression(true);
        settings.set_sort_maps(true);
        settings.bind(|| {
            insta::assert_json_snapshot!(format!("{name}_data"), visualization.data);
        });

        let image = image::load_from_memory(&visualization.png).unwrap();
        twenty_twenty::assert_image(
            Path::new("src")
                .join("tooling")
                .join("snapshots")
                .join(format!("{name}.png")),
            &image,
            1.0,
        );
    }

    fn assert_kcl_visualization_snapshots(case_name: &str, snapshot_name: &str, visualization: &SketchVisualization) {
        let output_dir = sketch_visualizer_test_root().join(case_name);
        std::fs::create_dir_all(&output_dir)
            .unwrap_or_else(|err| panic!("failed to create `{}`: {err}", output_dir.display()));
        let mut settings = insta::Settings::clone_current();
        settings.set_omit_expression(true);
        settings.set_prepend_module_to_snapshot(false);
        settings.set_sort_maps(true);
        settings.set_snapshot_path(Path::new("..").join("..").join(&output_dir));
        settings.bind(|| {
            insta::assert_json_snapshot!(format!("{snapshot_name}_data"), visualization.data);
        });

        let image = image::load_from_memory(&visualization.png).unwrap();
        twenty_twenty::assert_image(output_dir.join(format!("{snapshot_name}.png")), &image, 1.0);
    }

    async fn execute_visualizer_kcl(input_path: &Path) -> ExecOutcome {
        let source = std::fs::read_to_string(input_path)
            .unwrap_or_else(|err| panic!("failed to read `{}`: {err}", input_path.display()));
        let program = Program::parse_no_errs(&source)
            .unwrap_or_else(|err| panic!("failed to parse `{}`: {err:?}", input_path.display()));
        let mut settings = ExecutorSettings::default();
        settings.with_current_file(TypedPath(input_path.to_path_buf()));
        settings.project_directory = input_path.parent().map(|path| TypedPath(path.to_path_buf()));
        let ctx = ExecutorContext::new_mock(Some(settings)).await;
        let mut exec_state = ExecState::new(&ctx);
        let (env_ref, _) = ctx
            .run(&program, &mut exec_state)
            .await
            .unwrap_or_else(|err| panic!("failed to execute `{}`: {err:?}", input_path.display()));
        let outcome = exec_state
            .into_exec_outcome(env_ref, &ctx)
            .await
            .unwrap_or_else(|err| panic!("failed to build exec outcome for `{}`: {err:?}", input_path.display()));
        ctx.close().await;
        outcome
    }

    fn sketch_visualizer_snapshot_manifest() -> SketchVisualizerSnapshotManifest {
        let manifest_path = sketch_visualizer_test_root().join("manifest.toml");
        let contents = std::fs::read_to_string(&manifest_path)
            .unwrap_or_else(|err| panic!("failed to read `{}`: {err}", manifest_path.display()));
        toml::from_str(&contents).unwrap_or_else(|err| panic!("failed to parse `{}`: {err}", manifest_path.display()))
    }

    fn sketch_visualizer_test_root() -> PathBuf {
        Path::new("tests").join("sketch_visualizer")
    }

    #[derive(Debug, Deserialize)]
    struct SketchVisualizerSnapshotManifest {
        cases: Vec<SketchVisualizerSnapshotCase>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "kebab-case")]
    struct SketchVisualizerSnapshotCase {
        name: String,
        input: PathBuf,
        sketch: Option<String>,
        visualizations: Vec<SketchVisualizerSnapshot>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "kebab-case")]
    struct SketchVisualizerSnapshot {
        name: String,
        #[serde(default)]
        color_scheme: SketchVisualizationColorScheme,
        #[serde(default)]
        show_control_polygons: bool,
        theme: Option<SketchVisualizationTheme>,
        width: Option<u32>,
        height: Option<u32>,
        padding: Option<u32>,
        contact_tolerance: Option<f64>,
    }

    impl SketchVisualizerSnapshot {
        fn options(&self) -> SketchVisualizationOptions {
            let default_options = SketchVisualizationOptions::default();

            SketchVisualizationOptions {
                width: self.width.unwrap_or(default_options.width),
                height: self.height.unwrap_or(default_options.height),
                padding: self.padding.unwrap_or(default_options.padding),
                theme: self.theme.unwrap_or(default_options.theme),
                contact_tolerance: self.contact_tolerance.unwrap_or(default_options.contact_tolerance),
                color_scheme: self.color_scheme,
                show_control_polygons: self.show_control_polygons,
            }
        }
    }

    fn simple_two_line_outcome(touching: bool) -> ExecOutcome {
        simple_two_line_outcome_with_constraints(touching, Vec::new())
    }

    fn simple_two_line_outcome_with_constraints(touching: bool, constraints: Vec<Object>) -> ExecOutcome {
        let sketch_id = ObjectId(0);
        let line1_id = ObjectId(3);
        let line2_id = ObjectId(6);
        let p1 = ObjectId(1);
        let p2 = ObjectId(2);
        let p3 = ObjectId(4);
        let p4 = ObjectId(5);
        let p3_x = if touching { 10.0 } else { 20.0 };
        let constraint_ids = constraints.iter().map(|constraint| constraint.id).collect::<Vec<_>>();

        let mut scene_objects = vec![
            sketch_object_with_constraints(sketch_id, vec![p1, p2, line1_id, p3, p4, line2_id], constraint_ids),
            point_object(p1, 0.0, 0.0, Some(line1_id), Freedom::Fixed),
            point_object(p2, 10.0, 0.0, Some(line1_id), Freedom::Free),
            line_object(line1_id, p1, p2),
            point_object(p3, p3_x, 0.0, Some(line2_id), Freedom::Free),
            point_object(p4, 30.0, 0.0, Some(line2_id), Freedom::Free),
            line_object(line2_id, p3, p4),
        ];
        scene_objects.extend(constraints);
        test_outcome(scene_objects)
    }

    fn control_polygon_outcome() -> ExecOutcome {
        let sketch_id = ObjectId(0);
        let primary_line_id = ObjectId(3);
        let helper_line_id = ObjectId(6);
        let p1 = ObjectId(1);
        let p2 = ObjectId(2);
        let c1 = ObjectId(4);
        let c2 = ObjectId(5);

        test_outcome(vec![
            sketch_object(sketch_id, vec![p1, p2, primary_line_id, c1, c2, helper_line_id]),
            point_object(p1, 0.0, 0.0, Some(primary_line_id), Freedom::Free),
            point_object(p2, 10.0, 0.0, Some(primary_line_id), Freedom::Free),
            line_object(primary_line_id, p1, p2),
            point_object(c1, 0.0, 8.0, Some(primary_line_id), Freedom::Free),
            point_object(c2, 10.0, 8.0, Some(primary_line_id), Freedom::Free),
            line_object_with_owner(helper_line_id, c1, c2, Some(primary_line_id)),
        ])
    }

    fn snapshot_visualizer_outcome() -> ExecOutcome {
        let sketch_id = ObjectId(0);
        let line_id = ObjectId(3);
        let arc_id = ObjectId(7);
        let circle_id = ObjectId(10);
        let spline_id = ObjectId(15);
        let helper1_id = ObjectId(16);
        let helper2_id = ObjectId(17);
        let helper3_id = ObjectId(18);

        let l1 = ObjectId(1);
        let l2 = ObjectId(2);
        let a1 = ObjectId(4);
        let a2 = ObjectId(5);
        let ac = ObjectId(6);
        let c1 = ObjectId(8);
        let cc = ObjectId(9);
        let s1 = ObjectId(11);
        let s2 = ObjectId(12);
        let s3 = ObjectId(13);
        let s4 = ObjectId(14);

        test_outcome(vec![
            sketch_object(
                sketch_id,
                vec![
                    l1, l2, line_id, a1, a2, ac, arc_id, c1, cc, circle_id, s1, s2, s3, s4, spline_id, helper1_id,
                    helper2_id, helper3_id,
                ],
            ),
            point_object(l1, 0.0, 0.0, Some(line_id), Freedom::Free),
            point_object(l2, 36.0, 0.0, Some(line_id), Freedom::Free),
            line_object(line_id, l1, l2),
            point_object(a1, 0.0, 24.0, Some(arc_id), Freedom::Free),
            point_object(a2, 24.0, 0.0, Some(arc_id), Freedom::Conflict),
            point_object(ac, 0.0, 0.0, Some(arc_id), Freedom::Fixed),
            arc_object(arc_id, a1, a2, ac, ArcDirection::Ccw),
            point_object(c1, 46.0, 16.0, Some(circle_id), Freedom::Fixed),
            point_object(cc, 36.0, 16.0, Some(circle_id), Freedom::Fixed),
            circle_object(circle_id, c1, cc),
            point_object(s1, 4.0, -28.0, Some(spline_id), Freedom::Free),
            point_object(s2, 16.0, -8.0, Some(spline_id), Freedom::Free),
            point_object(s3, 28.0, -30.0, Some(spline_id), Freedom::Free),
            point_object(s4, 44.0, -10.0, Some(spline_id), Freedom::Free),
            control_point_spline_object(spline_id, vec![s1, s2, s3, s4], 3),
            line_object_with_owner(helper1_id, s1, s2, Some(spline_id)),
            line_object_with_owner(helper2_id, s2, s3, Some(spline_id)),
            line_object_with_owner(helper3_id, s3, s4, Some(spline_id)),
        ])
    }

    fn test_outcome(scene_objects: Vec<Object>) -> ExecOutcome {
        ExecOutcome {
            variables: Default::default(),
            operations: Default::default(),
            artifact_graph: Default::default(),
            scene_objects,
            source_range_to_object: Default::default(),
            var_solutions: Default::default(),
            refactor_metadata: Default::default(),
            issues: Default::default(),
            filenames: Default::default(),
            default_planes: None,
        }
    }

    fn sketch_object(id: ObjectId, segments: Vec<ObjectId>) -> Object {
        sketch_object_with_constraints(id, segments, Vec::new())
    }

    fn sketch_object_with_constraints(id: ObjectId, segments: Vec<ObjectId>, constraints: Vec<ObjectId>) -> Object {
        Object {
            id,
            kind: ObjectKind::Sketch(Sketch {
                args: SketchCtor {
                    on: Plane::Default(crate::engine::PlaneName::Xy),
                },
                plane: ObjectId(999),
                segments,
                constraints,
            }),
            label: "sketch001".to_owned(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn point_object(id: ObjectId, x: f64, y: f64, owner: Option<ObjectId>, freedom: Freedom) -> Object {
        Object {
            id,
            kind: ObjectKind::Segment {
                segment: Segment::Point(Point {
                    position: point(x, y),
                    ctor: owner.is_none().then(|| PointCtor {
                        position: Point2d {
                            x: Expr::Number(number(x)),
                            y: Expr::Number(number(y)),
                        },
                    }),
                    owner,
                    freedom,
                    constraints: Vec::new(),
                }),
            },
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn line_object(id: ObjectId, start: ObjectId, end: ObjectId) -> Object {
        line_object_with_owner(id, start, end, None)
    }

    fn line_object_with_owner(id: ObjectId, start: ObjectId, end: ObjectId, owner: Option<ObjectId>) -> Object {
        Object {
            id,
            kind: ObjectKind::Segment {
                segment: Segment::Line(Line {
                    start,
                    end,
                    owner,
                    ctor: SegmentCtor::Line(LineCtor {
                        start: Point2d {
                            x: Expr::Number(number(0.0)),
                            y: Expr::Number(number(0.0)),
                        },
                        end: Point2d {
                            x: Expr::Number(number(1.0)),
                            y: Expr::Number(number(1.0)),
                        },
                        construction: None,
                    }),
                    ctor_applicable: true,
                    construction: false,
                }),
            },
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn arc_object(id: ObjectId, start: ObjectId, end: ObjectId, center: ObjectId, direction: ArcDirection) -> Object {
        Object {
            id,
            kind: ObjectKind::Segment {
                segment: Segment::Arc(Arc {
                    start,
                    end,
                    center,
                    ctor: SegmentCtor::Arc(ArcCtor {
                        start: expr_point(0.0, 0.0),
                        end: expr_point(1.0, 1.0),
                        center: expr_point(0.0, 1.0),
                        direction: Some(direction),
                        construction: None,
                    }),
                    ctor_applicable: true,
                    construction: false,
                    direction,
                }),
            },
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn circle_object(id: ObjectId, start: ObjectId, center: ObjectId) -> Object {
        Object {
            id,
            kind: ObjectKind::Segment {
                segment: Segment::Circle(Circle {
                    start,
                    center,
                    ctor: SegmentCtor::Circle(CircleCtor {
                        start: expr_point(1.0, 0.0),
                        center: expr_point(0.0, 0.0),
                        construction: None,
                    }),
                    ctor_applicable: true,
                    construction: false,
                }),
            },
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn control_point_spline_object(id: ObjectId, controls: Vec<ObjectId>, degree: u32) -> Object {
        Object {
            id,
            kind: ObjectKind::Segment {
                segment: Segment::ControlPointSpline(ControlPointSpline {
                    controls,
                    degree,
                    ctor: SegmentCtor::ControlPointSpline(ControlPointSplineCtor {
                        points: vec![
                            expr_point(0.0, 0.0),
                            expr_point(1.0, 1.0),
                            expr_point(2.0, 0.0),
                            expr_point(3.0, 1.0),
                        ],
                        construction: None,
                    }),
                    ctor_applicable: true,
                    construction: false,
                }),
            },
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn coincident_constraint_object(id: ObjectId, point_ids: Vec<ObjectId>) -> Object {
        Object {
            id,
            kind: ObjectKind::Constraint {
                constraint: Constraint::Coincident(Coincident {
                    segments: point_ids.into_iter().map(ConstraintSegment::Segment).collect(),
                }),
            },
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn expr_point(x: f64, y: f64) -> Point2d<Expr> {
        Point2d {
            x: Expr::Number(number(x)),
            y: Expr::Number(number(y)),
        }
    }

    fn point(x: f64, y: f64) -> Point2d<Number> {
        Point2d {
            x: number(x),
            y: number(y),
        }
    }

    fn number(value: f64) -> Number {
        Number {
            value,
            units: NumericSuffix::None,
        }
    }
}
