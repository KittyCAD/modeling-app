# `transpile`

`transpile` is a developer CLI for migrating older Sketch V1 KCL into Sketch V2 KCL. There is one subcommand for each task 

1. Convert a file to Sketch V2. Does not validate or run the resulting code may or may not run succesfully 
2. Run a converted file. Attempts to run the converted Sketch V2 file to see if it builds. Does not validate the output. 
3. Render a converted file. Will evaluate and create an image of the result. Does not verify correctness with the corresponindg V1 code. 
4. Compare a converted file's output. Will evaluage, create images for both V1 and V2 code. The comparison uses the same scaffolding as our sim tests. 

The commands are stacked--issuing a run subcommand will first complete a convert, issue a render subcommand will first run convert, then run and then render. 


Current status:

- `convert` is implemented
- `run` is implemented
- `render` is not implemented yet
- `compare` is not implemented yet

## Build

From `rust/`

```bash
cargo build -p kcl-lib --bin transpile
```

Or run it directly with Cargo:

```bash
cargo run -p kcl-lib --bin transpile -- --help
```

## Commands

```text
transpile convert <input> [OPTIONS]
transpile run <input> -o <DIR> [OPTIONS]
transpile render <input> [OPTIONS]
transpile compare <input> [OPTIONS]
```

There is no legacy bare `transpile <input>` mode anymore.

## Common Behavior

- `input` may be a `.kcl` file or a directory
- for non-recursive commands, a directory input resolves to `main.kcl`
- recursive mode processes every `.kcl` file under the input root
- `--ignore-file` uses `.gitignore`-like matching
- `-k, --keep-going` is only valid with `--recursive`
- `--report-file` is only valid with `--recursive`
- `-j, --json` is parsed but not implemented yet
- `-q, --quiet` suppresses CLI progress/report output, but not lower-level engine messages

## `convert`

`convert` transpiles Sketch V1 KCL to Sketch V2 KCL.

Single-file behavior:

- without `-o`, writes transpiled KCL to stdout
- with `-o`, writes the transpiled file into the output directory
- the transpiled file keeps the same filename as the input

Recursive behavior:

- requires `-r, --recursive`
- requires `-o, --out-dir`
- mirrors the input tree under `--out-dir`
- writes a grouped text report to stderr
- optionally writes the same report to `--report-file`

Example:

```bash
cargo run -p kcl-lib --bin transpile -- convert public/kcl-samples/cone
```

Example output:

```kcl
// Cone
// A cone is defined by it's diameter and height.
// Categories: Maker

@settings(defaultLengthUnit = mm, experimentalFeatures = allow)

diameter = 10
height = 10

sketch = startSketchOn(XY)

profile = sketch(on = sketch) {
  line1 = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
  line2 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 5mm, var 0mm], end = [var 0mm, var 10mm])
  coincident([line2.end, line3.start])
  vertical(line1)
  horizontal(line2)
}

region001 = region(segments = [profile.line1, profile.line2])
cone = revolve(region001, axis = Y, angle = 360.0)
```

Recursive example:

```bash
cargo run -p kcl-lib --bin transpile -- \
  convert public/kcl-samples \
  -r \
  -k \
  -o /tmp/transpile-convert \
  --report-file /tmp/transpile-convert/report.txt
```

Example report:

```text
Processed: 8
Succeeded: 7
Convert failed: 1

Convert failed
- battery-module-cooling-plate/main.kcl: Execution error for `.../battery-module-cooling-plate/main.kcl`: Internal { ... }
```

## `run`

`run` transpiles to Sketch V2, persists the transpiled KCL, then executes the transpiled result.

Single-file behavior:

- requires `-o, --out-dir`
- writes the transpiled KCL into `--out-dir`
- writes `run-log.txt`

`run-log.txt` contains either:

- `success`
- or a failure marker plus the error text

Recursive behavior:

- requires `-r, --recursive`
- requires `-o, --out-dir`
- mirrors transpiled KCL under `--out-dir`
- writes one log per processed file using `<stem>-run-log.txt`
- writes grouped `Convert failed` and `Run failed` summaries
- optionally writes the same report to `--report-file`

The V2 execution path uses the same `ExecutorSettings` shape as the transpiler's execution pass.

Single-file example:

```bash
cargo run -p kcl-lib --bin transpile -- \
  run public/kcl-samples/cone \
  -o /tmp/transpile-run-one
```

Example output files:

```text
/tmp/transpile-run-one/main.kcl
/tmp/transpile-run-one/run-log.txt
```

Example `run-log.txt`:

```text
success
```

Recursive example:

```bash
cargo run -p kcl-lib --bin transpile -- \
  run /tmp/transpile-input \
  -r \
  -k \
  -o /tmp/transpile-run-recursive \
  --report-file /tmp/transpile-run-recursive/report.txt
```

Example report:

```text
Processed: 9
Succeeded: 3
Convert failed: 0
Run failed: 6

Run failed
- cpu-cooler/fan-housing.kcl: Execution error for `/tmp/transpile-input/cpu-cooler/fan-housing.kcl`: Type { ... }
- cpu-cooler/fan.kcl: Execution error for `/tmp/transpile-input/cpu-cooler/fan.kcl`: Engine { ... }
```

Example recursive output files:

```text
/tmp/transpile-run-recursive/box/main.kcl
/tmp/transpile-run-recursive/box/main-run-log.txt
/tmp/transpile-run-recursive/cpu-cooler/fan.kcl
/tmp/transpile-run-recursive/cpu-cooler/fan-run-log.txt
```

## Ignore Files

Ignore files use `.gitignore`-like syntax.

Examples:

```text
# Ignore one file
angle-gauge/main.kcl

# Ignore a whole folder
axial-fan/

# Ignore all .kcl files except main.kcl
*.kcl
!main.kcl
```

Matching is relative to the recursive input root.

## Migration Script

The migration script at `scripts/migrate-samples-to-sketch-solve.sh` is updated to use the new cli and kept for now. It should read:

```bash
"$transpile_bin" convert "public/kcl-samples/$file" > "$out_file"
```
