use std::collections::HashMap;

use serde::Deserialize;
use serde::Serialize;

use crate::Program;
use crate::SourceRange;
use crate::execution::ArtifactId;
use crate::fmt::format_number_literal;
use crate::front::Error;
use crate::front::Result;
use crate::frontend::api::Number;
use crate::frontend::api::Object;
use crate::frontend::api::ObjectId;
use crate::frontend::api::ObjectKind;
use crate::frontend::api::SceneGraph;
use crate::frontend::api::SourceRef;
use crate::frontend::sketch::Angle;
use crate::frontend::sketch::Arc;
use crate::frontend::sketch::Circle;
use crate::frontend::sketch::Coincident;
use crate::frontend::sketch::Constraint;
use crate::frontend::sketch::ConstraintSegment;
use crate::frontend::sketch::ControlPointSpline;
use crate::frontend::sketch::Diameter;
use crate::frontend::sketch::Distance;
use crate::frontend::sketch::EqualRadius;
use crate::frontend::sketch::Fixed;
use crate::frontend::sketch::Horizontal;
use crate::frontend::sketch::Line;
use crate::frontend::sketch::LinesEqualLength;
use crate::frontend::sketch::Midpoint;
use crate::frontend::sketch::Parallel;
use crate::frontend::sketch::Perpendicular;
use crate::frontend::sketch::Point;
use crate::frontend::sketch::Point2d;
use crate::frontend::sketch::Radius;
use crate::frontend::sketch::Segment;
use crate::frontend::sketch::Symmetric;
use crate::frontend::sketch::Tangent;
use crate::frontend::sketch::Vertical;
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::Expr;
use crate::pretty::NumericSuffix;

const DEFAULT_PADDING: f64 = 0.0;
const DEFAULT_STROKE_WIDTH: f64 = 2.0;
const DEFAULT_POINT_RADIUS: f64 = 3.0;
const DEFAULT_SPLINE_SAMPLES_PER_SPAN: usize = 24;
const EPSILON: f64 = 1e-12;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", optional_fields)]
#[serde(default, rename_all = "camelCase")]
pub struct SketchSvgOptions {
    pub sketch_id: Option<ObjectId>,
    pub padding: f64,
    pub stroke_width: f64,
    pub point_radius: f64,
    pub include_points: bool,
    pub include_control_polygon: bool,
    pub include_constraints: bool,
    pub include_metadata: bool,
    pub mode: SketchSvgMode,
}

impl Default for SketchSvgOptions {
    fn default() -> Self {
        Self {
            sketch_id: None,
            padding: DEFAULT_PADDING,
            stroke_width: DEFAULT_STROKE_WIDTH,
            point_radius: DEFAULT_POINT_RADIUS,
            include_points: false,
            include_control_polygon: true,
            include_constraints: true,
            include_metadata: true,
            mode: SketchSvgMode::Agent,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub enum SketchSvgMode {
    Drawing,
    #[default]
    Agent,
    Constraints,
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchSvgExport {
    pub sketch_id: ObjectId,
    pub view_box: SketchSvgViewBox,
    pub bounds: SketchSvgBounds,
    pub quality: SketchSvgQuality,
    pub svg: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchSvgViewBox {
    pub min_x: f64,
    pub min_y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchSvgBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchSvgQuality {
    pub score: f64,
    pub total_constraints: usize,
    pub visible_constraints: usize,
    pub hidden_constraints: usize,
    pub annotation_count: usize,
    pub text_overlap_count: usize,
    pub labels_inside_geometry_count: usize,
    pub warnings: Vec<String>,
}

pub fn sketch_id_for_variable_name(
    program: &Program,
    scene_graph: &SceneGraph,
    variable_name: &str,
) -> Result<ObjectId> {
    let sketch_block_range = sketch_block_range_for_variable_name(program, variable_name)?;
    scene_graph
        .objects
        .iter()
        .find_map(|object| {
            let is_sketch = matches!(object.kind, ObjectKind::Sketch(_));
            (is_sketch && source_ref_matches_range(&object.source, sketch_block_range)).then_some(object.id)
        })
        .ok_or_else(|| Error {
            msg: format!(
                "Could not find a solved frontend sketch object for variable `{variable_name}`. \
                 The variable was parsed as a sketch block, but execution did not produce matching sketch SVG data."
            ),
        })
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Coords2d {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl Bounds {
    fn new(point: Coords2d) -> Self {
        Self {
            min_x: point.x,
            min_y: point.y,
            max_x: point.x,
            max_y: point.y,
        }
    }

    fn include_point(&mut self, point: Coords2d) {
        self.min_x = libm::fmin(self.min_x, point.x);
        self.min_y = libm::fmin(self.min_y, point.y);
        self.max_x = libm::fmax(self.max_x, point.x);
        self.max_y = libm::fmax(self.max_y, point.y);
    }

    fn include_circle(&mut self, center: Coords2d, radius: f64) {
        self.include_point(Coords2d {
            x: center.x - radius,
            y: center.y - radius,
        });
        self.include_point(Coords2d {
            x: center.x + radius,
            y: center.y + radius,
        });
    }

    fn expand(self, padding: f64) -> Self {
        let padding = libm::fmax(padding, 0.0);
        Self {
            min_x: self.min_x - padding,
            min_y: self.min_y - padding,
            max_x: self.max_x + padding,
            max_y: self.max_y + padding,
        }
    }

    fn width(self) -> f64 {
        let width = self.max_x - self.min_x;
        if width.abs() <= EPSILON { 1.0 } else { width }
    }

    fn height(self) -> f64 {
        let height = self.max_y - self.min_y;
        if height.abs() <= EPSILON { 1.0 } else { height }
    }

    fn center(self) -> Coords2d {
        Coords2d {
            x: (self.min_x + self.max_x) / 2.0,
            y: (self.min_y + self.max_y) / 2.0,
        }
    }

    fn contains_point(self, point: Coords2d) -> bool {
        point.x >= self.min_x && point.x <= self.max_x && point.y >= self.min_y && point.y <= self.max_y
    }
}

#[derive(Clone, Copy)]
struct ConstraintSvgStyle {
    child_dash: f64,
    dimension_offset: f64,
    font_size: f64,
    marker_radius: f64,
    coincident_radius: f64,
    bounds_padding: f64,
    dimension_lane_gap: f64,
    extension_gap: f64,
    extension_overshoot: f64,
    arrow_size: f64,
    layout_gap: f64,
    text_halo: f64,
    text_offset: f64,
    tick_size: f64,
    right_angle_size: f64,
    witness_length: f64,
    max_witness_length: f64,
}

impl ConstraintSvgStyle {
    fn from_bounds(bounds: Option<Bounds>) -> Self {
        let extent = libm::fmax(
            bounds
                .map(|bounds| libm::fmax(bounds.width(), bounds.height()))
                .unwrap_or(1.0),
            EPSILON,
        );
        let unit = extent / 120.0;
        Self {
            child_dash: unit * 1.4,
            dimension_offset: unit * 10.5,
            font_size: unit * 3.1,
            marker_radius: unit * 2.4,
            coincident_radius: unit * 0.45,
            bounds_padding: unit * 7.0,
            dimension_lane_gap: unit * 7.5,
            extension_gap: unit * 1.0,
            extension_overshoot: unit * 1.2,
            arrow_size: unit * 1.4,
            layout_gap: unit * 0.9,
            text_halo: unit * 0.45,
            text_offset: unit * 3.9,
            tick_size: unit * 1.8,
            right_angle_size: unit * 3.0,
            witness_length: unit * 3.5,
            max_witness_length: unit * 18.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl Rect {
    fn around(center: Coords2d, half_width: f64, half_height: f64) -> Self {
        Self {
            min_x: center.x - half_width,
            min_y: center.y - half_height,
            max_x: center.x + half_width,
            max_y: center.y + half_height,
        }
    }

    fn expand(self, amount: f64) -> Self {
        Self {
            min_x: self.min_x - amount,
            min_y: self.min_y - amount,
            max_x: self.max_x + amount,
            max_y: self.max_y + amount,
        }
    }

    fn intersects(self, other: Self) -> bool {
        self.min_x <= other.max_x && self.max_x >= other.min_x && self.min_y <= other.max_y && self.max_y >= other.min_y
    }

    fn center(self) -> Coords2d {
        Coords2d {
            x: (self.min_x + self.max_x) / 2.0,
            y: (self.min_y + self.max_y) / 2.0,
        }
    }
}

#[derive(Default)]
struct ConstraintLayout {
    occupied: Vec<Rect>,
    symbol_rects: Vec<Rect>,
    text_rects: Vec<Rect>,
    dimension_lanes: Vec<DimensionLane>,
}

#[derive(Clone, Copy, Debug)]
struct DimensionLane {
    side: DimensionSide,
    lane: usize,
    min: f64,
    max: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DimensionSide {
    Top,
    Bottom,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ConstraintLayer {
    DrawingDimension,
    SolverConstraint,
}

struct RenderedConstraint {
    svg: String,
    layer: ConstraintLayer,
}

#[derive(Default)]
struct ConstraintCounts {
    total: usize,
    visible: usize,
    hidden: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SketchSvgMetadata<'a> {
    schema_version: u8,
    sketch_id: ObjectId,
    mode: SketchSvgMode,
    view_box: SketchSvgViewBox,
    bounds: SketchSvgBounds,
    quality: &'a SketchSvgQuality,
    layers: [&'static str; 5],
}

impl ConstraintLayout {
    fn place_symbol(&mut self, preferred: Coords2d, style: ConstraintSvgStyle) -> Coords2d {
        let half_size = symbol_size(style) / 2.0;
        let anchor = self.place(preferred, style, |center| Rect::around(center, half_size, half_size));
        self.symbol_rects
            .push(Rect::around(anchor, half_size, half_size).expand(style.layout_gap));
        anchor
    }

    fn place_marker(&mut self, preferred: Coords2d, label: &str, style: ConstraintSvgStyle) -> Coords2d {
        let half_width = marker_width(label, style) / 2.0;
        let half_height = marker_height(style) / 2.0;
        let anchor = self.place(preferred, style, |center| Rect::around(center, half_width, half_height));
        self.symbol_rects
            .push(Rect::around(anchor, half_width, half_height).expand(style.layout_gap));
        self.text_rects.push(
            Rect::around(anchor, text_width(label, style) / 2.0, text_height(style) / 2.0).expand(style.layout_gap),
        );
        anchor
    }

    fn place_text(&mut self, preferred: Coords2d, label: &str, style: ConstraintSvgStyle) -> Coords2d {
        let half_width = text_width(label, style) / 2.0;
        let half_height = text_height(style) / 2.0;
        let anchor = self.place(preferred, style, |center| Rect::around(center, half_width, half_height));
        self.text_rects
            .push(Rect::around(anchor, half_width, half_height).expand(style.layout_gap));
        anchor
    }

    fn reserve_text(&mut self, anchor: Coords2d, label: &str, style: ConstraintSvgStyle) {
        let rect =
            Rect::around(anchor, text_width(label, style) / 2.0, text_height(style) / 2.0).expand(style.layout_gap);
        self.occupied.push(rect);
        self.text_rects.push(rect);
    }

    fn place<F>(&mut self, preferred: Coords2d, style: ConstraintSvgStyle, rect_for: F) -> Coords2d
    where
        F: Fn(Coords2d) -> Rect,
    {
        let step = libm::fmax(style.font_size + style.layout_gap, EPSILON);
        for ring in 0..=3 {
            for offset in placement_offsets(ring, step) {
                let candidate = add(preferred, offset);
                let rect = rect_for(candidate).expand(style.layout_gap);
                if !self.occupied.iter().any(|existing| rect.intersects(*existing)) {
                    self.occupied.push(rect);
                    return candidate;
                }
            }
        }

        let rect = rect_for(preferred).expand(style.layout_gap);
        self.occupied.push(rect);
        preferred
    }

    fn allocate_dimension_lane(
        &mut self,
        side: DimensionSide,
        mut min: f64,
        mut max: f64,
        style: ConstraintSvgStyle,
    ) -> usize {
        if min > max {
            std::mem::swap(&mut min, &mut max);
        }
        min -= style.font_size;
        max += style.font_size;

        for lane in 0..16 {
            let intersects_existing = self.dimension_lanes.iter().any(|existing| {
                existing.side == side && existing.lane == lane && min <= existing.max && max >= existing.min
            });
            if !intersects_existing {
                self.dimension_lanes.push(DimensionLane { side, lane, min, max });
                return lane;
            }
        }

        self.dimension_lanes.push(DimensionLane {
            side,
            lane: 0,
            min,
            max,
        });
        0
    }

    fn text_overlap_count(&self) -> usize {
        let mut count = 0;
        for (index, rect) in self.text_rects.iter().enumerate() {
            for other in self.text_rects.iter().skip(index + 1) {
                if rect.intersects(*other) {
                    count += 1;
                }
            }
        }
        count
    }

    fn labels_inside_geometry_count(&self, geometry_bounds: Option<Bounds>) -> usize {
        let Some(bounds) = geometry_bounds else {
            return 0;
        };
        self.text_rects
            .iter()
            .filter(|rect| bounds.contains_point(rect.center()))
            .count()
    }
}

fn placement_offsets(ring: usize, step: f64) -> Vec<Coords2d> {
    if ring == 0 {
        return vec![Coords2d { x: 0.0, y: 0.0 }];
    }

    let distance = ring as f64 * step;
    vec![
        Coords2d { x: 0.0, y: distance },
        Coords2d { x: distance, y: 0.0 },
        Coords2d { x: 0.0, y: -distance },
        Coords2d { x: -distance, y: 0.0 },
        Coords2d {
            x: distance,
            y: distance,
        },
        Coords2d {
            x: distance,
            y: -distance,
        },
        Coords2d {
            x: -distance,
            y: distance,
        },
        Coords2d {
            x: -distance,
            y: -distance,
        },
    ]
}

fn marker_width(label: &str, style: ConstraintSvgStyle) -> f64 {
    libm::fmax(
        style.marker_radius * 2.0,
        text_width(label, style) + style.layout_gap * 2.0,
    )
}

fn marker_height(style: ConstraintSvgStyle) -> f64 {
    libm::fmax(style.marker_radius * 2.0, text_height(style) + style.layout_gap)
}

fn symbol_size(style: ConstraintSvgStyle) -> f64 {
    style.marker_radius * 1.8
}

fn text_width(label: &str, style: ConstraintSvgStyle) -> f64 {
    let character_count = label.chars().count().max(1) as f64;
    style.font_size * (character_count * 0.58 + 0.2)
}

fn text_height(style: ConstraintSvgStyle) -> f64 {
    style.font_size * 1.12
}

fn mode_class(mode: SketchSvgMode) -> &'static str {
    match mode {
        SketchSvgMode::Drawing => "sketch-svg-mode-drawing",
        SketchSvgMode::Agent => "sketch-svg-mode-agent",
        SketchSvgMode::Constraints => "sketch-svg-mode-constraints",
    }
}

fn visible_constraint_layer(mode: SketchSvgMode, layer: ConstraintLayer) -> bool {
    match mode {
        SketchSvgMode::Drawing | SketchSvgMode::Agent => layer == ConstraintLayer::DrawingDimension,
        SketchSvgMode::Constraints => true,
    }
}

fn layer_name(layer: ConstraintLayer) -> &'static str {
    match layer {
        ConstraintLayer::DrawingDimension => "drawing-dimensions",
        ConstraintLayer::SolverConstraint => "solver-constraints",
    }
}

fn sketch_block_range_for_variable_name(program: &Program, variable_name: &str) -> Result<SourceRange> {
    let mut sketch_variables = Vec::new();
    for item in &program.ast.body {
        let BodyItem::VariableDeclaration(variable_declaration) = item else {
            continue;
        };
        let name = &variable_declaration.declaration.id.name;
        if matches!(variable_declaration.declaration.init, Expr::SketchBlock(_)) {
            sketch_variables.push(name.as_str());
        }
        if name != variable_name {
            continue;
        }

        return match &variable_declaration.declaration.init {
            Expr::SketchBlock(sketch_block) => Ok(SourceRange::from(sketch_block.as_ref())),
            _ => Err(Error {
                msg: format!(
                    "Variable `{variable_name}` is not a `sketch(...) {{ ... }}` block. \
                     Sketch SVG export by variable name currently supports frontend sketch-block variables."
                ),
            }),
        };
    }

    let available = if sketch_variables.is_empty() {
        "none".to_owned()
    } else {
        sketch_variables.join(", ")
    };
    Err(Error {
        msg: format!("No sketch variable named `{variable_name}` found. Available sketch variables: {available}."),
    })
}

fn source_ref_matches_range(source: &SourceRef, range: SourceRange) -> bool {
    match source {
        SourceRef::Simple {
            range: source_range, ..
        } => *source_range == range,
        SourceRef::BackTrace { ranges } => ranges.iter().any(|(source_range, _)| *source_range == range),
    }
}

fn build_quality_report(
    layout: &ConstraintLayout,
    geometry_bounds: Option<Bounds>,
    counts: ConstraintCounts,
) -> SketchSvgQuality {
    let annotation_count = layout.text_rects.len() + layout.symbol_rects.len();
    let text_overlap_count = layout.text_overlap_count();
    let labels_inside_geometry_count = layout.labels_inside_geometry_count(geometry_bounds);
    let mut warnings = Vec::new();
    if text_overlap_count > 0 {
        warnings.push(format!("{text_overlap_count} annotation text overlap(s) detected"));
    }
    if labels_inside_geometry_count > 0 {
        warnings.push(format!(
            "{labels_inside_geometry_count} annotation label(s) fall inside the sketch geometry bounds"
        ));
    }
    if annotation_count > 80 {
        warnings.push(format!(
            "{annotation_count} visible annotation items; consider inspecting the constraint layer separately"
        ));
    }
    let score = (100.0
        - text_overlap_count as f64 * 8.0
        - labels_inside_geometry_count as f64 * 3.0
        - annotation_count.saturating_sub(80) as f64 * 0.4)
        .clamp(0.0, 100.0);

    SketchSvgQuality {
        score: round_float(score),
        total_constraints: counts.total,
        visible_constraints: counts.visible,
        hidden_constraints: counts.hidden,
        annotation_count,
        text_overlap_count,
        labels_inside_geometry_count,
        warnings,
    }
}

pub fn export_sketch_svg(scene_graph: &SceneGraph, options: SketchSvgOptions) -> Result<SketchSvgExport> {
    let object_lookup: HashMap<ObjectId, &Object> =
        scene_graph.objects.iter().map(|object| (object.id, object)).collect();
    let sketch_id = select_sketch_id(scene_graph, &object_lookup, options.sketch_id)?;
    let sketch_object = object_lookup.get(&sketch_id).copied().ok_or_else(|| Error {
        msg: format!("Sketch object not found: {sketch_id:?}"),
    })?;
    let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
        return Err(Error {
            msg: format!("Object is not a sketch: {sketch_id:?}"),
        });
    };

    let mut model_geometry = Vec::new();
    let mut construction_geometry = Vec::new();
    let mut point_geometry = Vec::new();
    let mut drawing_dimensions = Vec::new();
    let mut solver_constraints = Vec::new();
    let mut constraint_counts = ConstraintCounts::default();
    let mut constraint_layout = ConstraintLayout::default();
    let mut bounds = None;

    for segment_id in &sketch.segments {
        let Some(segment_object) = object_lookup.get(segment_id).copied() else {
            return Err(Error {
                msg: format!("Sketch references missing segment: {segment_id:?}"),
            });
        };
        let ObjectKind::Segment { segment } = &segment_object.kind else {
            continue;
        };

        match segment {
            Segment::Point(point) => {
                if options.include_points {
                    let position = coords_from_point(&point.position);
                    include_bounds_point(&mut bounds, position);
                    point_geometry.push(svg_point(segment_object, point, options.point_radius));
                }
            }
            Segment::Line(line) => {
                if line.owner.is_some() && !options.include_control_polygon {
                    continue;
                }
                let start = point_coords(&object_lookup, line.start)?;
                let end = point_coords(&object_lookup, line.end)?;
                include_bounds_point(&mut bounds, start);
                include_bounds_point(&mut bounds, end);
                let svg = svg_line(segment_object, line, start, end);
                if line.construction || line.owner.is_some() {
                    construction_geometry.push(svg);
                } else {
                    model_geometry.push(svg);
                }
            }
            Segment::Arc(arc) => {
                let start = point_coords(&object_lookup, arc.start)?;
                let end = point_coords(&object_lookup, arc.end)?;
                let center = point_coords(&object_lookup, arc.center)?;
                let radius = average_radius(center, start, end);
                include_arc_bounds(&mut bounds, center, radius, start, end);
                let svg = svg_arc(segment_object, arc, start, end, center, radius);
                if arc.construction {
                    construction_geometry.push(svg);
                } else {
                    model_geometry.push(svg);
                }
            }
            Segment::Circle(circle) => {
                let start = point_coords(&object_lookup, circle.start)?;
                let center = point_coords(&object_lookup, circle.center)?;
                let radius = distance(center, start);
                include_bounds_circle(&mut bounds, center, radius);
                let svg = svg_circle(segment_object, circle, center, radius);
                if circle.construction {
                    construction_geometry.push(svg);
                } else {
                    model_geometry.push(svg);
                }
            }
            Segment::ControlPointSpline(spline) => {
                let controls = spline
                    .controls
                    .iter()
                    .map(|id| point_coords(&object_lookup, *id))
                    .collect::<Result<Vec<_>>>()?;
                if controls.is_empty() {
                    continue;
                }
                let sampled = sample_control_point_spline(
                    &controls,
                    spline.degree.min(controls.len().saturating_sub(1) as u32) as usize,
                    DEFAULT_SPLINE_SAMPLES_PER_SPAN,
                );
                for point in sampled.iter().chain(controls.iter()) {
                    include_bounds_point(&mut bounds, *point);
                }
                let svg = svg_spline(segment_object, spline, &sampled);
                if spline.construction {
                    construction_geometry.push(svg);
                } else {
                    model_geometry.push(svg);
                }
            }
        }
    }

    let geometry_bounds = bounds;
    if options.include_constraints {
        let constraint_style = ConstraintSvgStyle::from_bounds(bounds);
        let sketch_bounds = bounds;
        for constraint_id in &sketch.constraints {
            let Some(constraint_object) = object_lookup.get(constraint_id).copied() else {
                return Err(Error {
                    msg: format!("Sketch references missing constraint: {constraint_id:?}"),
                });
            };
            let ObjectKind::Constraint { constraint } = &constraint_object.kind else {
                continue;
            };
            let (_, layer) = constraint_kind_layer(constraint);
            let is_visible = visible_constraint_layer(options.mode, layer);
            let mut hidden_layout = ConstraintLayout::default();
            let target_layout = if is_visible {
                &mut constraint_layout
            } else {
                &mut hidden_layout
            };
            let mut constraint_bounds = bounds;
            if let Some(svg) = svg_constraint(
                constraint_object,
                constraint,
                &object_lookup,
                &mut constraint_bounds,
                sketch_bounds,
                target_layout,
                constraint_style,
            )? {
                constraint_counts.total += 1;
                if is_visible {
                    constraint_counts.visible += 1;
                    bounds = constraint_bounds;
                } else {
                    constraint_counts.hidden += 1;
                }
                match svg.layer {
                    ConstraintLayer::DrawingDimension => drawing_dimensions.push(svg.svg),
                    ConstraintLayer::SolverConstraint => solver_constraints.push(svg.svg),
                }
            }
        }
    }

    let raw_bounds = bounds.ok_or_else(|| Error {
        msg: format!("Sketch has no renderable geometry: {sketch_id:?}"),
    })?;
    let padded_bounds = raw_bounds.expand(options.padding);
    let view_box = SketchSvgViewBox {
        min_x: round_float(padded_bounds.min_x),
        min_y: round_float(-padded_bounds.max_y),
        width: round_float(padded_bounds.width()),
        height: round_float(padded_bounds.height()),
    };
    let bounds = SketchSvgBounds {
        min_x: round_float(raw_bounds.min_x),
        min_y: round_float(raw_bounds.min_y),
        max_x: round_float(raw_bounds.max_x),
        max_y: round_float(raw_bounds.max_y),
    };
    let quality = build_quality_report(&constraint_layout, geometry_bounds, constraint_counts);

    let mut svg = String::new();
    svg.push_str(r#"<svg xmlns="http://www.w3.org/2000/svg" class="sketch-svg "#);
    svg.push_str(mode_class(options.mode));
    svg.push_str(r#"" data-sketch-id=""#);
    svg.push_str(&sketch_id.0.to_string());
    svg.push_str(r#"" data-mode=""#);
    svg.push_str(match options.mode {
        SketchSvgMode::Drawing => "drawing",
        SketchSvgMode::Agent => "agent",
        SketchSvgMode::Constraints => "constraints",
    });
    svg.push_str(r#"" data-quality-score=""#);
    svg.push_str(&fmt_num(quality.score));
    svg.push_str(r#"" data-visible-constraints=""#);
    svg.push_str(&quality.visible_constraints.to_string());
    svg.push_str(r#"" data-hidden-constraints=""#);
    svg.push_str(&quality.hidden_constraints.to_string());
    svg.push_str(r#"" viewBox=""#);
    svg.push_str(&format!(
        "{} {} {} {}",
        fmt_num(view_box.min_x),
        fmt_num(view_box.min_y),
        fmt_num(view_box.width),
        fmt_num(view_box.height)
    ));
    svg.push_str(r#"" fill="none" overflow="visible" stroke-linecap="round" stroke-linejoin="round">"#);
    svg.push('\n');
    svg.push_str(svg_defs());
    if options.include_metadata {
        svg.push_str(&svg_metadata(sketch_id, options.mode, view_box, bounds, &quality));
    }
    svg.push_str("  <g");
    push_common_attrs(&mut svg, sketch_object, "sketch");
    svg.push_str(r#" stroke="currentColor" stroke-width=""#);
    svg.push_str(&fmt_num(libm::fmax(options.stroke_width, 0.0)));
    svg.push_str(r#"">"#);
    svg.push('\n');

    push_layer(
        &mut svg,
        sketch_id,
        "drawing-dimensions",
        "sketch-constraints sketch-dimensions",
        r##"color="#111827" stroke="#4b5563" fill="none" stroke-width="0.75""##,
        &drawing_dimensions,
    );
    push_layer(
        &mut svg,
        sketch_id,
        "solver-constraints",
        "sketch-constraints sketch-solver-constraints",
        r##"color="#111827" stroke="#4b5563" fill="none" stroke-width="0.75""##,
        &solver_constraints,
    );
    push_layer(
        &mut svg,
        sketch_id,
        "construction-geometry",
        "sketch-construction",
        r##"color="#6b7280" stroke="currentColor" stroke-width="1""##,
        &construction_geometry,
    );
    push_layer(
        &mut svg,
        sketch_id,
        "model-geometry",
        "sketch-model-geometry",
        "",
        &model_geometry,
    );
    push_layer(&mut svg, sketch_id, "points", "sketch-points", "", &point_geometry);
    svg.push_str("  </g>\n</svg>\n");

    Ok(SketchSvgExport {
        sketch_id,
        view_box,
        bounds,
        quality,
        svg,
    })
}

fn svg_defs() -> &'static str {
    r#"  <defs>
    <style><![CDATA[
      .sketch-svg [data-layer="model-geometry"] { color: #111827; }
      .sketch-svg [data-layer="construction-geometry"] { opacity: 0.55; }
      .sketch-svg [data-layer="drawing-dimensions"] { color: #111827; }
      .sketch-svg [data-layer="solver-constraints"] { opacity: 0.58; }
      .sketch-svg-mode-drawing [data-layer="solver-constraints"],
      .sketch-svg-mode-agent [data-layer="solver-constraints"] { display: none; }
      .sketch-svg-mode-constraints [data-layer="solver-constraints"] { display: inline; }
    ]]></style>
  </defs>
"#
}

fn svg_metadata(
    sketch_id: ObjectId,
    mode: SketchSvgMode,
    view_box: SketchSvgViewBox,
    bounds: SketchSvgBounds,
    quality: &SketchSvgQuality,
) -> String {
    let metadata = SketchSvgMetadata {
        schema_version: 1,
        sketch_id,
        mode,
        view_box,
        bounds,
        quality,
        layers: [
            "drawing-dimensions",
            "solver-constraints",
            "construction-geometry",
            "model-geometry",
            "points",
        ],
    };
    let json = serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_owned());
    let mut out = String::from(r#"  <metadata id="sketch-svg-metadata" type="application/json">"#);
    out.push_str(&escape_xml(&json));
    out.push_str("</metadata>\n");
    out
}

fn push_layer(svg: &mut String, sketch_id: ObjectId, layer: &str, class: &str, attrs: &str, elements: &[String]) {
    if elements.is_empty() {
        return;
    }
    svg.push_str("    <g id=\"sketch-");
    svg.push_str(&sketch_id.0.to_string());
    svg.push('-');
    svg.push_str(layer);
    svg.push_str("\" class=\"");
    svg.push_str(class);
    svg.push_str(" sketch-layer");
    svg.push_str("\" data-layer=\"");
    svg.push_str(layer);
    svg.push('"');
    if !attrs.is_empty() {
        svg.push(' ');
        svg.push_str(attrs);
    }
    svg.push_str(">\n");
    for element in elements {
        svg.push_str("      ");
        svg.push_str(element);
        svg.push('\n');
    }
    svg.push_str("    </g>\n");
}

fn select_sketch_id(
    scene_graph: &SceneGraph,
    object_lookup: &HashMap<ObjectId, &Object>,
    requested: Option<ObjectId>,
) -> Result<ObjectId> {
    if let Some(sketch_id) = requested {
        return Ok(sketch_id);
    }
    if let Some(sketch_id) = scene_graph.sketch_mode
        && matches!(
            object_lookup.get(&sketch_id).map(|object| &object.kind),
            Some(ObjectKind::Sketch(_))
        )
    {
        return Ok(sketch_id);
    }
    scene_graph
        .objects
        .iter()
        .find_map(|object| matches!(object.kind, ObjectKind::Sketch(_)).then_some(object.id))
        .ok_or_else(|| Error {
            msg: "No sketch found in scene graph".to_owned(),
        })
}

fn point_coords(object_lookup: &HashMap<ObjectId, &Object>, point_id: ObjectId) -> Result<Coords2d> {
    let object = object_lookup.get(&point_id).copied().ok_or_else(|| Error {
        msg: format!("Point object not found: {point_id:?}"),
    })?;
    let ObjectKind::Segment {
        segment: Segment::Point(point),
    } = &object.kind
    else {
        return Err(Error {
            msg: format!("Object is not a point segment: {point_id:?}"),
        });
    };
    Ok(coords_from_point(&point.position))
}

fn coords_from_point(point: &Point2d<Number>) -> Coords2d {
    Coords2d {
        x: point.x.value,
        y: point.y.value,
    }
}

fn svg_point(object: &Object, point: &Point, radius: f64) -> String {
    let position = coords_from_point(&point.position);
    let mut out = String::from("<path");
    push_common_attrs(&mut out, object, "point");
    out.push_str(r#" d="M "#);
    out.push_str(&fmt_num(position.x));
    out.push(' ');
    out.push_str(&fmt_num(svg_y(position.y)));
    out.push_str(r#" h 0" stroke-width=""#);
    out.push_str(&fmt_num(libm::fmax(libm::fmax(radius, 0.0) * 2.0, 0.0)));
    out.push('"');
    if let Some(owner) = point.owner {
        out.push_str(r#" data-owner-id=""#);
        out.push_str(&owner.0.to_string());
        out.push('"');
    }
    out.push_str("/>");
    out
}

fn svg_line(object: &Object, line: &Line, start: Coords2d, end: Coords2d) -> String {
    let mut out = String::from("<line");
    push_common_attrs(&mut out, object, "line");
    push_construction_attr(&mut out, line.construction);
    if let Some(owner) = line.owner {
        out.push_str(r#" data-owner-id=""#);
        out.push_str(&owner.0.to_string());
        out.push('"');
    }
    out.push_str(r#" x1=""#);
    out.push_str(&fmt_num(start.x));
    out.push_str(r#"" y1=""#);
    out.push_str(&fmt_num(svg_y(start.y)));
    out.push_str(r#"" x2=""#);
    out.push_str(&fmt_num(end.x));
    out.push_str(r#"" y2=""#);
    out.push_str(&fmt_num(svg_y(end.y)));
    out.push_str(r#""/>"#);
    out
}

fn svg_arc(object: &Object, arc: &Arc, start: Coords2d, end: Coords2d, center: Coords2d, radius: f64) -> String {
    let sweep_radians = ccw_sweep(start_angle(center, start), start_angle(center, end));
    let large_arc = if sweep_radians > std::f64::consts::PI { 1 } else { 0 };
    // The source geometry uses y-up coordinates. After flipping y for SVG, a CCW CAD arc becomes SVG sweep=0.
    let sweep = 0;

    let mut out = String::from("<path");
    push_common_attrs(&mut out, object, "arc");
    push_construction_attr(&mut out, arc.construction);
    out.push_str(r#" d="M "#);
    out.push_str(&fmt_num(start.x));
    out.push(' ');
    out.push_str(&fmt_num(svg_y(start.y)));
    out.push_str(" A ");
    out.push_str(&fmt_num(radius));
    out.push(' ');
    out.push_str(&fmt_num(radius));
    out.push_str(" 0 ");
    out.push_str(&large_arc.to_string());
    out.push(' ');
    out.push_str(&sweep.to_string());
    out.push(' ');
    out.push_str(&fmt_num(end.x));
    out.push(' ');
    out.push_str(&fmt_num(svg_y(end.y)));
    out.push_str(r#""/>"#);
    out
}

fn svg_circle(object: &Object, circle: &Circle, center: Coords2d, radius: f64) -> String {
    let mut out = String::from("<circle");
    push_common_attrs(&mut out, object, "circle");
    push_construction_attr(&mut out, circle.construction);
    out.push_str(r#" cx=""#);
    out.push_str(&fmt_num(center.x));
    out.push_str(r#"" cy=""#);
    out.push_str(&fmt_num(svg_y(center.y)));
    out.push_str(r#"" r=""#);
    out.push_str(&fmt_num(radius));
    out.push_str(r#""/>"#);
    out
}

fn svg_spline(object: &Object, spline: &ControlPointSpline, sampled: &[Coords2d]) -> String {
    let mut out = String::from("<polyline");
    push_common_attrs(&mut out, object, "control-point-spline");
    push_construction_attr(&mut out, spline.construction);
    out.push_str(r#" points=""#);
    for (index, point) in sampled.iter().enumerate() {
        if index > 0 {
            out.push(' ');
        }
        out.push_str(&fmt_num(point.x));
        out.push(',');
        out.push_str(&fmt_num(svg_y(point.y)));
    }
    out.push_str(r#""/>"#);
    out
}

fn svg_constraint(
    object: &Object,
    constraint: &Constraint,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    sketch_bounds: Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<Option<RenderedConstraint>> {
    let (kind, layer) = constraint_kind_layer(constraint);
    let body = match constraint {
        Constraint::Coincident(coincident) => svg_coincident_constraint(coincident, object_lookup, bounds, style)?,
        Constraint::Distance(distance) => svg_distance_constraint(
            distance,
            object_lookup,
            bounds,
            sketch_bounds,
            layout,
            style,
            DistanceAxis::Aligned,
        )?,
        Constraint::HorizontalDistance(distance) => svg_distance_constraint(
            distance,
            object_lookup,
            bounds,
            sketch_bounds,
            layout,
            style,
            DistanceAxis::Horizontal,
        )?,
        Constraint::VerticalDistance(distance) => svg_distance_constraint(
            distance,
            object_lookup,
            bounds,
            sketch_bounds,
            layout,
            style,
            DistanceAxis::Vertical,
        )?,
        Constraint::Angle(angle) => svg_angle_constraint(angle, object_lookup, bounds, layout, style)?,
        Constraint::Diameter(diameter) => svg_diameter_constraint(diameter, object_lookup, bounds, layout, style)?,
        Constraint::Radius(radius) => svg_radius_constraint(radius, object_lookup, bounds, layout, style)?,
        Constraint::EqualRadius(equal_radius) => {
            svg_equal_radius_constraint(equal_radius, object_lookup, bounds, layout, style)?
        }
        Constraint::Fixed(fixed) => svg_fixed_constraint(fixed, object_lookup, bounds, layout, style)?,
        Constraint::Horizontal(horizontal) => {
            svg_horizontal_constraint(horizontal, object_lookup, bounds, sketch_bounds, layout, style)?
        }
        Constraint::Vertical(vertical) => {
            svg_vertical_constraint(vertical, object_lookup, bounds, sketch_bounds, layout, style)?
        }
        Constraint::LinesEqualLength(equal_length) => {
            svg_equal_length_constraint(equal_length, object_lookup, bounds, style)?
        }
        Constraint::Midpoint(midpoint) => svg_midpoint_constraint(midpoint, object_lookup, bounds, layout, style)?,
        Constraint::Parallel(parallel) => svg_parallel_constraint(parallel, object_lookup, bounds, style)?,
        Constraint::Perpendicular(perpendicular) => {
            svg_perpendicular_constraint(perpendicular, object_lookup, bounds, layout, style)?
        }
        Constraint::Symmetric(symmetric) => svg_symmetric_constraint(symmetric, object_lookup, bounds, layout, style)?,
        Constraint::Tangent(tangent) => {
            svg_tangent_constraint(tangent, object_lookup, bounds, sketch_bounds, layout, style)?
        }
    };

    if body.is_empty() {
        return Ok(None);
    }

    Ok(Some(RenderedConstraint {
        svg: svg_constraint_group(object, kind, layer, &body),
        layer,
    }))
}

fn constraint_kind_layer(constraint: &Constraint) -> (&'static str, ConstraintLayer) {
    match constraint {
        Constraint::Distance(_) => ("distance", ConstraintLayer::DrawingDimension),
        Constraint::HorizontalDistance(_) => ("horizontal-distance", ConstraintLayer::DrawingDimension),
        Constraint::VerticalDistance(_) => ("vertical-distance", ConstraintLayer::DrawingDimension),
        Constraint::Angle(_) => ("angle", ConstraintLayer::DrawingDimension),
        Constraint::Diameter(_) => ("diameter", ConstraintLayer::DrawingDimension),
        Constraint::Radius(_) => ("radius", ConstraintLayer::DrawingDimension),
        Constraint::Coincident(_) => ("coincident", ConstraintLayer::SolverConstraint),
        Constraint::EqualRadius(_) => ("equal-radius", ConstraintLayer::SolverConstraint),
        Constraint::Fixed(_) => ("fixed", ConstraintLayer::SolverConstraint),
        Constraint::Horizontal(_) => ("horizontal", ConstraintLayer::SolverConstraint),
        Constraint::Vertical(_) => ("vertical", ConstraintLayer::SolverConstraint),
        Constraint::LinesEqualLength(_) => ("lines-equal-length", ConstraintLayer::SolverConstraint),
        Constraint::Midpoint(_) => ("midpoint", ConstraintLayer::SolverConstraint),
        Constraint::Parallel(_) => ("parallel", ConstraintLayer::SolverConstraint),
        Constraint::Perpendicular(_) => ("perpendicular", ConstraintLayer::SolverConstraint),
        Constraint::Symmetric(_) => ("symmetric", ConstraintLayer::SolverConstraint),
        Constraint::Tangent(_) => ("tangent", ConstraintLayer::SolverConstraint),
    }
}

fn svg_constraint_group(object: &Object, kind: &str, layer: ConstraintLayer, body: &str) -> String {
    let mut out = String::from("<g");
    out.push_str(r#" id="constraint-"#);
    out.push_str(&object.id.0.to_string());
    out.push('"');
    out.push_str(r#" class="sketch-constraint sketch-constraint-"#);
    out.push_str(kind);
    out.push('"');
    out.push_str(r#" data-layer=""#);
    out.push_str(layer_name(layer));
    out.push('"');
    out.push_str(r#" data-object-id=""#);
    out.push_str(&object.id.0.to_string());
    out.push('"');
    out.push_str(r#" data-constraint-type=""#);
    out.push_str(kind);
    out.push('"');
    push_artifact_attr(&mut out, object.artifact_id);
    push_source_attrs(&mut out, &object.source);
    out.push('>');
    out.push_str(body);
    out.push_str("</g>");
    out
}

fn svg_coincident_constraint(
    coincident: &Coincident,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let anchors = coincident
        .segments
        .iter()
        .map(|segment| constraint_segment_anchor(segment, object_lookup))
        .collect::<Result<Vec<_>>>()?;
    if anchors.is_empty() {
        return Ok(String::new());
    }

    let anchor = average_points(&anchors);
    include_bounds_rect(
        bounds,
        Rect::around(anchor, style.coincident_radius, style.coincident_radius).expand(style.layout_gap),
    );
    let mut out = String::new();
    for point in anchors {
        if distance(point, anchor) > EPSILON {
            out.push_str(&svg_child_line(point, anchor, true, style));
        }
    }
    out.push_str(&svg_coincident_marker(anchor, style.coincident_radius));
    Ok(out)
}

#[derive(Clone, Copy)]
enum DistanceAxis {
    Aligned,
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy)]
enum DistanceDatum {
    Point(Coords2d),
    Line(Coords2d, Coords2d),
    Circle { center: Coords2d, radius: f64 },
}

fn horizontal_dimension_side(
    start: Coords2d,
    end: Coords2d,
    label_position: Option<Coords2d>,
    sketch_bounds: Option<Bounds>,
) -> DimensionSide {
    let Some(bounds) = sketch_bounds else {
        return DimensionSide::Bottom;
    };
    if label_position.is_some_and(|point| point.y > bounds.max_y) {
        return DimensionSide::Top;
    }
    if label_position.is_some_and(|point| point.y < bounds.min_y) {
        return DimensionSide::Bottom;
    }
    if (start.y + end.y) / 2.0 >= bounds.center().y {
        DimensionSide::Top
    } else {
        DimensionSide::Bottom
    }
}

fn vertical_dimension_side(
    start: Coords2d,
    end: Coords2d,
    label_position: Option<Coords2d>,
    sketch_bounds: Option<Bounds>,
) -> DimensionSide {
    let Some(bounds) = sketch_bounds else {
        return DimensionSide::Right;
    };
    if label_position.is_some_and(|point| point.x > bounds.max_x) {
        return DimensionSide::Right;
    }
    if label_position.is_some_and(|point| point.x < bounds.min_x) {
        return DimensionSide::Left;
    }
    if (start.x + end.x) / 2.0 >= bounds.center().x {
        DimensionSide::Right
    } else {
        DimensionSide::Left
    }
}

fn outside_normal(anchor: Coords2d, normal: Coords2d, sketch_bounds: Option<Bounds>) -> Coords2d {
    let Some(bounds) = sketch_bounds else {
        return normal;
    };
    let from_center = sub(anchor, bounds.center());
    if dot(normal, from_center) < 0.0 {
        scale(normal, -1.0)
    } else {
        normal
    }
}

fn distance_measure_points(
    segments: &[ConstraintSegment],
    object_lookup: &HashMap<ObjectId, &Object>,
) -> Result<Option<(Coords2d, Coords2d)>> {
    let [first, second, ..] = segments else {
        return Ok(None);
    };
    let first = distance_datum(first, object_lookup)?;
    let second = distance_datum(second, object_lookup)?;
    Ok(Some(points_between_datums(first, second)))
}

fn distance_datum(segment: &ConstraintSegment, object_lookup: &HashMap<ObjectId, &Object>) -> Result<DistanceDatum> {
    match segment {
        ConstraintSegment::Origin(_) => Ok(DistanceDatum::Point(Coords2d { x: 0.0, y: 0.0 })),
        ConstraintSegment::Segment(id) => {
            let object = object_lookup.get(id).copied().ok_or_else(|| Error {
                msg: format!("Segment object not found: {id:?}"),
            })?;
            let ObjectKind::Segment { segment } = &object.kind else {
                return Ok(DistanceDatum::Point(segment_anchor(object_lookup, *id)?));
            };
            match segment {
                Segment::Point(point) => Ok(DistanceDatum::Point(coords_from_point(&point.position))),
                Segment::Line(line) => Ok(DistanceDatum::Line(
                    point_coords(object_lookup, line.start)?,
                    point_coords(object_lookup, line.end)?,
                )),
                Segment::Arc(arc) => {
                    let center = point_coords(object_lookup, arc.center)?;
                    let start = point_coords(object_lookup, arc.start)?;
                    let end = point_coords(object_lookup, arc.end)?;
                    Ok(DistanceDatum::Circle {
                        center,
                        radius: average_radius(center, start, end),
                    })
                }
                Segment::Circle(circle) => {
                    let center = point_coords(object_lookup, circle.center)?;
                    let start = point_coords(object_lookup, circle.start)?;
                    Ok(DistanceDatum::Circle {
                        center,
                        radius: distance(center, start),
                    })
                }
                Segment::ControlPointSpline(_) => Ok(DistanceDatum::Point(segment_anchor(object_lookup, *id)?)),
            }
        }
    }
}

fn points_between_datums(first: DistanceDatum, second: DistanceDatum) -> (Coords2d, Coords2d) {
    match (first, second) {
        (DistanceDatum::Point(a), DistanceDatum::Point(b)) => (a, b),
        (DistanceDatum::Point(point), DistanceDatum::Line(line_start, line_end)) => {
            (point, project_point_to_line(point, (line_start, line_end)))
        }
        (DistanceDatum::Line(line_start, line_end), DistanceDatum::Point(point)) => {
            (project_point_to_line(point, (line_start, line_end)), point)
        }
        (DistanceDatum::Line(a_start, a_end), DistanceDatum::Line(b_start, b_end)) => {
            let anchor = midpoint(a_start, a_end);
            if cross(sub(a_end, a_start), sub(b_end, b_start)).abs() <= EPSILON {
                (anchor, project_point_to_line(anchor, (b_start, b_end)))
            } else {
                (anchor, midpoint(b_start, b_end))
            }
        }
        (DistanceDatum::Point(point), DistanceDatum::Circle { center, radius }) => {
            (point, circle_point_toward(center, radius, point))
        }
        (DistanceDatum::Circle { center, radius }, DistanceDatum::Point(point)) => {
            (circle_point_toward(center, radius, point), point)
        }
        (
            DistanceDatum::Circle {
                center: center_a,
                radius: radius_a,
            },
            DistanceDatum::Circle {
                center: center_b,
                radius: radius_b,
            },
        ) => (
            circle_point_toward(center_a, radius_a, center_b),
            circle_point_toward(center_b, radius_b, center_a),
        ),
        (DistanceDatum::Line(line_start, line_end), DistanceDatum::Circle { center, radius }) => {
            let projected = project_point_to_line(center, (line_start, line_end));
            (projected, circle_point_toward(center, radius, projected))
        }
        (DistanceDatum::Circle { center, radius }, DistanceDatum::Line(line_start, line_end)) => {
            let projected = project_point_to_line(center, (line_start, line_end));
            (circle_point_toward(center, radius, projected), projected)
        }
    }
}

fn project_point_to_line(point: Coords2d, line: (Coords2d, Coords2d)) -> Coords2d {
    let direction = sub(line.1, line.0);
    let length_squared = dot(direction, direction);
    if length_squared <= EPSILON {
        return line.0;
    }
    let t = dot(sub(point, line.0), direction) / length_squared;
    add(line.0, scale(direction, t))
}

fn circle_point_toward(center: Coords2d, radius: f64, toward: Coords2d) -> Coords2d {
    let direction = unit(sub(toward, center));
    if length(direction) <= EPSILON {
        Coords2d {
            x: center.x + radius,
            y: center.y,
        }
    } else {
        add(center, scale(direction, radius))
    }
}

fn svg_distance_constraint(
    distance_constraint: &Distance,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    sketch_bounds: Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
    axis: DistanceAxis,
) -> Result<String> {
    let anchors = distance_constraint
        .points
        .iter()
        .map(|point| constraint_segment_anchor(point, object_lookup))
        .collect::<Result<Vec<_>>>()?;
    let [fallback_start, fallback_end, ..] = anchors.as_slice() else {
        return Ok(String::new());
    };
    let (start, end) = match axis {
        DistanceAxis::Aligned => distance_measure_points(&distance_constraint.points, object_lookup)?
            .unwrap_or((*fallback_start, *fallback_end)),
        DistanceAxis::Horizontal | DistanceAxis::Vertical => (*fallback_start, *fallback_end),
    };

    let label = magnitude_label(distance_constraint.distance);
    let label_position = distance_constraint.label_position.as_ref().map(coords_from_point);

    let (line_start, line_end, label_anchor, label_dx, label_dy) = match axis {
        DistanceAxis::Aligned => {
            let midpoint = midpoint(start, end);
            let normal = outside_normal(midpoint, perp(unit(sub(end, start))), sketch_bounds);
            let label_anchor = label_position.unwrap_or(add(midpoint, scale(normal, style.dimension_offset)));
            let offset = sub(label_anchor, midpoint);
            (
                add(start, offset),
                add(end, offset),
                label_anchor,
                normal.x * style.text_offset,
                -normal.y * style.text_offset,
            )
        }
        DistanceAxis::Horizontal => {
            let side = horizontal_dimension_side(start, end, label_position, sketch_bounds);
            let y = label_position.map(|point| point.y).unwrap_or_else(|| {
                let lane = layout.allocate_dimension_lane(side, start.x, end.x, style) as f64;
                let offset = style.dimension_offset + lane * style.dimension_lane_gap;
                match (side, sketch_bounds) {
                    (DimensionSide::Top, Some(bounds)) => bounds.max_y + offset,
                    (DimensionSide::Bottom, Some(bounds)) => bounds.min_y - offset,
                    (DimensionSide::Top, None) => libm::fmax(start.y, end.y) + offset,
                    (DimensionSide::Bottom, None) => libm::fmin(start.y, end.y) - offset,
                    _ => libm::fmin(start.y, end.y) - offset,
                }
            });
            let line_start = Coords2d { x: start.x, y };
            let line_end = Coords2d { x: end.x, y };
            (
                line_start,
                line_end,
                label_position.unwrap_or(Coords2d {
                    x: (start.x + end.x) / 2.0,
                    y,
                }),
                0.0,
                if label_position.is_some() {
                    0.0
                } else {
                    -style.text_offset
                },
            )
        }
        DistanceAxis::Vertical => {
            let side = vertical_dimension_side(start, end, label_position, sketch_bounds);
            let x = label_position.map(|point| point.x).unwrap_or_else(|| {
                let lane = layout.allocate_dimension_lane(side, start.y, end.y, style) as f64;
                let offset = style.dimension_offset + lane * style.dimension_lane_gap;
                match (side, sketch_bounds) {
                    (DimensionSide::Right, Some(bounds)) => bounds.max_x + offset,
                    (DimensionSide::Left, Some(bounds)) => bounds.min_x - offset,
                    (DimensionSide::Right, None) => libm::fmax(start.x, end.x) + offset,
                    (DimensionSide::Left, None) => libm::fmin(start.x, end.x) - offset,
                    _ => libm::fmax(start.x, end.x) + offset,
                }
            });
            let line_start = Coords2d { x, y: start.y };
            let line_end = Coords2d { x, y: end.y };
            (
                line_start,
                line_end,
                label_position.unwrap_or(Coords2d {
                    x,
                    y: (start.y + end.y) / 2.0,
                }),
                if label_position.is_some() {
                    0.0
                } else if side == DimensionSide::Left {
                    -style.text_offset
                } else {
                    style.text_offset
                },
                0.0,
            )
        }
    };

    include_constraint_bounds(bounds, line_start, style);
    include_constraint_bounds(bounds, line_end, style);
    include_constraint_bounds(bounds, label_anchor, style);

    let mut out = String::new();
    out.push_str(&svg_dimension_line(line_start, line_end, style));
    out.push_str(&svg_witness_line(start, line_start, style));
    out.push_str(&svg_witness_line(end, line_end, style));
    if label_position.is_some() {
        out.push_str(&svg_text_fixed(label_anchor, &label, bounds, layout, style));
    } else {
        out.push_str(&svg_text(
            label_anchor,
            &label,
            label_dx,
            label_dy,
            bounds,
            layout,
            style,
        ));
    }
    Ok(out)
}

fn svg_angle_constraint(
    angle: &Angle,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let [line_a_id, line_b_id, ..] = angle.lines.as_slice() else {
        return Ok(String::new());
    };
    let Some(line_a) = line_endpoints(object_lookup, *line_a_id)? else {
        return Ok(String::new());
    };
    let Some(line_b) = line_endpoints(object_lookup, *line_b_id)? else {
        return Ok(String::new());
    };
    let Some(vertex) = shared_or_intersection(line_a, line_b) else {
        return Ok(String::new());
    };

    let dir_a = direction_from_vertex(vertex, line_a);
    let dir_b = direction_from_vertex(vertex, line_b);
    if length(dir_a) <= EPSILON || length(dir_b) <= EPSILON {
        return Ok(String::new());
    }

    let radius = style.dimension_offset;
    let unit_a = unit(dir_a);
    let unit_b = unit(dir_b);
    let start = add(vertex, scale(unit_a, radius));
    let end = add(vertex, scale(unit_b, radius));
    let arc_start_angle = start_angle(vertex, start);
    let arc_end_angle = start_angle(vertex, end);
    let ccw = ccw_sweep(arc_start_angle, arc_end_angle);
    let cw = if ccw <= EPSILON {
        0.0
    } else {
        std::f64::consts::TAU - ccw
    };
    let target = angle_radians(angle.angle);
    let use_ccw = (ccw - target).abs() <= (cw - target).abs();
    let sweep_radians = if use_ccw { ccw } else { cw };
    let large_arc = if sweep_radians > std::f64::consts::PI { 1 } else { 0 };
    // The source geometry uses y-up coordinates. After flipping y for SVG, CAD CCW uses SVG sweep=0.
    let svg_sweep = if use_ccw { 0 } else { 1 };
    let label_angle = if use_ccw {
        arc_start_angle + sweep_radians / 2.0
    } else {
        arc_start_angle - sweep_radians / 2.0
    };
    let label_anchor = add(
        vertex,
        scale(
            Coords2d {
                x: libm::cos(label_angle),
                y: libm::sin(label_angle),
            },
            radius + style.text_offset,
        ),
    );

    include_constraint_bounds(bounds, start, style);
    include_constraint_bounds(bounds, end, style);
    include_constraint_bounds(bounds, label_anchor, style);

    let mut out = String::new();
    out.push_str(r#"<path vector-effect="non-scaling-stroke" d="M "#);
    out.push_str(&fmt_num(start.x));
    out.push(' ');
    out.push_str(&fmt_num(svg_y(start.y)));
    out.push_str(" A ");
    out.push_str(&fmt_num(radius));
    out.push(' ');
    out.push_str(&fmt_num(radius));
    out.push_str(" 0 ");
    out.push_str(&large_arc.to_string());
    out.push(' ');
    out.push_str(&svg_sweep.to_string());
    out.push(' ');
    out.push_str(&fmt_num(end.x));
    out.push(' ');
    out.push_str(&fmt_num(svg_y(end.y)));
    out.push_str(r#""/>"#);
    out.push_str(&svg_text(
        label_anchor,
        &magnitude_label(angle.angle),
        0.0,
        -style.text_offset,
        bounds,
        layout,
        style,
    ));
    Ok(out)
}

fn svg_radius_constraint(
    radius_constraint: &Radius,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let Some(circle) = circular_segment(object_lookup, radius_constraint.arc)? else {
        return Ok(String::new());
    };
    let label_anchor = radius_constraint
        .label_position
        .as_ref()
        .map(coords_from_point)
        .unwrap_or_else(|| midpoint(circle.center, circle.start));
    include_constraint_bounds(bounds, circle.center, style);
    include_constraint_bounds(bounds, circle.start, style);
    include_constraint_bounds(bounds, label_anchor, style);

    let mut out = String::new();
    out.push_str(&svg_child_line(circle.center, circle.start, false, style));
    out.push_str(&svg_text(
        label_anchor,
        &format!("R{}", magnitude_label(radius_constraint.radius)),
        0.0,
        -style.text_offset,
        bounds,
        layout,
        style,
    ));
    Ok(out)
}

fn svg_diameter_constraint(
    diameter: &Diameter,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let Some(circle) = circular_segment(object_lookup, diameter.arc)? else {
        return Ok(String::new());
    };
    let opposite = sub(scale(circle.center, 2.0), circle.start);
    let label_anchor = diameter
        .label_position
        .as_ref()
        .map(coords_from_point)
        .unwrap_or_else(|| circle.center);
    include_constraint_bounds(bounds, circle.start, style);
    include_constraint_bounds(bounds, opposite, style);
    include_constraint_bounds(bounds, label_anchor, style);

    let mut out = String::new();
    out.push_str(&svg_child_line(circle.start, opposite, false, style));
    out.push_str(&svg_text(
        label_anchor,
        &format!("D{}", magnitude_label(diameter.diameter)),
        0.0,
        -style.text_offset,
        bounds,
        layout,
        style,
    ));
    Ok(out)
}

fn svg_equal_radius_constraint(
    equal_radius: &EqualRadius,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let anchors = equal_radius
        .input
        .iter()
        .filter_map(|id| circular_segment(object_lookup, *id).transpose())
        .map(|result| result.map(|circle| circle.center))
        .collect::<Result<Vec<_>>>()?;
    Ok(svg_linked_markers(&anchors, "R=", bounds, layout, style))
}

fn svg_fixed_constraint(
    fixed: &Fixed,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let mut out = String::new();
    for point in &fixed.points {
        let anchor = point_coords(object_lookup, point.point).unwrap_or_else(|_| coords_from_point(&point.position));
        include_constraint_bounds(bounds, anchor, style);
        out.push_str(&svg_marker(anchor, "FIX", bounds, layout, style));
    }
    Ok(out)
}

fn svg_horizontal_constraint(
    horizontal: &Horizontal,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    sketch_bounds: Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let anchor = match horizontal {
        Horizontal::Line { line } => match line_endpoints(object_lookup, *line)? {
            Some(line) => offset_line_marker_anchor(line, sketch_bounds, style),
            None => segment_anchor(object_lookup, *line)?,
        },
        Horizontal::Points { points } => average_constraint_segments(points, object_lookup)?,
    };
    include_constraint_bounds(bounds, anchor, style);
    Ok(svg_orientation_marker(
        anchor,
        OrientationMarker::Horizontal,
        bounds,
        layout,
        style,
    ))
}

fn svg_vertical_constraint(
    vertical: &Vertical,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    sketch_bounds: Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let anchor = match vertical {
        Vertical::Line { line } => match line_endpoints(object_lookup, *line)? {
            Some(line) => offset_line_marker_anchor(line, sketch_bounds, style),
            None => segment_anchor(object_lookup, *line)?,
        },
        Vertical::Points { points } => average_constraint_segments(points, object_lookup)?,
    };
    include_constraint_bounds(bounds, anchor, style);
    Ok(svg_orientation_marker(
        anchor,
        OrientationMarker::Vertical,
        bounds,
        layout,
        style,
    ))
}

fn svg_equal_length_constraint(
    equal_length: &LinesEqualLength,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let mut out = String::new();
    for line_id in &equal_length.lines {
        let Some(line) = line_endpoints(object_lookup, *line_id)? else {
            continue;
        };
        let anchor = midpoint(line.0, line.1);
        include_constraint_bounds(bounds, anchor, style);
        out.push_str(&svg_tick(line, 0.0, style));
    }
    Ok(out)
}

fn svg_midpoint_constraint(
    midpoint_constraint: &Midpoint,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let point = constraint_segment_anchor(&midpoint_constraint.point, object_lookup)?;
    let segment_midpoint = segment_anchor(object_lookup, midpoint_constraint.segment)?;
    include_constraint_bounds(bounds, point, style);
    include_constraint_bounds(bounds, segment_midpoint, style);

    let mut out = String::new();
    out.push_str(&svg_child_line(point, segment_midpoint, true, style));
    out.push_str(&svg_marker(point, "MID", bounds, layout, style));
    Ok(out)
}

fn svg_parallel_constraint(
    parallel: &Parallel,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let mut out = String::new();
    for line_id in &parallel.lines {
        let Some(line) = line_endpoints(object_lookup, *line_id)? else {
            continue;
        };
        let anchor = midpoint(line.0, line.1);
        include_constraint_bounds(bounds, anchor, style);
        out.push_str(&svg_parallel_ticks(line, style));
    }
    Ok(out)
}

fn svg_perpendicular_constraint(
    perpendicular: &Perpendicular,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let [line_a_id, line_b_id, ..] = perpendicular.lines.as_slice() else {
        return Ok(String::new());
    };
    let Some(line_a) = line_endpoints(object_lookup, *line_a_id)? else {
        return Ok(String::new());
    };
    let Some(line_b) = line_endpoints(object_lookup, *line_b_id)? else {
        return Ok(String::new());
    };
    let Some(vertex) = shared_or_intersection(line_a, line_b) else {
        return Ok(String::new());
    };
    include_constraint_bounds(bounds, vertex, style);
    Ok(svg_right_angle(
        vertex,
        direction_from_vertex(vertex, line_a),
        direction_from_vertex(vertex, line_b),
        bounds,
        layout,
        style,
    ))
}

fn svg_symmetric_constraint(
    symmetric: &Symmetric,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let axis_anchor = segment_anchor(object_lookup, symmetric.axis)?;
    let anchors = symmetric
        .input
        .iter()
        .map(|id| segment_anchor(object_lookup, *id))
        .collect::<Result<Vec<_>>>()?;
    let mut out = String::new();
    for anchor in &anchors {
        include_constraint_bounds(bounds, *anchor, style);
        out.push_str(&svg_child_line(*anchor, axis_anchor, true, style));
    }
    include_constraint_bounds(bounds, axis_anchor, style);
    out.push_str(&svg_marker(axis_anchor, "SYM", bounds, layout, style));
    Ok(out)
}

fn svg_tangent_constraint(
    tangent: &Tangent,
    object_lookup: &HashMap<ObjectId, &Object>,
    bounds: &mut Option<Bounds>,
    sketch_bounds: Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> Result<String> {
    let anchors = tangent_symbol_anchors(&tangent.input, object_lookup, sketch_bounds, style)?;
    Ok(svg_tangent_markers(&anchors, bounds, layout, style))
}

fn push_common_attrs(out: &mut String, object: &Object, role: &str) {
    out.push_str(r#" id=""#);
    out.push_str(role);
    out.push('-');
    out.push_str(&object.id.0.to_string());
    out.push('"');
    out.push_str(r#" class=""#);
    out.push_str("sketch-");
    out.push_str(role);
    out.push('"');
    out.push_str(r#" data-sketch-role=""#);
    out.push_str(role);
    out.push('"');
    out.push_str(r#" vector-effect="non-scaling-stroke""#);
    out.push_str(r#" data-object-id=""#);
    out.push_str(&object.id.0.to_string());
    out.push('"');
    push_artifact_attr(out, object.artifact_id);
    push_source_attrs(out, &object.source);
    if !object.label.is_empty() {
        out.push_str(r#" data-label=""#);
        out.push_str(&escape_xml(&object.label));
        out.push('"');
    }
}

fn push_artifact_attr(out: &mut String, artifact_id: ArtifactId) {
    let uuid: uuid::Uuid = artifact_id.into();
    out.push_str(r#" data-artifact-id=""#);
    out.push_str(&escape_xml(&uuid.to_string()));
    out.push('"');
}

fn push_source_attrs(out: &mut String, source: &SourceRef) {
    match source {
        SourceRef::Simple { range, .. } => {
            out.push_str(r#" data-source-range=""#);
            out.push_str(&escape_xml(&json_attr(range)));
            out.push('"');
        }
        SourceRef::BackTrace { ranges } => {
            if let Some((range, _)) = ranges.first() {
                out.push_str(r#" data-source-range=""#);
                out.push_str(&escape_xml(&json_attr(range)));
                out.push('"');
            }
        }
    }
}

fn push_construction_attr(out: &mut String, construction: bool) {
    if construction {
        out.push_str(r#" stroke-dasharray="8 6" data-construction="true""#);
    }
}

fn constraint_segment_anchor(
    segment: &ConstraintSegment,
    object_lookup: &HashMap<ObjectId, &Object>,
) -> Result<Coords2d> {
    match segment {
        ConstraintSegment::Segment(id) => segment_anchor(object_lookup, *id),
        ConstraintSegment::Origin(_) => Ok(Coords2d { x: 0.0, y: 0.0 }),
    }
}

fn average_constraint_segments(
    segments: &[ConstraintSegment],
    object_lookup: &HashMap<ObjectId, &Object>,
) -> Result<Coords2d> {
    let points = segments
        .iter()
        .map(|segment| constraint_segment_anchor(segment, object_lookup))
        .collect::<Result<Vec<_>>>()?;
    Ok(average_points(&points))
}

fn segment_anchor(object_lookup: &HashMap<ObjectId, &Object>, id: ObjectId) -> Result<Coords2d> {
    let object = object_lookup.get(&id).copied().ok_or_else(|| Error {
        msg: format!("Segment object not found: {id:?}"),
    })?;
    let ObjectKind::Segment { segment } = &object.kind else {
        return Err(Error {
            msg: format!("Object is not a segment: {id:?}"),
        });
    };

    match segment {
        Segment::Point(point) => Ok(coords_from_point(&point.position)),
        Segment::Line(line) => {
            let start = point_coords(object_lookup, line.start)?;
            let end = point_coords(object_lookup, line.end)?;
            Ok(midpoint(start, end))
        }
        Segment::Arc(arc) => {
            let start = point_coords(object_lookup, arc.start)?;
            let end = point_coords(object_lookup, arc.end)?;
            let center = point_coords(object_lookup, arc.center)?;
            let radius = average_radius(center, start, end);
            let angle =
                start_angle(center, start) + ccw_sweep(start_angle(center, start), start_angle(center, end)) / 2.0;
            Ok(Coords2d {
                x: center.x + radius * libm::cos(angle),
                y: center.y + radius * libm::sin(angle),
            })
        }
        Segment::Circle(circle) => {
            let start = point_coords(object_lookup, circle.start)?;
            let center = point_coords(object_lookup, circle.center)?;
            Ok(midpoint(start, center))
        }
        Segment::ControlPointSpline(spline) => {
            let controls = spline
                .controls
                .iter()
                .map(|id| point_coords(object_lookup, *id))
                .collect::<Result<Vec<_>>>()?;
            Ok(average_points(&controls))
        }
    }
}

fn line_endpoints(object_lookup: &HashMap<ObjectId, &Object>, id: ObjectId) -> Result<Option<(Coords2d, Coords2d)>> {
    let Some(object) = object_lookup.get(&id).copied() else {
        return Ok(None);
    };
    let ObjectKind::Segment {
        segment: Segment::Line(line),
    } = &object.kind
    else {
        return Ok(None);
    };
    Ok(Some((
        point_coords(object_lookup, line.start)?,
        point_coords(object_lookup, line.end)?,
    )))
}

#[derive(Clone, Copy)]
struct CircularSegment {
    center: Coords2d,
    start: Coords2d,
}

fn circular_segment(object_lookup: &HashMap<ObjectId, &Object>, id: ObjectId) -> Result<Option<CircularSegment>> {
    let Some(object) = object_lookup.get(&id).copied() else {
        return Ok(None);
    };
    let ObjectKind::Segment { segment } = &object.kind else {
        return Ok(None);
    };
    match segment {
        Segment::Arc(arc) => {
            let center = point_coords(object_lookup, arc.center)?;
            let start = point_coords(object_lookup, arc.start)?;
            Ok(Some(CircularSegment { center, start }))
        }
        Segment::Circle(circle) => {
            let center = point_coords(object_lookup, circle.center)?;
            let start = point_coords(object_lookup, circle.start)?;
            Ok(Some(CircularSegment { center, start }))
        }
        _ => Ok(None),
    }
}

fn svg_linked_markers(
    anchors: &[Coords2d],
    label: &str,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    if anchors.is_empty() {
        return String::new();
    }
    let center = average_points(anchors);
    include_constraint_bounds(bounds, center, style);
    let mut out = String::new();
    for anchor in anchors {
        include_constraint_bounds(bounds, *anchor, style);
        if distance(*anchor, center) > EPSILON {
            out.push_str(&svg_child_line(*anchor, center, true, style));
        }
        out.push_str(&svg_marker(*anchor, label, bounds, layout, style));
    }
    out
}

fn offset_line_marker_anchor(
    line: (Coords2d, Coords2d),
    sketch_bounds: Option<Bounds>,
    style: ConstraintSvgStyle,
) -> Coords2d {
    let anchor = midpoint(line.0, line.1);
    let normal = outside_normal(anchor, perp(unit(sub(line.1, line.0))), sketch_bounds);
    add(anchor, scale(normal, style.marker_radius * 2.8))
}

fn offset_point_marker_anchor(anchor: Coords2d, sketch_bounds: Option<Bounds>, style: ConstraintSvgStyle) -> Coords2d {
    let direction = sketch_bounds
        .map(|bounds| unit(sub(anchor, bounds.center())))
        .filter(|direction| length(*direction) > EPSILON)
        .unwrap_or(Coords2d { x: 0.0, y: 1.0 });
    add(anchor, scale(direction, style.marker_radius * 2.4))
}

#[derive(Clone, Copy)]
enum OrientationMarker {
    Horizontal,
    Vertical,
}

fn svg_orientation_marker(
    anchor: Coords2d,
    orientation: OrientationMarker,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    let anchor = layout.place_symbol(anchor, style);
    let size = symbol_size(style);
    include_bounds_rect(
        bounds,
        Rect::around(anchor, size / 2.0, size / 2.0).expand(style.layout_gap),
    );

    let stroke = style.marker_radius * 0.16;
    let gap = style.marker_radius * 0.32;
    let extent = style.marker_radius * 0.62;
    let class = match orientation {
        OrientationMarker::Horizontal => "horizontal",
        OrientationMarker::Vertical => "vertical",
    };

    let mut out = String::new();
    out.push_str(r#"<g class="sketch-constraint-symbol sketch-constraint-symbol-"#);
    out.push_str(class);
    out.push_str(r#"" vector-effect="non-scaling-stroke" opacity="0.58">"#);

    match orientation {
        OrientationMarker::Horizontal => {
            out.push_str(&svg_symbol_line(
                Coords2d {
                    x: anchor.x - extent,
                    y: anchor.y + gap,
                },
                Coords2d {
                    x: anchor.x + extent,
                    y: anchor.y + gap,
                },
                stroke,
            ));
            out.push_str(&svg_symbol_line(
                Coords2d {
                    x: anchor.x - extent,
                    y: anchor.y - gap,
                },
                Coords2d {
                    x: anchor.x + extent,
                    y: anchor.y - gap,
                },
                stroke,
            ));
        }
        OrientationMarker::Vertical => {
            out.push_str(&svg_symbol_line(
                Coords2d {
                    x: anchor.x - gap,
                    y: anchor.y - extent,
                },
                Coords2d {
                    x: anchor.x - gap,
                    y: anchor.y + extent,
                },
                stroke,
            ));
            out.push_str(&svg_symbol_line(
                Coords2d {
                    x: anchor.x + gap,
                    y: anchor.y - extent,
                },
                Coords2d {
                    x: anchor.x + gap,
                    y: anchor.y + extent,
                },
                stroke,
            ));
        }
    }

    out.push_str("</g>");
    out
}

#[derive(Clone, Copy)]
struct TangentMarker {
    anchor: Coords2d,
    direction: Coords2d,
}

fn svg_tangent_markers(
    markers: &[TangentMarker],
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    if markers.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    for marker in markers {
        include_bounds_rect(
            bounds,
            Rect::around(marker.anchor, symbol_size(style) / 2.0, symbol_size(style) / 2.0).expand(style.layout_gap),
        );
        out.push_str(&svg_tangent_symbol(
            marker.anchor,
            marker.direction,
            bounds,
            layout,
            style,
        ));
    }
    out
}

fn tangent_symbol_anchors(
    input: &[ObjectId],
    object_lookup: &HashMap<ObjectId, &Object>,
    sketch_bounds: Option<Bounds>,
    style: ConstraintSvgStyle,
) -> Result<Vec<TangentMarker>> {
    if let Some((shared, first, second)) = shared_tangent_endpoint(input, object_lookup)? {
        let direction = segment_tangent_direction_at(object_lookup, first, shared)?
            .or(segment_tangent_direction_at(object_lookup, second, shared)?)
            .unwrap_or(Coords2d { x: 1.0, y: 0.0 });
        return Ok(vec![TangentMarker {
            anchor: offset_point_marker_anchor(shared, sketch_bounds, style),
            direction,
        }]);
    }

    input
        .iter()
        .map(|id| segment_anchor(object_lookup, *id))
        .zip(input.iter())
        .map(|(anchor, id)| {
            anchor.and_then(|anchor| {
                Ok(TangentMarker {
                    anchor: offset_point_marker_anchor(anchor, sketch_bounds, style),
                    direction: segment_tangent_direction_at(object_lookup, *id, anchor)?
                        .unwrap_or(Coords2d { x: 1.0, y: 0.0 }),
                })
            })
        })
        .collect()
}

fn shared_tangent_endpoint(
    input: &[ObjectId],
    object_lookup: &HashMap<ObjectId, &Object>,
) -> Result<Option<(Coords2d, ObjectId, ObjectId)>> {
    for (index, first) in input.iter().enumerate() {
        let first_endpoints = tangent_endpoints(object_lookup, *first)?;
        for second in input.iter().skip(index + 1) {
            let second_endpoints = tangent_endpoints(object_lookup, *second)?;
            for first_point in &first_endpoints {
                for second_point in &second_endpoints {
                    if distance(*first_point, *second_point) <= EPSILON {
                        return Ok(Some((midpoint(*first_point, *second_point), *first, *second)));
                    }
                }
            }
        }
    }
    Ok(None)
}

fn tangent_endpoints(object_lookup: &HashMap<ObjectId, &Object>, id: ObjectId) -> Result<Vec<Coords2d>> {
    let Some(object) = object_lookup.get(&id).copied() else {
        return Ok(Vec::new());
    };
    let ObjectKind::Segment { segment } = &object.kind else {
        return Ok(Vec::new());
    };
    match segment {
        Segment::Line(line) => Ok(vec![
            point_coords(object_lookup, line.start)?,
            point_coords(object_lookup, line.end)?,
        ]),
        Segment::Arc(arc) => Ok(vec![
            point_coords(object_lookup, arc.start)?,
            point_coords(object_lookup, arc.end)?,
        ]),
        _ => Ok(Vec::new()),
    }
}

fn segment_tangent_direction_at(
    object_lookup: &HashMap<ObjectId, &Object>,
    id: ObjectId,
    point: Coords2d,
) -> Result<Option<Coords2d>> {
    let Some(object) = object_lookup.get(&id).copied() else {
        return Ok(None);
    };
    let ObjectKind::Segment { segment } = &object.kind else {
        return Ok(None);
    };
    match segment {
        Segment::Line(line) => {
            let start = point_coords(object_lookup, line.start)?;
            let end = point_coords(object_lookup, line.end)?;
            let direction = unit(sub(end, start));
            Ok((length(direction) > EPSILON).then_some(direction))
        }
        Segment::Arc(arc) => {
            let center = point_coords(object_lookup, arc.center)?;
            let radius = unit(sub(point, center));
            let direction = perp(radius);
            Ok((length(direction) > EPSILON).then_some(direction))
        }
        Segment::Circle(circle) => {
            let center = point_coords(object_lookup, circle.center)?;
            let radius = unit(sub(point, center));
            let direction = perp(radius);
            Ok((length(direction) > EPSILON).then_some(direction))
        }
        _ => Ok(None),
    }
}

fn svg_tangent_symbol(
    anchor: Coords2d,
    direction: Coords2d,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    let anchor = layout.place_symbol(anchor, style);
    let size = symbol_size(style);
    include_bounds_rect(
        bounds,
        Rect::around(anchor, size / 2.0, size / 2.0).expand(style.layout_gap),
    );

    let direction = unit(direction);
    let direction = if length(direction) <= EPSILON {
        Coords2d { x: 1.0, y: 0.0 }
    } else {
        direction
    };
    let normal = perp(direction);
    let line_half = style.marker_radius * 0.52;
    let gap = style.marker_radius * 0.23;
    let stroke = style.marker_radius * 0.13;

    let mut out = String::new();
    out.push_str(
        r#"<g class="sketch-constraint-symbol sketch-constraint-symbol-tangent" vector-effect="non-scaling-stroke" opacity="0.58">"#,
    );
    for offset in [-gap, gap] {
        let center = add(anchor, scale(normal, offset));
        out.push_str(&svg_symbol_line(
            sub(center, scale(direction, line_half)),
            add(center, scale(direction, line_half)),
            stroke,
        ));
    }
    out.push_str("</g>");
    out
}

fn svg_marker(
    anchor: Coords2d,
    label: &str,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    let anchor = layout.place_marker(anchor, label, style);
    let width = marker_width(label, style);
    let height = marker_height(style);
    include_bounds_rect(
        bounds,
        Rect::around(anchor, width / 2.0, height / 2.0).expand(style.layout_gap),
    );
    let mut out = String::new();
    if label.chars().count() <= 1 {
        out.push_str(r#"<circle vector-effect="non-scaling-stroke" cx=""#);
        out.push_str(&fmt_num(anchor.x));
        out.push_str(r#"" cy=""#);
        out.push_str(&fmt_num(svg_y(anchor.y)));
        out.push_str(r#"" r=""#);
        out.push_str(&fmt_num(style.marker_radius));
        out.push_str(r#"" fill="none"/>"#);
    }
    out.push_str(&svg_text_at(anchor, label, style));
    out
}

fn svg_coincident_marker(anchor: Coords2d, radius: f64) -> String {
    let mut out = String::from(
        r#"<circle class="sketch-constraint-symbol sketch-constraint-symbol-coincident" vector-effect="non-scaling-stroke" opacity="0.32" cx=""#,
    );
    out.push_str(&fmt_num(anchor.x));
    out.push_str(r#"" cy=""#);
    out.push_str(&fmt_num(svg_y(anchor.y)));
    out.push_str(r#"" r=""#);
    out.push_str(&fmt_num(radius));
    out.push_str(r#"" fill="none" stroke-width="0.5"/>"#);
    out
}

fn svg_child_line(start: Coords2d, end: Coords2d, dashed: bool, style: ConstraintSvgStyle) -> String {
    let mut out = String::from(r#"<line vector-effect="non-scaling-stroke""#);
    if dashed {
        out.push_str(r#" stroke-dasharray=""#);
        out.push_str(&fmt_num(style.child_dash));
        out.push(' ');
        out.push_str(&fmt_num(style.child_dash));
        out.push('"');
    }
    out.push_str(r#" x1=""#);
    out.push_str(&fmt_num(start.x));
    out.push_str(r#"" y1=""#);
    out.push_str(&fmt_num(svg_y(start.y)));
    out.push_str(r#"" x2=""#);
    out.push_str(&fmt_num(end.x));
    out.push_str(r#"" y2=""#);
    out.push_str(&fmt_num(svg_y(end.y)));
    out.push_str(r#""/>"#);
    out
}

fn svg_symbol_line(start: Coords2d, end: Coords2d, stroke_width: f64) -> String {
    let mut out = String::from(r#"<line vector-effect="non-scaling-stroke" stroke="currentColor" stroke-width=""#);
    out.push_str(&fmt_num(stroke_width));
    out.push_str(r#"" x1=""#);
    out.push_str(&fmt_num(start.x));
    out.push_str(r#"" y1=""#);
    out.push_str(&fmt_num(svg_y(start.y)));
    out.push_str(r#"" x2=""#);
    out.push_str(&fmt_num(end.x));
    out.push_str(r#"" y2=""#);
    out.push_str(&fmt_num(svg_y(end.y)));
    out.push_str(r#""/>"#);
    out
}

fn svg_dimension_line(start: Coords2d, end: Coords2d, style: ConstraintSvgStyle) -> String {
    let mut out = String::new();
    out.push_str(&svg_child_line(start, end, false, style));
    let direction = unit(sub(end, start));
    if length(direction) <= EPSILON || distance(start, end) <= style.arrow_size * 4.0 {
        return out;
    }
    out.push_str(&svg_arrowhead(start, direction, style));
    out.push_str(&svg_arrowhead(end, scale(direction, -1.0), style));
    out
}

fn svg_arrowhead(tip: Coords2d, direction: Coords2d, style: ConstraintSvgStyle) -> String {
    let back = scale(direction, style.arrow_size);
    let wing = scale(perp(direction), style.arrow_size * 0.45);
    let left = add(add(tip, back), wing);
    let right = sub(add(tip, back), wing);
    let mut out = String::new();
    out.push_str(&svg_child_line(tip, left, false, style));
    out.push_str(&svg_child_line(tip, right, false, style));
    out
}

fn svg_witness_line(anchor: Coords2d, dimension_anchor: Coords2d, style: ConstraintSvgStyle) -> String {
    let anchor_to_dimension = sub(dimension_anchor, anchor);
    let direction = unit(anchor_to_dimension);
    if length(direction) <= EPSILON {
        return String::new();
    }

    let extension_start = add(anchor, scale(direction, style.extension_gap));
    let extension_end = add(dimension_anchor, scale(direction, style.extension_overshoot));
    let vector = sub(extension_end, extension_start);
    let length = length(vector);
    if length <= style.max_witness_length {
        return svg_child_line(extension_start, extension_end, true, style);
    }

    let near_anchor = add(extension_start, scale(direction, style.witness_length));
    let near_dimension = sub(extension_end, scale(direction, style.witness_length));
    let mut out = String::new();
    out.push_str(&svg_child_line(extension_start, near_anchor, true, style));
    out.push_str(&svg_child_line(near_dimension, extension_end, true, style));
    out
}

fn svg_text(
    anchor: Coords2d,
    label: &str,
    dx: f64,
    dy: f64,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    let preferred = Coords2d {
        x: anchor.x + dx,
        y: anchor.y - dy,
    };
    let anchor = layout.place_text(preferred, label, style);
    include_bounds_rect(
        bounds,
        Rect::around(anchor, text_width(label, style) / 2.0, text_height(style) / 2.0).expand(style.layout_gap),
    );
    svg_text_at(anchor, label, style)
}

fn svg_text_fixed(
    anchor: Coords2d,
    label: &str,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    layout.reserve_text(anchor, label, style);
    include_bounds_rect(
        bounds,
        Rect::around(anchor, text_width(label, style) / 2.0, text_height(style) / 2.0).expand(style.layout_gap),
    );
    svg_text_at(anchor, label, style)
}

fn svg_text_at(anchor: Coords2d, label: &str, style: ConstraintSvgStyle) -> String {
    let mut out = String::from(r#"<text fill="currentColor" stroke="white" stroke-width=""#);
    out.push_str(&fmt_num(style.text_halo));
    out.push_str(r#"" paint-order="stroke" font-size=""#);
    out.push_str(&fmt_num(style.font_size));
    out.push_str(r#"" text-anchor="middle" dominant-baseline="middle" x=""#);
    out.push_str(&fmt_num(anchor.x));
    out.push_str(r#"" y=""#);
    out.push_str(&fmt_num(svg_y(anchor.y)));
    out.push_str(r#"">"#);
    out.push_str(&escape_xml(label));
    out.push_str("</text>");
    out
}

fn svg_tick(line: (Coords2d, Coords2d), offset: f64, style: ConstraintSvgStyle) -> String {
    let mid = midpoint(line.0, line.1);
    let direction = unit(sub(line.1, line.0));
    let normal = perp(direction);
    let center = add(mid, scale(direction, offset));
    svg_child_line(
        add(center, scale(normal, style.tick_size)),
        add(center, scale(normal, -style.tick_size)),
        false,
        style,
    )
}

fn svg_parallel_ticks(line: (Coords2d, Coords2d), style: ConstraintSvgStyle) -> String {
    let mut out = String::new();
    out.push_str(&svg_tick(line, -style.tick_size * 0.8, style));
    out.push_str(&svg_tick(line, style.tick_size * 0.8, style));
    out
}

fn svg_right_angle(
    vertex: Coords2d,
    dir_a: Coords2d,
    dir_b: Coords2d,
    bounds: &mut Option<Bounds>,
    layout: &mut ConstraintLayout,
    style: ConstraintSvgStyle,
) -> String {
    let unit_a = unit(dir_a);
    let unit_b = unit(dir_b);
    if length(unit_a) <= EPSILON || length(unit_b) <= EPSILON {
        return String::new();
    }
    let size = style.right_angle_size;
    let corner_a = add(vertex, scale(unit_a, size));
    let corner = add(corner_a, scale(unit_b, size));
    let corner_b = add(vertex, scale(unit_b, size));

    let mut out = String::from(r#"<path vector-effect="non-scaling-stroke" d="M "#);
    push_path_point(&mut out, corner_a);
    out.push_str(" L ");
    push_path_point(&mut out, corner);
    out.push_str(" L ");
    push_path_point(&mut out, corner_b);
    out.push_str(r#""/>"#);
    out.push_str(&svg_text(corner, "90", 0.0, -style.text_offset, bounds, layout, style));
    out
}

fn push_path_point(out: &mut String, point: Coords2d) {
    out.push_str(&fmt_num(point.x));
    out.push(' ');
    out.push_str(&fmt_num(svg_y(point.y)));
}

fn include_constraint_bounds(bounds: &mut Option<Bounds>, anchor: Coords2d, style: ConstraintSvgStyle) {
    let pad = style.bounds_padding;
    include_bounds_point(
        bounds,
        Coords2d {
            x: anchor.x - pad,
            y: anchor.y - pad,
        },
    );
    include_bounds_point(
        bounds,
        Coords2d {
            x: anchor.x + pad,
            y: anchor.y + pad,
        },
    );
}

fn include_bounds_rect(bounds: &mut Option<Bounds>, rect: Rect) {
    include_bounds_point(
        bounds,
        Coords2d {
            x: rect.min_x,
            y: rect.min_y,
        },
    );
    include_bounds_point(
        bounds,
        Coords2d {
            x: rect.max_x,
            y: rect.max_y,
        },
    );
}

fn include_bounds_point(bounds: &mut Option<Bounds>, point: Coords2d) {
    if let Some(bounds) = bounds {
        bounds.include_point(point);
    } else {
        *bounds = Some(Bounds::new(point));
    }
}

fn include_bounds_circle(bounds: &mut Option<Bounds>, center: Coords2d, radius: f64) {
    include_bounds_point(
        bounds,
        Coords2d {
            x: center.x - radius,
            y: center.y - radius,
        },
    );
    if let Some(bounds) = bounds {
        bounds.include_circle(center, radius);
    }
}

fn include_arc_bounds(bounds: &mut Option<Bounds>, center: Coords2d, radius: f64, start: Coords2d, end: Coords2d) {
    include_bounds_point(bounds, start);
    include_bounds_point(bounds, end);

    let arc_start_angle = start_angle(center, start);
    let arc_end_angle = start_angle(center, end);
    for candidate in [
        0.0,
        std::f64::consts::FRAC_PI_2,
        std::f64::consts::PI,
        std::f64::consts::PI * 1.5,
    ] {
        if angle_on_ccw_sweep(arc_start_angle, arc_end_angle, candidate) {
            include_bounds_point(
                bounds,
                Coords2d {
                    x: center.x + radius * libm::cos(candidate),
                    y: center.y + radius * libm::sin(candidate),
                },
            );
        }
    }
}

fn sample_control_point_spline(points: &[Coords2d], degree: usize, samples_per_span: usize) -> Vec<Coords2d> {
    if points.len() < 2 {
        return points.to_vec();
    }
    let effective_degree = degree.max(1).min(points.len() - 1);
    if effective_degree == 1 {
        return points.to_vec();
    }

    let knots = build_open_uniform_knot_vector(points.len(), effective_degree);
    let span_count = (points.len() - effective_degree).max(1);
    let sample_count = (span_count * samples_per_span).max(2);
    let mut result = Vec::with_capacity(sample_count + 1);

    for index in 0..=sample_count {
        let u = if index == sample_count {
            1.0
        } else {
            index as f64 / sample_count as f64
        };
        result.push(de_boor_point(points, effective_degree, &knots, u));
    }

    result
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

fn de_boor_point(points: &[Coords2d], degree: usize, knots: &[f64], u: f64) -> Coords2d {
    let span = find_knot_span(u, degree, knots);
    let mut d = Vec::with_capacity(degree + 1);
    for offset in 0..=degree {
        d.push(points[span - degree + offset]);
    }

    for r in 1..=degree {
        for j in (r..=degree).rev() {
            let knot_index = span - degree + j;
            let denom = knots[knot_index + degree - r + 1] - knots[knot_index];
            let alpha = if denom == 0.0 {
                0.0
            } else {
                (u - knots[knot_index]) / denom
            };
            d[j] = Coords2d {
                x: (1.0 - alpha) * d[j - 1].x + alpha * d[j].x,
                y: (1.0 - alpha) * d[j - 1].y + alpha * d[j].y,
            };
        }
    }

    d[degree]
}

fn average_radius(center: Coords2d, start: Coords2d, end: Coords2d) -> f64 {
    (distance(center, start) + distance(center, end)) / 2.0
}

fn distance(a: Coords2d, b: Coords2d) -> f64 {
    libm::hypot(a.x - b.x, a.y - b.y)
}

fn midpoint(a: Coords2d, b: Coords2d) -> Coords2d {
    scale(add(a, b), 0.5)
}

fn average_points(points: &[Coords2d]) -> Coords2d {
    if points.is_empty() {
        return Coords2d { x: 0.0, y: 0.0 };
    }
    scale(
        points.iter().copied().fold(Coords2d { x: 0.0, y: 0.0 }, add),
        1.0 / points.len() as f64,
    )
}

fn add(a: Coords2d, b: Coords2d) -> Coords2d {
    Coords2d {
        x: a.x + b.x,
        y: a.y + b.y,
    }
}

fn sub(a: Coords2d, b: Coords2d) -> Coords2d {
    Coords2d {
        x: a.x - b.x,
        y: a.y - b.y,
    }
}

fn scale(point: Coords2d, scalar: f64) -> Coords2d {
    Coords2d {
        x: point.x * scalar,
        y: point.y * scalar,
    }
}

fn length(point: Coords2d) -> f64 {
    libm::hypot(point.x, point.y)
}

fn unit(point: Coords2d) -> Coords2d {
    let length = length(point);
    if length <= EPSILON {
        Coords2d { x: 0.0, y: 0.0 }
    } else {
        scale(point, 1.0 / length)
    }
}

fn perp(point: Coords2d) -> Coords2d {
    Coords2d {
        x: -point.y,
        y: point.x,
    }
}

fn number_label(number: Number) -> String {
    format_number_literal(number.value, number.units, Some(2)).unwrap_or_else(|_| fmt_num(number.value))
}

fn magnitude_label(number: Number) -> String {
    let mut number = number;
    number.value = number.value.abs();
    number_label(number)
}

fn angle_radians(number: Number) -> f64 {
    let radians = match number.units {
        NumericSuffix::Rad => number.value,
        // Solver angle constraints usually arrive in degrees; explicit `Angle` or
        // unitless values are rendered as degrees to match KCL's default angle unit.
        NumericSuffix::Deg | NumericSuffix::Angle | NumericSuffix::None => number.value.to_radians(),
        _ => number.value.to_radians(),
    };
    radians.abs().rem_euclid(std::f64::consts::TAU)
}

fn shared_or_intersection(line_a: (Coords2d, Coords2d), line_b: (Coords2d, Coords2d)) -> Option<Coords2d> {
    for point_a in [line_a.0, line_a.1] {
        for point_b in [line_b.0, line_b.1] {
            if distance(point_a, point_b) <= EPSILON {
                return Some(midpoint(point_a, point_b));
            }
        }
    }
    line_intersection(line_a, line_b)
}

fn line_intersection(line_a: (Coords2d, Coords2d), line_b: (Coords2d, Coords2d)) -> Option<Coords2d> {
    let a_direction = sub(line_a.1, line_a.0);
    let b_direction = sub(line_b.1, line_b.0);
    let denom = cross(a_direction, b_direction);
    if denom.abs() <= EPSILON {
        return None;
    }
    let t = cross(sub(line_b.0, line_a.0), b_direction) / denom;
    Some(add(line_a.0, scale(a_direction, t)))
}

fn cross(a: Coords2d, b: Coords2d) -> f64 {
    a.x * b.y - a.y * b.x
}

fn dot(a: Coords2d, b: Coords2d) -> f64 {
    a.x * b.x + a.y * b.y
}

fn direction_from_vertex(vertex: Coords2d, line: (Coords2d, Coords2d)) -> Coords2d {
    let to_start = sub(line.0, vertex);
    let to_end = sub(line.1, vertex);
    if length(to_start) > length(to_end) {
        to_start
    } else {
        to_end
    }
}

fn start_angle(center: Coords2d, point: Coords2d) -> f64 {
    libm::atan2(point.y - center.y, point.x - center.x)
}

fn ccw_sweep(start: f64, end: f64) -> f64 {
    (end - start).rem_euclid(std::f64::consts::TAU)
}

fn angle_on_ccw_sweep(start: f64, end: f64, candidate: f64) -> bool {
    ccw_sweep(start, candidate) <= ccw_sweep(start, end) + EPSILON
}

fn svg_y(y: f64) -> f64 {
    -y
}

fn round_float(value: f64) -> f64 {
    let rounded = (value * 1_000_000.0).round() / 1_000_000.0;
    if rounded == -0.0 { 0.0 } else { rounded }
}

fn fmt_num(value: f64) -> String {
    let rounded = round_float(value);
    if !rounded.is_finite() {
        return "0".to_owned();
    }
    let mut out = format!("{rounded:.6}");
    while out.contains('.') && out.ends_with('0') {
        out.pop();
    }
    if out.ends_with('.') {
        out.pop();
    }
    if out == "-0" { "0".to_owned() } else { out }
}

fn escape_xml(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn json_attr(value: &impl Serialize) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_owned())
}

#[cfg(test)]
mod tests {
    use kcl_error::SourceRange;
    use kittycad_modeling_cmds::units::UnitLength;

    use super::*;
    use crate::engine::PlaneName;
    use crate::frontend::api::FileId;
    use crate::frontend::api::Plane;
    use crate::frontend::api::ProjectId;
    use crate::frontend::api::Version;
    use crate::frontend::sketch::ConstraintSource;
    use crate::frontend::sketch::Freedom;
    use crate::frontend::sketch::LineCtor;
    use crate::frontend::sketch::PointCtor;
    use crate::frontend::sketch::SegmentCtor;
    use crate::frontend::sketch::Sketch;
    use crate::frontend::sketch::SketchCtor;

    fn number(value: f64) -> Number {
        Number::from((value, UnitLength::Millimeters))
    }

    fn angle_number(value: f64) -> Number {
        Number {
            value,
            units: NumericSuffix::Deg,
        }
    }

    fn point2d(x: f64, y: f64) -> Point2d<Number> {
        Point2d {
            x: number(x),
            y: number(y),
        }
    }

    fn object(id: usize, kind: ObjectKind) -> Object {
        Object {
            id: ObjectId(id),
            kind,
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::synthetic()),
        }
    }

    fn point_object(id: usize, x: f64, y: f64, owner: Option<ObjectId>) -> Object {
        object(
            id,
            ObjectKind::Segment {
                segment: Segment::Point(Point {
                    position: point2d(x, y),
                    ctor: Some(PointCtor {
                        position: Point2d {
                            x: crate::frontend::api::Expr::Number(number(x)),
                            y: crate::frontend::api::Expr::Number(number(y)),
                        },
                    }),
                    owner,
                    freedom: Freedom::Free,
                    constraints: Vec::new(),
                }),
            },
        )
    }

    fn line_object(id: usize, start: usize, end: usize, construction: bool) -> Object {
        object(
            id,
            ObjectKind::Segment {
                segment: Segment::Line(Line {
                    start: ObjectId(start),
                    end: ObjectId(end),
                    owner: None,
                    ctor: SegmentCtor::Line(LineCtor {
                        start: Point2d {
                            x: crate::frontend::api::Expr::Number(number(0.0)),
                            y: crate::frontend::api::Expr::Number(number(0.0)),
                        },
                        end: Point2d {
                            x: crate::frontend::api::Expr::Number(number(0.0)),
                            y: crate::frontend::api::Expr::Number(number(0.0)),
                        },
                        construction: None,
                    }),
                    ctor_applicable: true,
                    construction,
                }),
            },
        )
    }

    fn constraint_object(id: usize, constraint: Constraint) -> Object {
        object(id, ObjectKind::Constraint { constraint })
    }

    fn rectangle_scene_graph() -> SceneGraph {
        let sketch = object(
            1,
            ObjectKind::Sketch(Sketch {
                args: SketchCtor {
                    on: Plane::Default(PlaneName::Xy),
                },
                plane: ObjectId(0),
                segments: vec![
                    ObjectId(2),
                    ObjectId(3),
                    ObjectId(4),
                    ObjectId(5),
                    ObjectId(6),
                    ObjectId(7),
                    ObjectId(8),
                    ObjectId(9),
                    ObjectId(10),
                    ObjectId(11),
                    ObjectId(12),
                    ObjectId(13),
                ],
                constraints: vec![ObjectId(14), ObjectId(15), ObjectId(16)],
            }),
        );

        SceneGraph {
            project: ProjectId(0),
            file: FileId(0),
            version: Version(0),
            objects: vec![
                object(0, ObjectKind::Plane(Plane::Default(PlaneName::Xy))),
                sketch,
                point_object(2, -0.54, 0.34, Some(ObjectId(4))),
                point_object(3, 0.53, 0.34, Some(ObjectId(4))),
                line_object(4, 2, 3, false),
                point_object(5, 0.53, 0.34, Some(ObjectId(7))),
                point_object(6, 0.53, -0.36, Some(ObjectId(7))),
                line_object(7, 5, 6, false),
                point_object(8, 0.53, -0.36, Some(ObjectId(10))),
                point_object(9, -0.54, -0.36, Some(ObjectId(10))),
                line_object(10, 8, 9, false),
                point_object(11, -0.54, -0.36, Some(ObjectId(13))),
                point_object(12, -0.54, 0.34, Some(ObjectId(13))),
                line_object(13, 11, 12, false),
                constraint_object(
                    14,
                    Constraint::Coincident(Coincident {
                        segments: vec![ObjectId(3).into(), ObjectId(5).into()],
                    }),
                ),
                constraint_object(15, Constraint::Horizontal(Horizontal::Line { line: ObjectId(4) })),
                constraint_object(16, Constraint::Vertical(Vertical::Line { line: ObjectId(7) })),
            ],
            settings: Default::default(),
            sketch_mode: Some(ObjectId(1)),
        }
    }

    fn angle_scene_graph(angle_degrees: f64) -> SceneGraph {
        let end = angle_degrees.to_radians();
        let sketch = object(
            1,
            ObjectKind::Sketch(Sketch {
                args: SketchCtor {
                    on: Plane::Default(PlaneName::Xy),
                },
                plane: ObjectId(0),
                segments: vec![
                    ObjectId(2),
                    ObjectId(3),
                    ObjectId(4),
                    ObjectId(5),
                    ObjectId(6),
                    ObjectId(7),
                ],
                constraints: vec![ObjectId(8)],
            }),
        );

        SceneGraph {
            project: ProjectId(0),
            file: FileId(0),
            version: Version(0),
            objects: vec![
                object(0, ObjectKind::Plane(Plane::Default(PlaneName::Xy))),
                sketch,
                point_object(2, 0.0, 0.0, Some(ObjectId(4))),
                point_object(3, 1.0, 0.0, Some(ObjectId(4))),
                line_object(4, 2, 3, false),
                point_object(5, 0.0, 0.0, Some(ObjectId(7))),
                point_object(6, libm::cos(end), libm::sin(end), Some(ObjectId(7))),
                line_object(7, 5, 6, false),
                constraint_object(
                    8,
                    Constraint::Angle(Angle {
                        lines: vec![ObjectId(4), ObjectId(7)],
                        angle: angle_number(angle_degrees),
                        source: ConstraintSource::default(),
                    }),
                ),
            ],
            settings: Default::default(),
            sketch_mode: Some(ObjectId(1)),
        }
    }

    #[test]
    fn exports_rectangle_lines_from_scene_graph() {
        let export = export_sketch_svg(
            &rectangle_scene_graph(),
            SketchSvgOptions {
                include_points: false,
                include_constraints: false,
                padding: 0.0,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(export.sketch_id, ObjectId(1));
        assert_eq!(
            export.view_box,
            SketchSvgViewBox {
                min_x: -0.54,
                min_y: -0.34,
                width: 1.07,
                height: 0.7,
            }
        );
        assert!(export.svg.contains(r#"<line id="line-4""#));
        assert!(export.svg.contains(r#"x1="-0.54" y1="-0.34" x2="0.53" y2="-0.34""#));
        assert!(export.svg.contains(r#"x1="0.53" y1="0.36" x2="-0.54" y2="0.36""#));
        assert!(!export.svg.contains("sketch-point"));
    }

    #[test]
    fn includes_object_metadata_by_default() {
        let export = export_sketch_svg(&rectangle_scene_graph(), SketchSvgOptions::default()).unwrap();

        assert!(!export.svg.contains("sketch-point"));
        assert!(export.svg.contains(r#"data-object-id="4""#));
        assert!(export.svg.contains(r#"data-source-range=""#));
    }

    #[test]
    fn resolves_sketch_id_from_variable_name() {
        let program = Program::parse_no_errs(
            r#"foo = sketch(on = XY) {}
bar = sketch(on = XY) {}
"#,
        )
        .unwrap();
        let mut scene_graph = rectangle_scene_graph();
        let _foo_range = sketch_block_range_for_variable_name(&program, "foo").unwrap();
        let bar_range = sketch_block_range_for_variable_name(&program, "bar").unwrap();
        scene_graph.objects[1].source = SourceRef::new(bar_range, None);

        assert_eq!(
            sketch_id_for_variable_name(&program, &scene_graph, "bar").unwrap(),
            ObjectId(1)
        );
        sketch_id_for_variable_name(&program, &scene_graph, "foo").unwrap_err();
    }

    #[test]
    fn includes_points_when_requested() {
        let export = export_sketch_svg(
            &rectangle_scene_graph(),
            SketchSvgOptions {
                include_points: true,
                ..Default::default()
            },
        )
        .unwrap();

        assert!(export.svg.contains(r#"<path id="point-2""#));
    }

    #[test]
    fn exports_constraints_as_overlay_layer() {
        let export = export_sketch_svg(
            &rectangle_scene_graph(),
            SketchSvgOptions {
                include_points: false,
                padding: 0.0,
                ..Default::default()
            },
        )
        .unwrap();

        assert!(export.svg.contains("sketch-constraints"));
        assert!(export.svg.contains(r#"data-constraint-type="coincident""#));
        assert!(export.svg.contains(r#"data-constraint-type="horizontal""#));
        assert!(export.svg.contains(r#"data-constraint-type="vertical""#));
        assert!(export.svg.contains("sketch-constraint-symbol-horizontal"));
        assert!(export.svg.contains("sketch-constraint-symbol-vertical"));
        assert!(export.view_box.width < 2.0);
        assert!(export.view_box.height < 2.0);
    }

    #[test]
    fn acute_angle_constraint_uses_small_arc() {
        let export = export_sketch_svg(
            &angle_scene_graph(60.0),
            SketchSvgOptions {
                include_points: false,
                padding: 0.0,
                ..Default::default()
            },
        )
        .unwrap();

        let arc_start = export.svg.find(" A ").expect("angle arc should be present");
        let arc_end = export.svg[arc_start..]
            .find(r#""/>"#)
            .map(|index| arc_start + index)
            .expect("angle arc should close");
        let arc = &export.svg[arc_start..arc_end];
        assert!(
            arc.contains(" 0 0 0 "),
            "acute angle should use SVG large-arc=0 and CAD-CCW sweep=0: {arc}"
        );
    }
}
