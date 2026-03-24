#![deny(improper_ctypes_definitions)]
use std::ffi::CStr;
use std::ffi::CString;
use std::ffi::c_char;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::ExecutorSettings;
use kcl_lib::KclError;
use kcl_lib::Program;
use kcl_lib::TypedPath;
use kcmc::units::UnitLength;
use kcmc::websocket::RawFile;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::format::OutputFormat3d;
use tokio::runtime::Runtime;

static RUNTIME: OnceLock<Result<Runtime, String>> = OnceLock::new();

struct KclSession {
    ctx: ExecutorContext,
}

pub struct SessionHandle {
    session: Mutex<KclSession>,
}

/// Where to find KCL source code.
enum KclInput {
    Path(PathBuf),
    Code(String),
}

struct ParsedKclProgram {
    program: Program,
    current_file: Option<PathBuf>,
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
    fn setup(message: impl Into<String>) -> Self {
        Self::Setup(message.into())
    }

    fn into_message(self) -> String {
        match self {
            Self::KclError(error) => error.to_string(),
            Self::Setup(message) => message,
        }
    }
}

impl KclSession {
    fn context_for_run(&self, current_file: Option<PathBuf>) -> ExecutorContext {
        let mut settings = self.ctx.settings.clone();
        settings.current_file = None;
        settings.project_directory = None;
        if let Some(current_file) = current_file {
            settings.with_current_file(TypedPath(current_file));
        }

        ExecutorContext {
            engine: self.ctx.engine.clone(),
            fs: self.ctx.fs.clone(),
            settings,
            context_type: self.ctx.context_type.clone(),
        }
    }

    async fn run_and_export(
        &self,
        kcl_input: KclInput,
        export_format: FileExportFormat,
        current_file_override: Option<PathBuf>,
    ) -> KclResult<Vec<RawFile>> {
        let ParsedKclProgram { program, current_file } = load_and_parse(kcl_input, current_file_override).await?;
        let ctx = self.context_for_run(current_file);
        let mut state = ExecState::new(&ctx);
        ctx.send_clear_scene(&mut state, kcl_lib::SourceRange::default())
            .await?;
        ctx.run(&program, &mut state)
            .await
            // TODO: Expose more than just this one KCL error,
            // should probably expose the nonfatal warnings, etc.
            .map_err(|error_with_outputs| error_with_outputs.error)?;

        export_from_ctx(&ctx, &program, export_format).await
    }

    async fn close(&self) {
        self.ctx.close().await;
    }
}

async fn new_session_inner(auth_token: Option<String>) -> KclResult<KclSession> {
    let ctx = ExecutorContext::new_with_client(default_settings(), auth_token, None)
        .await
        .map_err(|e| Error::setup(e.to_string()))?;
    Ok(KclSession { ctx })
}

async fn run_one_shot(
    kcl_input: KclInput,
    export_format: FileExportFormat,
    auth_token: Option<String>,
    current_file_override: Option<PathBuf>,
) -> KclResult<Vec<RawFile>> {
    let session = new_session_inner(auth_token).await?;
    let result = session
        .run_and_export(kcl_input, export_format, current_file_override)
        .await;
    session.close().await;
    result
}

fn default_settings() -> ExecutorSettings {
    let mut settings = ExecutorSettings::default();
    // Must turn on SSAO, without it, transparent images will look opaque.
    settings.enable_ssao = true;
    settings
}

async fn load_and_parse(kcl_input: KclInput, current_file_override: Option<PathBuf>) -> KclResult<ParsedKclProgram> {
    let (code, current_file) = match kcl_input {
        KclInput::Path(input_path) => {
            let (code, path) = get_code_and_file_path(input_path).await?;
            (code, Some(path))
        }
        KclInput::Code(code) => (code, current_file_override),
    };

    let program = Program::parse_no_errs(&code)?;
    Ok(ParsedKclProgram { program, current_file })
}

async fn get_code_and_file_path(mut path: PathBuf) -> KclResult<(String, PathBuf)> {
    // Check if the path is a directory, if so we want to look for a main.kcl inside.
    if path.is_dir() {
        path = path.join("main.kcl");
        if !path.exists() {
            return Err(Error::setup("Directory must contain a main.kcl file"));
        }
    } else if let Some(ext) = path.extension()
        && ext != "kcl"
    {
        return Err(Error::setup("File must have a .kcl extension"));
    }

    let code = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| Error::setup(e.to_string()))?;
    Ok((code, path))
}

async fn export_from_ctx(
    ctx: &ExecutorContext,
    program: &Program,
    export_format: FileExportFormat,
) -> KclResult<Vec<RawFile>> {
    let settings = program.meta_settings()?.unwrap_or_default();
    let units: UnitLength = settings.default_length_units;

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

    match resp {
        kcmc::websocket::OkWebSocketResponseData::Export { files } => Ok(files),
        _ => Err(Error::setup(format!("Unexpected response from engine: {resp:?}"))),
    }
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
#[derive(Debug)]
pub struct ErrorInfo {
    kind: KclErrorKind,
    msg: *mut c_char,
}

impl Drop for ErrorInfo {
    fn drop(&mut self) {
        unsafe { free_c_string(self.msg) };
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KclErrorKind {
    Lexical,
    Syntax,
    Semantic,
    ImportCycle,
    Argument,
    Type,
    Io,
    Unexpected,
    ValueAlreadyDefined,
    UndefinedValue,
    InvalidExpression,
    MaxCallStack,
    Engine,
    EngineHangup,
    EngineInternal,
    Internal,
    Setup,
}

impl From<&KclError> for KclErrorKind {
    fn from(value: &KclError) -> Self {
        match value {
            KclError::Lexical { .. } => Self::Lexical,
            KclError::Syntax { .. } => Self::Syntax,
            KclError::Semantic { .. } => Self::Semantic,
            KclError::ImportCycle { .. } => Self::ImportCycle,
            KclError::Argument { .. } => Self::Argument,
            KclError::Type { .. } => Self::Type,
            KclError::Io { .. } => Self::Io,
            KclError::Unexpected { .. } => Self::Unexpected,
            KclError::ValueAlreadyDefined { .. } => Self::ValueAlreadyDefined,
            KclError::UndefinedValue { .. } => Self::UndefinedValue,
            KclError::InvalidExpression { .. } => Self::InvalidExpression,
            KclError::MaxCallStack { .. } => Self::MaxCallStack,
            KclError::Engine { .. } => Self::Engine,
            KclError::EngineHangup { .. } => Self::EngineHangup,
            KclError::EngineInternal { .. } => Self::EngineInternal,
            KclError::Internal { .. } => Self::Internal,
        }
    }
}

impl ErrorInfo {
    fn new(kcl_error: &KclError) -> Self {
        Self {
            kind: KclErrorKind::from(kcl_error),
            msg: c_string_into_raw(kcl_error.message()),
        }
    }
    fn new_setup(msg: &str) -> Self {
        Self {
            kind: KclErrorKind::Setup,
            msg: c_string_into_raw(msg),
        }
    }
}

impl From<ErrorInfo> for ExportResult {
    fn from(error: ErrorInfo) -> Self {
        Self {
            error_set: true,
            error: Box::into_raw(Box::new(error)),
            exports: Default::default(),
            exports_len: Default::default(),
        }
    }
}

#[repr(C)]
#[derive(Default)]
pub struct ExportResult {
    /// If true, then `error` is set, it should be read and handled.
    /// `exports` is invalid and should not be read.
    pub error_set: bool,
    pub error: *mut ErrorInfo,
    /// Should only be read if `error_set` is false.
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
            Err(error) => match error {
                Error::KclError(kcl_error) => ExportResult::from(ErrorInfo::new(&kcl_error)),
                Error::Setup(setup_error) => ExportResult::from(ErrorInfo::new_setup(&setup_error)),
            },
        }
    }

    unsafe fn free(self) {
        if self.error_set && !self.error.is_null() {
            let ptr_to_error_info = unsafe { Box::from_raw(self.error as *mut ErrorInfo) };
            drop(ptr_to_error_info);
        }

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

#[repr(C)]
#[derive(Default)]
pub struct SessionStartResult {
    pub session: *mut SessionHandle,
    pub setup_error_set: bool,
    pub setup_error: *mut c_char,
}

impl SessionStartResult {
    fn new(result: KclResult<KclSession>) -> Self {
        match result {
            Ok(session) => Self {
                session: Box::into_raw(Box::new(SessionHandle {
                    session: Mutex::new(session),
                })),
                ..Default::default()
            },
            Err(error) => Self {
                setup_error_set: true,
                setup_error: c_string_into_raw(error.into_message()),
                ..Default::default()
            },
        }
    }

    unsafe fn free(self) {
        unsafe { free_c_string(self.setup_error) };
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

fn runtime() -> KclResult<&'static Runtime> {
    match RUNTIME.get_or_init(|| Runtime::new().map_err(|e| format!("Could not start Tokio runtime: {e}"))) {
        Ok(runtime) => Ok(runtime),
        Err(message) => Err(Error::setup(message.clone())),
    }
}

fn session_handle_from_ptr(session: *mut SessionHandle) -> KclResult<&'static SessionHandle> {
    if session.is_null() {
        return Err(Error::setup("session must not be null"));
    }

    Ok(unsafe { &*session })
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

fn path_buf_from_c_string(path: *const c_char, arg_name: &str) -> KclResult<PathBuf> {
    if path.is_null() {
        return Err(Error::setup(format!("{arg_name} must not be null")));
    }

    let path = unsafe { CStr::from_ptr(path) }
        .to_str()
        .map_err(|_| Error::setup(format!("{arg_name} must be valid UTF-8")))?;
    Ok(PathBuf::from(path))
}

fn optional_path_buf_from_c_string(path: *const c_char, arg_name: &str) -> KclResult<Option<PathBuf>> {
    optional_string_from_c_string(path, arg_name).map(|path| path.map(PathBuf::from))
}

fn string_from_c_string(s: *const c_char, arg_name: &str) -> KclResult<String> {
    if s.is_null() {
        return Err(Error::setup(format!("{arg_name} must not be null")));
    }

    let contents = unsafe { CStr::from_ptr(s) }
        .to_str()
        .map_err(|_| Error::setup(format!("{arg_name} must be valid UTF-8")))?;
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

/// Start a KCL session backed by a live engine connection.
/// Pass `auth_token` as null or an empty string to fall back to the environment.
#[unsafe(no_mangle)]
pub extern "C" fn start_session(auth_token: *const c_char) -> SessionStartResult {
    let auth_token = match optional_string_from_c_string(auth_token, "auth_token") {
        Ok(auth_token) => auth_token,
        Err(error) => return SessionStartResult::new(Err(error)),
    };

    let runtime = match runtime() {
        Ok(runtime) => runtime,
        Err(error) => return SessionStartResult::new(Err(error)),
    };

    SessionStartResult::new(runtime.block_on(new_session_inner(auth_token)))
}

/// Run the KCL program in an existing session and export the current scene.
/// Pass `current_file` as null or an empty string when there is no on-disk file path.
#[unsafe(no_mangle)]
pub extern "C" fn session_run_contents_and_export(
    session: *mut SessionHandle,
    contents: *const c_char,
    current_file: *const c_char,
    export_format: FileExportFormat,
) -> ExportResult {
    let session = match session_handle_from_ptr(session) {
        Ok(session) => session,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let contents = match string_from_c_string(contents, "contents") {
        Ok(contents) => contents,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let current_file = match optional_path_buf_from_c_string(current_file, "current_file") {
        Ok(current_file) => current_file,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let runtime = match runtime() {
        Ok(runtime) => runtime,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let session = match session.session.lock() {
        Ok(session) => session,
        Err(_) => return ExportResult::new(Err(Error::setup("session lock poisoned"))),
    };

    let result = runtime.block_on(session.run_and_export(KclInput::Code(contents), export_format, current_file));
    ExportResult::new(result)
}

/// Run the KCL file in an existing session and export the current scene.
/// Input: a filepath to a .kcl file, or a directory containing a `main.kcl`.
#[unsafe(no_mangle)]
pub extern "C" fn session_run_file_and_export(
    session: *mut SessionHandle,
    kcl_source_file: *const c_char,
    export_format: FileExportFormat,
) -> ExportResult {
    let session = match session_handle_from_ptr(session) {
        Ok(session) => session,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let kcl_source_file = match path_buf_from_c_string(kcl_source_file, "kcl_source_file") {
        Ok(path) => path,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let runtime = match runtime() {
        Ok(runtime) => runtime,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let session = match session.session.lock() {
        Ok(session) => session,
        Err(_) => return ExportResult::new(Err(Error::setup("session lock poisoned"))),
    };

    let result = runtime.block_on(session.run_and_export(KclInput::Path(kcl_source_file), export_format, None));
    ExportResult::new(result)
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
    let kcl_source_file = match path_buf_from_c_string(kcl_source_file, "kcl_source_file") {
        Ok(path) => path,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let auth_token = match optional_string_from_c_string(auth_token, "auth_token") {
        Ok(auth_token) => auth_token,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let runtime = match runtime() {
        Ok(runtime) => runtime,
        Err(error) => return ExportResult::new(Err(error)),
    };

    let result = runtime.block_on(run_one_shot(
        KclInput::Path(kcl_source_file),
        export_format,
        auth_token,
        None,
    ));
    ExportResult::new(result)
}

/// Run the KCL program, and export it to some file format.
/// Input: a KCL program in a string.
/// Pass `auth_token` as null or an empty string to fall back to the environment.
#[unsafe(no_mangle)]
pub extern "C" fn run_contents_and_export(
    contents: *const c_char,
    export_format: FileExportFormat,
    auth_token: *const c_char,
) -> ExportResult {
    let contents = match string_from_c_string(contents, "contents") {
        Ok(contents) => contents,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let auth_token = match optional_string_from_c_string(auth_token, "auth_token") {
        Ok(auth_token) => auth_token,
        Err(error) => return ExportResult::new(Err(error)),
    };
    let runtime = match runtime() {
        Ok(runtime) => runtime,
        Err(error) => return ExportResult::new(Err(error)),
    };

    let result = runtime.block_on(run_one_shot(KclInput::Code(contents), export_format, auth_token, None));
    ExportResult::new(result)
}

/// Users must call this exactly once for each successful `start_session` result
/// after reading the error message, if any.
#[unsafe(no_mangle)]
pub extern "C" fn free_session_start_result(result: SessionStartResult) {
    unsafe { result.free() };
}

/// Users must call this exactly once for each successful `run_*_and_export` result,
/// after they have copied out the data.
#[unsafe(no_mangle)]
pub extern "C" fn free_export_result(result: ExportResult) {
    unsafe { result.free() };
}

/// Close the live engine connection for this session and free the session handle.
#[unsafe(no_mangle)]
pub extern "C" fn free_session(session: *mut SessionHandle) {
    if session.is_null() {
        return;
    }

    let session = unsafe { Box::from_raw(session) };
    let session = match session.session.into_inner() {
        Ok(session) => session,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Ok(runtime) = runtime() {
        runtime.block_on(session.close());
    }
}
