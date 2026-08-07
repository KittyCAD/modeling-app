use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;

use super::render::dof_color;
use super::*;
use crate::ExecOutcome;
use crate::ExecutorContext;
use crate::ExecutorSettings;
use crate::Program;
use crate::SourceRange;
use crate::TypedPath;
use crate::execution::ArtifactId;
use crate::execution::MockConfig;
use crate::front::Arc;
use crate::front::ArcCtor;
use crate::front::ArcDirection;
use crate::front::Circle;
use crate::front::CircleCtor;
use crate::front::Coincident;
use crate::front::Constraint;
use crate::front::ControlPointSpline;
use crate::front::ControlPointSplineCtor;
use crate::front::Expr;
use crate::front::Freedom;
use crate::front::Line;
use crate::front::LineCtor;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::front::Plane;
use crate::front::Point;
use crate::front::Point2d;
use crate::front::PointCtor;
use crate::front::Segment;
use crate::front::SegmentCtor;
use crate::front::Sketch;
use crate::front::SketchCtor;
use crate::front::SourceRef;
use crate::frontend::sketch::ConstraintSegment;
use crate::pretty::NumericSuffix;

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
        Some(dof_color(Some(Freedom::Free), SketchVisualizationTheme::Dark).to_hex_string())
    );
    assert!(visualization.png.starts_with(b"\x89PNG\r\n\x1a\n"));
}

#[test]
fn ids_color_scheme_omits_redundant_rendered_colors() {
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
        assert!(segment.rendered_color.is_none());
        assert!(visualization.data.id_color_map.contains_key(&segment.id));
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
            .join("sketch_visualizer")
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
    settings.set_snapshot_path(Path::new("..").join("..").join("..").join(&output_dir));
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
    let outcome = ctx
        .run_mock(
            &program,
            &MockConfig {
                use_prev_memory: false,
                ..Default::default()
            },
        )
        .await
        .unwrap_or_else(|err| panic!("failed to execute `{}`: {err:?}", input_path.display()));
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
