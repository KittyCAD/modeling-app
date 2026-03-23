use std::ffi::CStr;
use std::ffi::CString;
use std::ffi::c_char;
use std::path::PathBuf;

use kcl_lib::ExecutorContext;
use kcl_lib::KclError;
use kcmc::units::UnitLength;
use kcmc::websocket::RawFile;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::format::OutputFormat3d;
use tokio::runtime::Runtime;

struct ExecutedKcl {
    ctx: ExecutorContext,
    program: kcl_lib::Program,
    #[expect(dead_code)]
    code: String,
    #[expect(dead_code)]
    filename: String,
}

async fn run_and_export_inner(
    kcl_input: KclInput,
    export_format: FileExportFormat,
    auth_token: Option<String>,
) -> KclResult<Vec<RawFile>> {
    let ExecutedKcl {
        ctx,
        program,
        code: _,
        filename: _,
    } = run_kcl(kcl_input, false, auth_token).await?;

    let settings = program.meta_settings()?.unwrap_or_default();
    let units: UnitLength = settings.default_length_units;

    // This will not return until there are files.
    let resp = ctx
        .engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::Export(
                kittycad_modeling_cmds::Export::builder()
                    .entity_ids(vec![])
                    .format(OutputFormat3d::new(
                        &export_format.into(),
                        kcmc::format::OutputFormat3dOptions::new(units),
                    ))
                    .build(),
            ),
        )
        .await?;

    let result = match resp {
        kcmc::websocket::OkWebSocketResponseData::Export { files } => Ok(files),
        _ => Err(Error::Setup(format!("Unexpected response from engine: {resp:?}"))),
    };

    ctx.close().await;
    result
}

async fn new_context_state(
    current_file: Option<std::path::PathBuf>,
    mock: bool,
    auth_token: Option<String>,
) -> KclResult<(ExecutorContext, kcl_lib::ExecState)> {
    let mut settings: kcl_lib::ExecutorSettings = Default::default();
    if let Some(current_file) = current_file {
        settings.with_current_file(kcl_lib::TypedPath(current_file));
    }
    // Must turn on SSAO, without it, transparent images will look opaque.
    settings.enable_ssao = true;
    let ctx = if mock {
        ExecutorContext::new_mock(Some(settings)).await
    } else {
        ExecutorContext::new_with_client(settings, auth_token, None)
            .await
            .map_err(|e| Error::Setup(e.to_string()))?
    };
    let state = kcl_lib::ExecState::new(&ctx);
    Ok((ctx, state))
}

async fn run_kcl(input: KclInput, mock: bool, auth_token: Option<String>) -> KclResult<ExecutedKcl> {
    let KclProgram {
        code,
        program,
        path,
        filename,
    } = load_and_parse(input).await?;

    let (ctx, mut state) = new_context_state(path, mock, auth_token).await?;
    ctx.run(&program, &mut state)
        .await
        // TODO: Expose more than just this one KCL error,
        // should probably expose the nonfatal warnings, etc.
        .map_err(|error_with_outputs| error_with_outputs.error)?;

    Ok(ExecutedKcl {
        ctx,
        program,
        code,
        filename,
    })
}

/// Where to find KCL source code.
enum KclInput {
    Path(PathBuf),
    Code(String),
}

struct KclProgram {
    code: String,
    program: kcl_lib::Program,
    path: Option<PathBuf>,
    filename: String,
}

type KclResult<T> = Result<T, Error>;

enum Error {
    KclError(KclError),
    Setup(String),
}

impl From<KclError> for Error {
    fn from(kcl_error: KclError) -> Self {
        Self::KclError(kcl_error)
    }
}

impl Error {
    fn setup(message: String) -> Self {
        Self::Setup(message)
    }
}

async fn load_and_parse(input: KclInput) -> KclResult<KclProgram> {
    async fn get_code_and_file_path(mut path: PathBuf) -> KclResult<(String, std::path::PathBuf)> {
        // Check if the path is a directory, if so we want to look for a main.kcl inside.
        if path.is_dir() {
            path = path.join("main.kcl");
            if !path.exists() {
                let message = "Directory must contain a main.kcl file".to_owned();
                return Err(Error::Setup(message));
            }
        } else {
            // Otherwise be sure we have a kcl file.
            if let Some(ext) = path.extension()
                && ext != "kcl"
            {
                let message = "File must have a .kcl extension".to_owned();
                return Err(Error::Setup(message));
            }
        }

        let code = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| Error::Setup(e.to_string()))?;
        Ok((code, path))
    }

    let (code, path, filename) = match input {
        KclInput::Path(input_path) => {
            let (code, path) = get_code_and_file_path(input_path.clone()).await?;
            let filename = path.display().to_string();
            (code, Some(path), filename)
        }
        KclInput::Code(code) => (code, None, String::new()),
    };

    // In the future, you can throw
    // ```
    // .map_err(|err| into_miette_for_parse(&filename, &code, err))
    // ```
    // onto this for nicer-looking errors.
    let program = kcl_lib::Program::parse_no_errs(&code)?;

    Ok(KclProgram {
        code,
        program,
        path,
        filename,
    })
}

#[repr(C)]
#[derive(Default)]
pub struct ExportedFile {
    /// NUL-terminated UTF-8 string owned by Rust.
    pub name: *mut c_char,
    /// File bytes owned by Rust.
    pub contents: *mut u8,
    pub contents_len: usize,
}

impl ExportedFile {
    fn new(file: RawFile) -> Self {
        let (contents, contents_len) = boxed_bytes_into_raw_parts(file.contents);
        Self {
            name: c_string_into_raw(file.name),
            contents,
            contents_len,
        }
    }

    unsafe fn free(self) {
        unsafe { free_c_string(self.name) };
        unsafe { free_boxed_bytes(self.contents, self.contents_len) };
    }
}

#[repr(C)]
#[derive(Default)]
pub struct ExportResult {
    /// If true, then `kcl_error` is set, it should be read and handled.
    /// `exports` is invalid and should not be read.
    pub kcl_error_set: bool,
    pub kcl_error: *mut c_char,
    /// If true, then `setup_error` is set, it should be read and handled.
    /// `exports` is invalid and should not be read.
    pub setup_error_set: bool,
    pub setup_error: *mut c_char,
    /// Should only be read if `kcl_error_set` and `setup_error_set` are false.
    pub exports: *mut ExportedFile,
    pub exports_len: usize,
}

impl ExportResult {
    fn new(result: KclResult<Vec<RawFile>>) -> Self {
        match result {
            Ok(exports) => ExportResult {
                exports_len: exports.len(),
                exports: boxed_files_into_raw_ptr(exports),
                ..Default::default()
            },
            Err(e) => match e {
                Error::KclError(kcl_error) => ExportResult {
                    kcl_error: c_string_into_raw(kcl_error.to_string()),
                    kcl_error_set: true,
                    ..Default::default()
                },
                Error::Setup(setup_error) => ExportResult {
                    setup_error: c_string_into_raw(setup_error),
                    setup_error_set: true,
                    ..Default::default()
                },
            },
        }
    }

    unsafe fn free(self) {
        unsafe { free_c_string(self.kcl_error) };
        unsafe { free_c_string(self.setup_error) };

        if !self.exports.is_null() {
            let files = unsafe {
                Box::<[ExportedFile]>::from_raw(std::ptr::slice_from_raw_parts_mut(self.exports, self.exports_len))
            };
            for file in files.into_vec() {
                unsafe { file.free() };
            }
        }
    }
}

fn c_string_into_raw(value: impl Into<String>) -> *mut c_char {
    let bytes = value
        .into()
        .into_bytes()
        .into_iter()
        // Remove NUL bytes.
        .filter(|byte| *byte != 0)
        .collect();
    // SAFETY: Interior NUL bytes were removed above.
    let cstr = unsafe { CString::from_vec_unchecked(bytes) };
    cstr.into_raw()
}

fn boxed_bytes_into_raw_parts(bytes: Vec<u8>) -> (*mut u8, usize) {
    let boxed = bytes.into_boxed_slice();
    let len = boxed.len();
    let ptr = Box::into_raw(boxed) as *mut u8;
    (ptr, len)
}

fn boxed_files_into_raw_ptr(files: Vec<RawFile>) -> *mut ExportedFile {
    let exported_files = files.into_iter().map(ExportedFile::new).collect::<Vec<_>>();
    Box::into_raw(exported_files.into_boxed_slice()) as *mut ExportedFile
}

unsafe fn free_c_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

unsafe fn free_boxed_bytes(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Box::<[u8]>::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
    }
}

fn path_buf_from_c_string(path: *const c_char) -> KclResult<PathBuf> {
    if path.is_null() {
        return Err(Error::setup("kcl_source_file must not be null".to_owned()));
    }

    let path = unsafe { CStr::from_ptr(path) }
        .to_str()
        .map_err(|_| Error::setup("kcl_source_file must be valid UTF-8".to_owned()))?;
    Ok(PathBuf::from(path))
}

fn string_from_c_string(s: *const c_char) -> KclResult<String> {
    if s.is_null() {
        return Err(Error::setup("kcl string must not be null".to_owned()));
    }

    let contents = unsafe { CStr::from_ptr(s) }
        .to_str()
        .map_err(|_| Error::setup("kcl string must be valid UTF-8".to_owned()))?;
    Ok(contents.to_owned())
}

fn optional_string_from_c_string(s: *const c_char, arg_name: &str) -> KclResult<Option<String>> {
    if s.is_null() {
        return Ok(None);
    }

    let contents = unsafe { CStr::from_ptr(s) }
        .to_str()
        .map_err(|_| Error::setup(format!("{arg_name} must be valid UTF-8")))?;

    if contents.is_empty() {
        Ok(None)
    } else {
        Ok(Some(contents.to_owned()))
    }
}

#[repr(C)]
pub enum FileExportFormat {
    /// Autodesk Filmbox (FBX) format. <https://en.wikipedia.org/wiki/FBX>
    Fbx,
    /// Binary glTF 2.0.
    ///
    /// This is a single binary with .glb extension.
    ///
    /// This is better if you want a compressed format as opposed to the human readable
    /// glTF that lacks compression.
    Glb,
    /// glTF 2.0.
    /// Embedded glTF 2.0 (pretty printed).
    ///
    /// Single JSON file with .gltf extension binary data encoded as
    /// base64 data URIs.
    ///
    /// The JSON contents are pretty printed.
    ///
    /// It is human readable, single file, and you can view the
    /// diff easily in a git commit.
    Gltf,
    /// The OBJ file format. <https://en.wikipedia.org/wiki/Wavefront_.obj_file>
    /// It may or may not have an an attached material (mtl // mtllib) within the file,
    /// but we interact with it as if it does not.
    Obj,
    /// The PLY file format. <https://en.wikipedia.org/wiki/PLY_(file_format)>
    Ply,
    /// The STEP file format. <https://en.wikipedia.org/wiki/ISO_10303-21>
    Step,
    /// The STL file format. <https://en.wikipedia.org/wiki/STL_(file_format)>
    Stl,
}

impl From<FileExportFormat> for kcmc::shared::FileExportFormat {
    fn from(value: FileExportFormat) -> Self {
        match value {
            FileExportFormat::Fbx => kcmc::shared::FileExportFormat::Fbx,
            FileExportFormat::Glb => kcmc::shared::FileExportFormat::Glb,
            FileExportFormat::Gltf => kcmc::shared::FileExportFormat::Gltf,
            FileExportFormat::Obj => kcmc::shared::FileExportFormat::Obj,
            FileExportFormat::Ply => kcmc::shared::FileExportFormat::Ply,
            FileExportFormat::Step => kcmc::shared::FileExportFormat::Step,
            FileExportFormat::Stl => kcmc::shared::FileExportFormat::Stl,
        }
    }
}

/// Run the KCL file, and export it to some file format.
/// Input: a filepath to a .kcl file, or a directory containing a `main.kcl`.
/// Pass `auth_token` as null or an empty string to fall back to the environment.
#[unsafe(no_mangle)]
pub extern "C" fn run_file_and_export(
    kcl_source_file: *const c_char,
    export_format: FileExportFormat,
    auth_token: *const c_char,
) -> ExportResult {
    let kcl_source_file = match path_buf_from_c_string(kcl_source_file) {
        Ok(path) => path,
        Err(error) => return ExportResult::new(Err(error)),
    };

    let auth_token = match optional_string_from_c_string(auth_token, "auth_token") {
        Ok(auth_token) => auth_token,
        Err(error) => return ExportResult::new(Err(error)),
    };

    let rt = match runtime() {
        Ok(rt) => rt,
        Err(e) => return ExportResult::new(Err(e)),
    };

    let result = rt.block_on(run_and_export_inner(
        KclInput::Path(kcl_source_file),
        export_format,
        auth_token,
    ));
    ExportResult::new(result)
}

/// Run the KCL program, and export it to some file format.
/// Input: A KCL program in a string.
/// Pass `auth_token` as null or an empty string to fall back to the environment.
#[unsafe(no_mangle)]
pub extern "C" fn run_contents_and_export(
    contents: *const c_char,
    export_format: FileExportFormat,
    auth_token: *const c_char,
) -> ExportResult {
    let kcl_contents = match string_from_c_string(contents) {
        Ok(s) => s,
        Err(error) => return ExportResult::new(Err(error)),
    };

    let auth_token = match optional_string_from_c_string(auth_token, "auth_token") {
        Ok(auth_token) => auth_token,
        Err(error) => return ExportResult::new(Err(error)),
    };

    let rt = match runtime() {
        Ok(rt) => rt,
        Err(e) => return ExportResult::new(Err(e)),
    };

    let result = rt.block_on(run_and_export_inner(
        KclInput::Code(kcl_contents),
        export_format,
        auth_token,
    ));
    ExportResult::new(result)
}

/// Users must call this exactly once for each successful `run_and_export` result,
/// after you've has copied out the data.
#[unsafe(no_mangle)]
pub extern "C" fn free_export_result(result: ExportResult) {
    unsafe { result.free() };
}

fn runtime() -> KclResult<Runtime> {
    Runtime::new().map_err(|e| Error::Setup(format!("Could not start Tokio runtime: {e}")))
}
