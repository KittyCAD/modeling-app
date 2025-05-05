use std::io::Write;
use std::process::Command;
use std::process::Stdio;

use anyhow::Context;
use anyhow::Result;
use camino::Utf8Path;
use camino::Utf8PathBuf;

fn main() {
    if let Err(e) = run() {
        println!("{e}");
        std::process::exit(1);
    }
}

#[derive(Default, Copy, Clone, Eq, PartialEq)]
enum Mode {
    #[default]
    All,
    New,
}

fn run() -> Result<()> {
    let mut envs = std::env::args();
    envs.next();
    let Some(modeling_app_dir) = envs.next() else {
        anyhow::bail!("Must provide the modeling-app directory as the first arg");
    };
    let mode = envs.next().unwrap_or_default();
    let mode = match mode.as_str() {
        "all" => Mode::All,
        "new" => Mode::New,
        other => anyhow::bail!("Unknown mode '{other}', must be either 'all' or 'new')"),
    };
    let modeling_app_dir = Utf8PathBuf::from(modeling_app_dir);
    let book_dir = kcl_book_dir(modeling_app_dir);
    let files = read_markdown_files(&book_dir)?;
    let kcl_programs = files.flat_map(kcl_code_blocks);

    for code_block in kcl_programs {
        if let Some(name) = code_block.name {
            render_snapshot(code_block.contents, &name, book_dir.clone(), mode)?;
        }
    }
    Ok(())
}

/// Runs the KCL program via the `zoo` CLI, and writes the output PNG to the right
/// location within the book's images dir.
fn render_snapshot(program: String, name: &str, book_dir: Utf8PathBuf, mode: Mode) -> Result<()> {
    let mut png_dst = book_dir.clone();
    png_dst.push("images");
    png_dst.push("dynamic");
    png_dst.push(name);
    png_dst.set_extension("png");
    if mode == Mode::New && std::fs::exists(&png_dst)? {
        // PNG already exists, so skip it.
        return Ok(());
    }
    println!("Running {name}.kcl");
    let mut cmd = Command::new("zoo")
        .args(["kcl", "snapshot", "-", png_dst.as_ref()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("could not spawn 'zoo' cli");
    let mut cmd_stdin = cmd.stdin.take().expect("Could not open stdin");
    std::thread::spawn(move || {
        cmd_stdin
            .write_all(program.as_bytes())
            .expect("Failed to write to stdin");
    });
    let cmd_out = cmd.wait_with_output()?;
    if !cmd_out.stderr.is_empty() {
        println!("Stderr from {name}.kcl: {}", String::from_utf8_lossy(&cmd_out.stderr));
    }
    Ok(())
}

fn kcl_book_dir(mut modeling_app_dir: Utf8PathBuf) -> Utf8PathBuf {
    modeling_app_dir.push("kcl-book");
    modeling_app_dir.push("src");
    modeling_app_dir
}

fn read_markdown_files(book_dir: &Utf8Path) -> Result<impl Iterator<Item = Utf8PathBuf>> {
    let files = book_dir
        .read_dir_utf8()
        .context(format!("could not read dir {book_dir}"))?;

    let it = files
        .filter_map(|file| file.ok())
        .map(|file| file.path().to_path_buf())
        .filter(|file| {
            let Some(ext) = file.extension() else {
                return false;
            };
            ext == "md"
        });

    Ok(it)
}

#[derive(Default, Clone, Debug)]
struct CodeBlock {
    contents: String,
    name: Option<String>,
}

/// Extract all KCL code blocks from a Markdown file.
fn kcl_code_blocks(p: Utf8PathBuf) -> impl Iterator<Item = CodeBlock> {
    let file_contents = match std::fs::read_to_string(&p) {
        Ok(contents) => contents,
        Err(e) => {
            eprintln!("Error reading {p}: {e}");
            return Vec::new().into_iter();
        }
    };
    let mut blocks: Vec<CodeBlock> = Vec::new();
    let mut in_block = false;
    let mut curr_block = CodeBlock::default();
    for line in file_contents.lines() {
        if line.trim_start().starts_with("```kcl") {
            in_block = true;
            curr_block.name = line.strip_prefix("```kcl=").map(|s| s.to_owned());
            continue;
        }
        if line.trim() == "```" {
            in_block = false;
            blocks.push(curr_block.clone());
            curr_block = Default::default();
            continue;
        }
        if !in_block {
            continue;
        }
        curr_block.contents.push_str(line);
        curr_block.contents.push('\n');
    }
    blocks.into_iter()
}
