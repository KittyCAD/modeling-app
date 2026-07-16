use std::ops::Not;

use camino::Utf8Path;
use camino::Utf8PathBuf;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::id::ModelingCmdId;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::ok_response::output as mout;
use kittycad_modeling_cmds::shared::Point2d;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use tabled::Tabled;
use uuid::Uuid;

use crate::ExecutorContext;
use crate::KclValueView;
use crate::SourceRange;
use crate::execution::Segment;
use crate::execution::SegmentKind;
use crate::std::args::TyF64;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;

/// A simulation test.
#[derive(Debug, Clone)]
struct Test {
    /// The name of the test.
    program_name: String,
    /// The KCL file that's the entry point, e.g. "main.kcl", in the `input_dir`.
    entry_point: Utf8PathBuf,
    /// Input KCL files are in this directory.
    input_dir: Utf8PathBuf,
    /// Variable name of the profile to interrogate
    variable_name: String,
}

impl Test {
    fn new(program_name: &str, variable_name: &str) -> Self {
        Self {
            program_name: program_name.to_owned(),
            variable_name: variable_name.to_owned(),
            entry_point: Utf8Path::new("tests").join(program_name).join("input.kcl"),
            input_dir: Utf8Path::new("tests").join(program_name),
        }
    }

    /// Read in the entry point file and return its contents as a string.
    pub fn read(&self) -> String {
        std::fs::read_to_string(&self.entry_point)
            .unwrap_or_else(|e| panic!("Failed to read file: {} due to {e}", self.entry_point))
    }
}

async fn execute_test(test: &Test) {
    println!("Program: {}/{}", test.program_name, test.entry_point);
    let input = test.read();
    let ast = crate::Program::parse_no_errs(&input).unwrap();

    // Run the program.
    let exec_res = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute_and_snapshot_ast_with_open_context(
            ast.clone(),
            Some(test.entry_point.clone().into_std_path_buf()),
            false,
        )
    })
    .await;
    let (exec_state, ctx, env_ref, _png, _step) = exec_res.unwrap();

    let (outcome, _module_state, _responses) = exec_state
        .into_test_exec_outcome(env_ref, &ctx, test.input_dir.as_std_path())
        .await;

    // Find the sketch in program memory.
    let mut program_memory = outcome.variables;
    let variable_name = &test.variable_name;
    let Some(sketch) = program_memory.shift_remove(variable_name) else {
        panic!("No variable named {variable_name} found in program memory after execution");
    };
    let KclValueView::Object {
        value: kcl_object,
        constrainable: _,
        object_kind: _,
    } = sketch
    else {
        panic!("Expected {variable_name} to be an object");
    };

    // Find the sketch ID.
    let sketch_id = kcl_object
        .iter()
        .find_map(|(k, v)| {
            if k == "meta" {
                return None;
            }
            let KclValueView::Segment { value } = v else {
                return None;
            };
            let crate::execution::SegmentRepr::Solved { segment } = &value.repr else {
                return None;
            };
            Some(segment.sketch_id.to_string())
        })
        .unwrap();
    assert!(sketch_id.is_empty().not());

    // Query engine's view of the data.
    let engine_data = query_engine_endpoints(&ctx, sketch_id.parse::<Uuid>().unwrap()).await;

    // Look up all segments.
    let mut kcl_object_fields: Vec<_> = kcl_object.into_iter().collect();
    kcl_object_fields.sort_unstable_by(|(k, _v), (k2, _v2)| k.cmp(k2));
    let mut all_segments: Vec<SegmentDisplay> = Vec::with_capacity(kcl_object_fields.len() * SegmentDisplay::LENGTH);
    for (k, v) in kcl_object_fields {
        if k == "meta" {
            continue;
        }
        let KclValueView::Segment { value } = v else {
            panic!("Expected {variable_name}.{k} to be a segment");
        };
        let crate::execution::SegmentRepr::Solved { segment } = value.repr else {
            panic!("Expected {variable_name}.{k} to be solved");
        };

        let Some(disp) = segment_kind_display(segment, &k, &engine_data).await else {
            continue;
        };
        all_segments.push(disp);
    }

    let tbl = {
        use tabled::Table;
        use tabled::settings::Style;
        let mut table = Table::new(all_segments);
        table.with(Style::sharp());
        table
    };
    println!("Sketch name: {}", variable_name);
    println!("Sketch ID: {}", sketch_id);
    println!("Regions: {}", engine_data.region_count);
    println!("{tbl}");
    println!("Regions as OBJ:\n{}", engine_data.region_obj);
    ctx.close().await;
}

async fn segment_kind_display(
    segment: Box<Segment>,
    segment_name: &str,
    engine_data: &mout::SketchGetInfo,
) -> Option<SegmentDisplay> {
    let human_friendly_segment_kind = segment.kind.human_friendly_type();
    let segment_id = segment.id;
    let (kcl_start, kcl_end) = match segment.kind {
        SegmentKind::Point { .. } | SegmentKind::ControlPointSpline { .. } => {
            return None;
        }
        SegmentKind::Line {
            start,
            end,
            construction,
            ..
        } => {
            if construction {
                return None;
            }
            (start, Some(end))
        }
        SegmentKind::Arc {
            start,
            end,
            construction,
            ..
        } => {
            if construction {
                return None;
            }
            (start, Some(end))
        }
        SegmentKind::Circle {
            start, construction, ..
        } => {
            if construction {
                return None;
            }
            (start, None)
        }
    };
    let engine_curve = engine_data
        .curves
        .iter()
        .find(|curve| curve.id == segment_id.into())
        .expect("Could not find KCL segment in engine segment list");
    Some(SegmentDisplay {
        segment_name: segment_name.to_owned(),
        segment_kind: human_friendly_segment_kind,
        segment_id,
        kcl_start: Some(kcl_start),
        kcl_end,
        engine_start: engine_curve.start,
        engine_end: engine_curve.end,
        engine_center: engine_curve.center,
        engine_midpoint: engine_curve.mid,
    })
}

async fn query_engine_endpoints(ctx: &ExecutorContext, path_id: Uuid) -> mout::SketchGetInfo {
    let req_body = mcmd::SketchGetInfo::builder()
        .path_id(ModelingCmdId::from(path_id))
        .build();
    let response = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            uuid::Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(req_body),
        )
        .await
        .unwrap_or_else(|err| panic!("Failed to get engine endpoints for sketch: {err}"));
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::SketchGetInfo(engine_data),
    } = response
    else {
        panic!("Expected SketchGetInfo, got {response:#?}");
    };

    engine_data
}

/// Represents all the data we need to display a segment.
/// Everything a user might care to know about the segment.
struct SegmentDisplay {
    segment_name: String,
    segment_kind: &'static str,
    segment_id: Uuid,
    kcl_start: Option<[TyF64; 2]>,
    kcl_end: Option<[TyF64; 2]>,
    engine_start: Option<Point2d<f64>>,
    engine_end: Option<Point2d<f64>>,
    engine_center: Option<Point2d<f64>>,
    engine_midpoint: Option<Point2d<f64>>,
}

impl tabled::Tabled for SegmentDisplay {
    const LENGTH: usize = 9;

    fn fields(&self) -> Vec<std::borrow::Cow<'_, str>> {
        vec![
            self.segment_name.as_str().into(),
            self.segment_kind.into(),
            self.segment_id.to_string().into(),
            print_point(&self.kcl_start).into(),
            print_point(&self.kcl_end).into(),
            print_engine_point(&self.engine_start).into(),
            print_engine_point(&self.engine_end).into(),
            print_engine_point(&self.engine_center).into(),
            print_engine_point(&self.engine_midpoint).into(),
        ]
    }

    fn headers() -> Vec<std::borrow::Cow<'static, str>> {
        vec![
            "Name".into(),
            "Kind".into(),
            "ID".into(),
            "KCL start".into(),
            "KCL end".into(),
            "Engine start".into(),
            "Engine end".into(),
            "Engine center".into(),
            "Engine midpoint".into(),
        ]
    }
}

fn print_point(point: &Option<[TyF64; 2]>) -> String {
    let Some([x, y]) = point else {
        return String::new();
    };
    let x = x.to_mm();
    let y = y.to_mm();
    format!("({x}, {y})")
}

fn print_engine_point(point: &Option<Point2d<f64>>) -> String {
    match point {
        None => String::new(),
        Some(point) => format!("({}, {})", point.x, point.y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn simple_rectangle() {
        let test = Test::new("rectangle", "sketch001");
        execute_test(&test).await;
    }
}
