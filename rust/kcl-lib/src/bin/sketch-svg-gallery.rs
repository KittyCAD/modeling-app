use std::env;
use std::ffi::OsStr;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;
use chrono::Utc;
use kcl_lib::ExecutorContext;
use kcl_lib::ExecutorSettings;
use kcl_lib::MockConfig;
use kcl_lib::Program;
use kcl_lib::TypedPath;
use kcl_lib::front::FileId;
use kcl_lib::front::ObjectId;
use kcl_lib::front::ObjectKind;
use kcl_lib::front::ProjectId;
use kcl_lib::front::SceneGraph;
use kcl_lib::front::SketchSvgBounds;
use kcl_lib::front::SketchSvgMode;
use kcl_lib::front::SketchSvgOptions;
use kcl_lib::front::SketchSvgQuality;
use kcl_lib::front::SketchSvgViewBox;
use kcl_lib::front::Version;
use kcl_lib::front::export_sketch_svg;
use serde::Serialize;
use walkdir::WalkDir;

#[derive(Debug)]
struct Args {
    inputs: Vec<PathBuf>,
    out_dir: PathBuf,
    include_points: bool,
    include_control_polygon: bool,
    include_constraints: bool,
    mode: SketchSvgMode,
}

impl Args {
    fn parse() -> Result<Self> {
        let mut inputs = Vec::new();
        let mut out_dir = PathBuf::from("target/sketch-svg-gallery");
        let mut include_points = false;
        let mut include_control_polygon = true;
        let mut include_constraints = true;
        let mut mode = SketchSvgMode::Agent;

        let mut args = env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => {
                    print_usage();
                    std::process::exit(0);
                }
                "-i" | "--input" => {
                    let value = args.next().context("--input requires a path")?;
                    inputs.push(PathBuf::from(value));
                }
                "-o" | "--out" => {
                    let value = args.next().context("--out requires a path")?;
                    out_dir = PathBuf::from(value);
                }
                "--hide-points" => include_points = false,
                "--show-points" => include_points = true,
                "--hide-control-polygon" => include_control_polygon = false,
                "--hide-constraints" => include_constraints = false,
                "--mode" => {
                    let value = args.next().context("--mode requires drawing, agent, or constraints")?;
                    mode = parse_mode(&value)?;
                }
                "--drawing" => mode = SketchSvgMode::Drawing,
                "--agent" => mode = SketchSvgMode::Agent,
                "--constraints" => mode = SketchSvgMode::Constraints,
                value if value.starts_with('-') => anyhow::bail!("Unknown option: {value}"),
                value => inputs.push(PathBuf::from(value)),
            }
        }

        if inputs.is_empty() {
            anyhow::bail!("Provide at least one KCL file or directory with --input <path>");
        }

        Ok(Self {
            inputs,
            out_dir,
            include_points,
            include_control_polygon,
            include_constraints,
            mode,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryManifest {
    generated_at: String,
    inputs: Vec<String>,
    output_dir: String,
    totals: GalleryTotals,
    files: Vec<FileReport>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryTotals {
    files: usize,
    files_with_sketches: usize,
    sketches: usize,
    sketches_with_warnings: usize,
    quality_warnings: usize,
    parse_failures: usize,
    execution_failures: usize,
    export_failures: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileReport {
    input_path: String,
    status: FileStatus,
    parse_issues: Vec<String>,
    execution_error: Option<String>,
    sketches: Vec<SketchReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum FileStatus {
    Exported,
    NoSketches,
    ParseFailed,
    ExecutionFailed,
    ExportFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SketchReport {
    sketch_id: usize,
    svg_path: String,
    view_box: SketchSvgViewBox,
    bounds: SketchSvgBounds,
    quality: Option<SketchSvgQuality>,
    export_error: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse()?;
    let files = collect_kcl_files(&args.inputs)?;
    let svg_dir = args.out_dir.join("svg");
    if svg_dir.exists() {
        fs::remove_dir_all(&svg_dir)
            .with_context(|| format!("Failed to clear previous SVG output directory {}", svg_dir.display()))?;
    }
    fs::create_dir_all(&svg_dir)
        .with_context(|| format!("Failed to create SVG output directory {}", svg_dir.display()))?;

    let mut reports = Vec::with_capacity(files.len());
    let mut totals = GalleryTotals {
        files: files.len(),
        ..Default::default()
    };

    for (file_index, path) in files.iter().enumerate() {
        let report = process_file(file_index, path, &args, &svg_dir).await;
        match &report.status {
            FileStatus::Exported => {
                totals.files_with_sketches += 1;
            }
            FileStatus::NoSketches => {}
            FileStatus::ParseFailed => totals.parse_failures += 1,
            FileStatus::ExecutionFailed => totals.execution_failures += 1,
            FileStatus::ExportFailed => totals.export_failures += 1,
        }
        totals.sketches += report
            .sketches
            .iter()
            .filter(|sketch| sketch.export_error.is_none())
            .count();
        for sketch in &report.sketches {
            if let Some(quality) = &sketch.quality
                && !quality.warnings.is_empty()
            {
                totals.sketches_with_warnings += 1;
                totals.quality_warnings += quality.warnings.len();
            }
        }
        reports.push(report);
    }

    let manifest = GalleryManifest {
        generated_at: Utc::now().to_rfc3339(),
        inputs: args
            .inputs
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        output_dir: args.out_dir.to_string_lossy().into_owned(),
        totals,
        files: reports,
    };

    let manifest_path = args.out_dir.join("manifest.json");
    let index_path = args.out_dir.join("index.html");
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
        .with_context(|| format!("Failed to write {}", manifest_path.display()))?;
    fs::write(&index_path, render_index(&manifest))
        .with_context(|| format!("Failed to write {}", index_path.display()))?;

    println!(
        "Wrote {} SVGs for {} files to {}",
        manifest.totals.sketches,
        manifest.totals.files,
        args.out_dir.display()
    );
    println!("Open {}", index_path.display());

    Ok(())
}

async fn process_file(file_index: usize, path: &Path, args: &Args, svg_dir: &Path) -> FileReport {
    let input_path = path.to_string_lossy().into_owned();
    let source = match fs::read_to_string(path) {
        Ok(source) => source,
        Err(err) => {
            return FileReport {
                input_path,
                status: FileStatus::ParseFailed,
                parse_issues: vec![format!("Could not read file: {err}")],
                execution_error: None,
                sketches: Vec::new(),
            };
        }
    };

    let (program, parse_issues) = match Program::parse(&source) {
        Ok((program, issues)) => (program, issues),
        Err(err) => {
            return FileReport {
                input_path,
                status: FileStatus::ParseFailed,
                parse_issues: vec![truncate(&err.to_string(), 4_000)],
                execution_error: None,
                sketches: Vec::new(),
            };
        }
    };
    let parse_issues = parse_issues
        .into_iter()
        .map(|issue| {
            truncate(
                &format!("{:?} {:?}: {}", issue.severity, issue.source_range, issue.message),
                4_000,
            )
        })
        .collect::<Vec<_>>();

    let Some(program) = program else {
        return FileReport {
            input_path,
            status: FileStatus::ParseFailed,
            parse_issues,
            execution_error: Some("Parser returned no program".to_owned()),
            sketches: Vec::new(),
        };
    };

    let project_directory = path
        .parent()
        .map(|path| TypedPath::new(path.to_string_lossy().as_ref()));
    let current_file = Some(TypedPath::new(path.to_string_lossy().as_ref()));
    let ctx = ExecutorContext::new_mock(Some(ExecutorSettings {
        project_directory,
        current_file,
        ..Default::default()
    }))
    .await;
    let mock_config = MockConfig {
        use_prev_memory: false,
        ..Default::default()
    };
    let outcome = match ctx.run_mock(&program, &mock_config).await {
        Ok(outcome) => outcome,
        Err(err) => {
            ctx.close().await;
            return FileReport {
                input_path,
                status: FileStatus::ExecutionFailed,
                parse_issues,
                execution_error: Some(truncate(&err.to_string(), 8_000)),
                sketches: Vec::new(),
            };
        }
    };
    ctx.close().await;

    let scene_graph = SceneGraph {
        project: ProjectId(0),
        file: FileId(file_index),
        version: Version(0),
        objects: outcome.scene_objects,
        settings: Default::default(),
        sketch_mode: None,
    };
    let sketch_ids = scene_graph
        .objects
        .iter()
        .filter_map(|object| matches!(object.kind, ObjectKind::Sketch(_)).then_some(object.id))
        .collect::<Vec<_>>();

    if sketch_ids.is_empty() {
        return FileReport {
            input_path,
            status: FileStatus::NoSketches,
            parse_issues,
            execution_error: None,
            sketches: Vec::new(),
        };
    }

    let mut sketches = Vec::with_capacity(sketch_ids.len());
    for sketch_id in sketch_ids {
        sketches.push(export_sketch(file_index, path, svg_dir, &scene_graph, sketch_id, args));
    }
    let status = if sketches.iter().all(|sketch| sketch.export_error.is_none()) {
        FileStatus::Exported
    } else {
        FileStatus::ExportFailed
    };

    FileReport {
        input_path,
        status,
        parse_issues,
        execution_error: None,
        sketches,
    }
}

fn export_sketch(
    file_index: usize,
    path: &Path,
    svg_dir: &Path,
    scene_graph: &SceneGraph,
    sketch_id: ObjectId,
    args: &Args,
) -> SketchReport {
    let options = SketchSvgOptions {
        sketch_id: Some(sketch_id),
        include_points: args.include_points,
        include_control_polygon: args.include_control_polygon,
        include_constraints: args.include_constraints,
        mode: args.mode,
        ..Default::default()
    };

    match export_sketch_svg(scene_graph, options) {
        Ok(export) => {
            let file_name = format!("{file_index:04}_{}__sketch-{}.svg", sanitize_path(path), sketch_id.0);
            let relative_path = PathBuf::from("svg").join(&file_name);
            let output_path = svg_dir.join(file_name);
            let write_result = fs::write(&output_path, export.svg);
            SketchReport {
                sketch_id: sketch_id.0,
                svg_path: relative_path.to_string_lossy().into_owned(),
                view_box: export.view_box,
                bounds: export.bounds,
                quality: Some(export.quality),
                export_error: write_result
                    .err()
                    .map(|err| format!("Failed to write {}: {err}", output_path.display())),
            }
        }
        Err(err) => SketchReport {
            sketch_id: sketch_id.0,
            svg_path: String::new(),
            view_box: SketchSvgViewBox {
                min_x: 0.0,
                min_y: 0.0,
                width: 0.0,
                height: 0.0,
            },
            bounds: SketchSvgBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 0.0,
                max_y: 0.0,
            },
            quality: None,
            export_error: Some(err.msg),
        },
    }
}

fn parse_mode(value: &str) -> Result<SketchSvgMode> {
    match value {
        "drawing" => Ok(SketchSvgMode::Drawing),
        "agent" => Ok(SketchSvgMode::Agent),
        "constraints" | "constraint" | "debug" => Ok(SketchSvgMode::Constraints),
        _ => anyhow::bail!("Unknown mode {value:?}; expected drawing, agent, or constraints"),
    }
}

fn collect_kcl_files(inputs: &[PathBuf]) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for input in inputs {
        if input.is_file() {
            if is_kcl_file(input) {
                files.push(input.clone());
            }
            continue;
        }
        if input.is_dir() {
            for entry in WalkDir::new(input).follow_links(true) {
                let entry = entry.with_context(|| format!("Failed to walk {}", input.display()))?;
                let path = entry.path();
                if entry.file_type().is_file() && is_kcl_file(path) {
                    files.push(path.to_path_buf());
                }
            }
            continue;
        }
        anyhow::bail!("Input path does not exist: {}", input.display());
    }
    files.sort();
    files.dedup();
    Ok(files)
}

fn is_kcl_file(path: &Path) -> bool {
    path.extension() == Some(OsStr::new("kcl"))
}

fn render_index(manifest: &GalleryManifest) -> String {
    let mut out = String::new();
    out.push_str(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KCL Sketch SVG Gallery</title>
<style>
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
header { padding: 20px 24px 12px; border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); }
h1 { margin: 0 0 8px; font-size: 20px; font-weight: 650; }
.summary { display: flex; flex-wrap: wrap; gap: 8px; color: color-mix(in srgb, CanvasText 72%, transparent); font-size: 13px; }
.summary span { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 999px; padding: 4px 9px; }
main { padding: 20px 24px 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; align-items: start; }
.card { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 8px; overflow: hidden; background: color-mix(in srgb, Canvas 94%, CanvasText 6%); }
.meta { padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); font-size: 12px; display: grid; gap: 4px; }
.path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.status { color: color-mix(in srgb, CanvasText 70%, transparent); }
.preview { background: white; min-height: 260px; display: grid; place-items: center; }
.preview object { width: 100%; height: 320px; display: block; }
.error { padding: 12px; color: #a40000; background: color-mix(in srgb, #ffdddd 55%, Canvas); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
details { padding: 0 12px 12px; font-size: 12px; }
summary { cursor: pointer; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
</head>
<body>
"#,
    );
    out.push_str("<header><h1>KCL Sketch SVG Gallery</h1><div class=\"summary\">");
    out.push_str(&format!(
        "<span>{} files</span><span>{} files with sketches</span><span>{} sketches</span><span>{} sketches with warnings</span><span>{} quality warnings</span><span>{} parse failures</span><span>{} execution failures</span><span>{} export failures</span>",
        manifest.totals.files,
        manifest.totals.files_with_sketches,
        manifest.totals.sketches,
        manifest.totals.sketches_with_warnings,
        manifest.totals.quality_warnings,
        manifest.totals.parse_failures,
        manifest.totals.execution_failures,
        manifest.totals.export_failures,
    ));
    out.push_str("</div></header><main>");

    for file in &manifest.files {
        if file.sketches.is_empty() {
            out.push_str("<section class=\"card\" data-status=\"");
            out.push_str(file_status_label(&file.status));
            out.push_str("\"><div class=\"meta\">");
            out.push_str(&format!(
                "<div class=\"path\">{}</div><div class=\"status\">{}</div>",
                escape_html(&file.input_path),
                file_status_label(&file.status)
            ));
            out.push_str("</div>");
            if let Some(error) = &file.execution_error {
                out.push_str(&format!("<div class=\"error\">{}</div>", escape_html(error)));
            }
            append_parse_issues(&mut out, &file.parse_issues);
            out.push_str("</section>");
            continue;
        }

        for sketch in &file.sketches {
            out.push_str("<section class=\"card\"");
            if let Some(quality) = &sketch.quality {
                out.push_str(" data-quality-score=\"");
                out.push_str(&quality.score.to_string());
                out.push_str("\" data-quality-warnings=\"");
                out.push_str(&quality.warnings.len().to_string());
                out.push('"');
            }
            out.push_str("><div class=\"meta\">");
            out.push_str(&format!(
                "<div class=\"path\">{}</div><div class=\"status\">sketch {} · {:?} · viewBox {} {} {} {}</div>",
                escape_html(&file.input_path),
                sketch.sketch_id,
                file.status,
                sketch.view_box.min_x,
                sketch.view_box.min_y,
                sketch.view_box.width,
                sketch.view_box.height,
            ));
            if let Some(quality) = &sketch.quality {
                out.push_str(&format!(
                    "<div class=\"status\">quality {} · {} visible / {} hidden constraints · {} annotations</div>",
                    quality.score, quality.visible_constraints, quality.hidden_constraints, quality.annotation_count,
                ));
                append_quality_warnings(&mut out, quality);
            }
            out.push_str("</div>");
            if let Some(error) = &sketch.export_error {
                out.push_str(&format!("<div class=\"error\">{}</div>", escape_html(error)));
            } else {
                out.push_str("<div class=\"preview\"><object type=\"image/svg+xml\" data=\"");
                out.push_str(&escape_html(&sketch.svg_path));
                out.push_str("\"></object></div>");
            }
            append_parse_issues(&mut out, &file.parse_issues);
            out.push_str("</section>");
        }
    }

    out.push_str("</main></body></html>\n");
    out
}

fn append_parse_issues(out: &mut String, issues: &[String]) {
    if issues.is_empty() {
        return;
    }
    out.push_str(&format!("<details><summary>{} parse issue(s)</summary>", issues.len()));
    for issue in issues {
        out.push_str("<pre>");
        out.push_str(&escape_html(issue));
        out.push_str("</pre>");
    }
    out.push_str("</details>");
}

fn append_quality_warnings(out: &mut String, quality: &SketchSvgQuality) {
    if quality.warnings.is_empty() {
        return;
    }
    out.push_str(&format!(
        "<details><summary>{} quality warning(s)</summary>",
        quality.warnings.len()
    ));
    for warning in &quality.warnings {
        out.push_str("<pre>");
        out.push_str(&escape_html(warning));
        out.push_str("</pre>");
    }
    out.push_str("</details>");
}

fn file_status_label(status: &FileStatus) -> &'static str {
    match status {
        FileStatus::Exported => "Exported",
        FileStatus::NoSketches => "No frontend sketch-block scene objects",
        FileStatus::ParseFailed => "ParseFailed",
        FileStatus::ExecutionFailed => "ExecutionFailed",
        FileStatus::ExportFailed => "ExportFailed",
    }
}

fn print_usage() {
    eprintln!(
        "Usage: sketch-svg-gallery --input <file-or-dir> [--input <file-or-dir> ...] --out <dir>\n\
         \n\
         Options:\n\
           -i, --input <path>          KCL file or directory to scan recursively\n\
           -o, --out <dir>            Output directory (default: target/sketch-svg-gallery)\n\
               --mode <mode>          SVG mode: agent, drawing, or constraints (default: agent)\n\
               --agent                Agent mode: clean visual layers with hidden solver metadata\n\
               --drawing              Human drawing mode\n\
               --constraints          Show solver constraint layer for debugging\n\
               --show-points          Render sketch point handles\n\
               --hide-points          Do not render sketch point handles (default)\n\
               --hide-control-polygon Do not render owned/control polygon lines\n\
               --hide-constraints     Do not render constraint glyphs\n"
    );
}

fn sanitize_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut out = String::with_capacity(raw.len());
    for character in raw.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
            out.push(character);
        } else {
            out.push('_');
        }
    }
    out.trim_end_matches(".kcl")
        .trim_matches(|character| character == '_' || character == '.')
        .to_owned()
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn truncate(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        value.to_owned()
    } else {
        let end = value
            .char_indices()
            .map(|(index, _)| index)
            .take_while(|index| *index <= max_len)
            .last()
            .unwrap_or(0);
        format!("{}...", &value[..end])
    }
}
