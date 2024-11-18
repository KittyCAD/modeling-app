//! Standard library functions involved in importing files.

use std::str::FromStr;

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{
    coord::{Axis, AxisDirectionPair, Direction, System},
    each_cmd as mcmd,
    format::InputFormat,
    ok_response::OkModelingCmdResponse,
    shared::FileImportFormat,
    units::UnitLength,
    websocket::OkWebSocketResponseData,
    ImportFile, ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExecState, ImportedGeometry, KclValue},
    fs::FileSystem,
    std::Args,
};

// Zoo co-ordinate system.
//
// * Forward: -Y
// * Up: +Z
// * Handedness: Right
const ZOO_COORD_SYSTEM: System = System {
    forward: AxisDirectionPair {
        axis: Axis::Y,
        direction: Direction::Negative,
    },
    up: AxisDirectionPair {
        axis: Axis::Z,
        direction: Direction::Positive,
    },
};

/// Import format specifier
#[derive(serde :: Serialize, serde :: Deserialize, PartialEq, Debug, Clone, schemars :: JsonSchema)]
#[cfg_attr(feature = "tabled", derive(tabled::Tabled))]
#[serde(tag = "type")]
pub enum ImportFormat {
    /// Autodesk Filmbox (FBX) format
    #[serde(rename = "fbx")]
    Fbx {},
    /// Binary glTF 2.0. We refer to this as glTF since that is how our customers refer to
    /// it, but this can also import binary glTF (glb).
    #[serde(rename = "gltf")]
    Gltf {},
    /// Wavefront OBJ format.
    #[serde(rename = "obj")]
    Obj {
        /// Co-ordinate system of input data.
        /// Defaults to the [KittyCAD co-ordinate system.
        coords: Option<System>,
        /// The units of the input data. This is very important for correct scaling and when
        /// calculating physics properties like mass, etc.
        /// Defaults to millimeters.
        units: UnitLength,
    },
    /// The PLY Polygon File Format.
    #[serde(rename = "ply")]
    Ply {
        /// Co-ordinate system of input data.
        /// Defaults to the [KittyCAD co-ordinate system.
        coords: Option<System>,
        /// The units of the input data. This is very important for correct scaling and when
        /// calculating physics properties like mass, etc.
        /// Defaults to millimeters.
        units: UnitLength,
    },
    /// SolidWorks part (SLDPRT) format.
    #[serde(rename = "sldprt")]
    Sldprt {},
    /// ISO 10303-21 (STEP) format.
    #[serde(rename = "step")]
    Step {},
    /// *ST**ereo**L**ithography format.
    #[serde(rename = "stl")]
    Stl {
        /// Co-ordinate system of input data.
        /// Defaults to the [KittyCAD co-ordinate system.
        coords: Option<System>,
        /// The units of the input data. This is very important for correct scaling and when
        /// calculating physics properties like mass, etc.
        /// Defaults to millimeters.
        units: UnitLength,
    },
}

impl From<ImportFormat> for InputFormat {
    fn from(format: ImportFormat) -> Self {
        match format {
            ImportFormat::Fbx {} => InputFormat::Fbx(Default::default()),
            ImportFormat::Gltf {} => InputFormat::Gltf(Default::default()),
            ImportFormat::Obj { coords, units } => InputFormat::Obj(kcmc::format::obj::import::Options {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            }),
            ImportFormat::Ply { coords, units } => InputFormat::Ply(kcmc::format::ply::import::Options {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            }),
            ImportFormat::Sldprt {} => InputFormat::Sldprt(kcmc::format::sldprt::import::Options {
                split_closed_faces: false,
            }),
            ImportFormat::Step {} => InputFormat::Step(kcmc::format::step::import::Options {
                split_closed_faces: false,
            }),
            ImportFormat::Stl { coords, units } => InputFormat::Stl(kcmc::format::stl::import::Options {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            }),
        }
    }
}

/// Import a CAD file.
/// For formats lacking unit data (STL, OBJ, PLY), the default import unit is millimeters.
/// Otherwise you can specify the unit by passing in the options parameter.
/// If you import a gltf file, we will try to find the bin file and import it as well.
///
/// Import paths are relative to the current project directory. This only works in the desktop app
/// not in browser.
pub async fn import(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (file_path, options): (String, Option<ImportFormat>) = args.get_import_data()?;

    let imported_geometry = inner_import(file_path, options, exec_state, args).await?;
    Ok(KclValue::ImportedGeometry(imported_geometry))
}

/// Import a CAD file.
///
/// For formats lacking unit data (such as STL, OBJ, or PLY files), the default
/// unit of measurement is millimeters. Alternatively you may specify the unit
/// by passing your desired measurement unit in the options parameter. When
/// importing a GLTF file, the bin file will be imported as well. Import paths
/// are relative to the current project directory.
///
/// Note: The import command currently only works when using the native
/// Modeling App.
///
/// For importing KCL functions using the `import` statement, see the docs on
/// [KCL modules](/docs/kcl/modules).
///
/// ```no_run
/// const model = import("tests/inputs/cube.obj")
/// ```
///
/// ```no_run
/// const model = import("tests/inputs/cube.obj", {type: "obj", units: "m"})
/// ```
///
/// ```no_run
/// const model = import("tests/inputs/cube.gltf")
/// ```
///
/// ```no_run
/// const model = import("tests/inputs/cube.sldprt")
/// ```
///
/// ```no_run
/// const model = import("tests/inputs/cube.step")
/// ```
///
/// ```no_run
/// import height, buildSketch from 'common.kcl'
///
/// plane = 'XZ'
/// margin = 2
/// s1 = buildSketch(plane, [0, 0])
/// s2 = buildSketch(plane, [0, height() + margin])
/// ```
#[stdlib {
    name = "import",
    tags = [],
}]
async fn inner_import(
    file_path: String,
    options: Option<ImportFormat>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<ImportedGeometry, KclError> {
    if file_path.is_empty() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "No file path was provided.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure the file exists.
    if !args.ctx.fs.exists(&file_path, args.source_range).await? {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("File `{}` does not exist.", file_path),
            source_ranges: vec![args.source_range],
        }));
    }

    let ext_format = get_import_format_from_extension(file_path.split('.').last().ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: format!("No file extension found for `{}`", file_path),
            source_ranges: vec![args.source_range],
        })
    })?)
    .map_err(|e| {
        KclError::Semantic(KclErrorDetails {
            message: e.to_string(),
            source_ranges: vec![args.source_range],
        })
    })?;

    // Get the format type from the extension of the file.
    let format = if let Some(options) = options {
        // Validate the given format with the extension format.
        let format: InputFormat = options.into();
        validate_extension_format(ext_format, format.clone()).map_err(|e| {
            KclError::Semantic(KclErrorDetails {
                message: e.to_string(),
                source_ranges: vec![args.source_range],
            })
        })?;
        format
    } else {
        ext_format
    };

    // Get the file contents for each file path.
    let file_contents = args.ctx.fs.read(&file_path, args.source_range).await.map_err(|e| {
        KclError::Semantic(KclErrorDetails {
            message: e.to_string(),
            source_ranges: vec![args.source_range],
        })
    })?;

    // We want the file_path to be without the parent.
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| {
            KclError::Semantic(KclErrorDetails {
                message: format!("Could not get the file name from the path `{}`", file_path),
                source_ranges: vec![args.source_range],
            })
        })?;
    let mut import_files = vec![kcmc::ImportFile {
        path: file_name.to_string(),
        data: file_contents.clone(),
    }];

    // In the case of a gltf importing a bin file we need to handle that! and figure out where the
    // file is relative to our current file.
    if let InputFormat::Gltf(..) = format {
        // Check if the file is a binary gltf file, in that case we don't need to import the bin
        // file.
        if !file_contents.starts_with(b"glTF") {
            let json = gltf_json::Root::from_slice(&file_contents).map_err(|e| {
                KclError::Semantic(KclErrorDetails {
                    message: e.to_string(),
                    source_ranges: vec![args.source_range],
                })
            })?;

            // Read the gltf file and check if there is a bin file.
            for buffer in json.buffers.iter() {
                if let Some(uri) = &buffer.uri {
                    if !uri.starts_with("data:") {
                        // We want this path relative to the file_path given.
                        let bin_path = std::path::Path::new(&file_path)
                            .parent()
                            .map(|p| p.join(uri))
                            .map(|p| p.to_string_lossy().to_string())
                            .ok_or_else(|| {
                                KclError::Semantic(KclErrorDetails {
                                    message: format!("Could not get the parent path of the file `{}`", file_path),
                                    source_ranges: vec![args.source_range],
                                })
                            })?;

                        let bin_contents = args.ctx.fs.read(&bin_path, args.source_range).await.map_err(|e| {
                            KclError::Semantic(KclErrorDetails {
                                message: e.to_string(),
                                source_ranges: vec![args.source_range],
                            })
                        })?;

                        import_files.push(ImportFile {
                            path: uri.to_string(),
                            data: bin_contents,
                        });
                    }
                }
            }
        }
    }

    if args.ctx.is_mock() {
        return Ok(ImportedGeometry {
            id: exec_state.id_generator.next_uuid(),
            value: import_files.iter().map(|f| f.path.to_string()).collect(),
            meta: vec![args.source_range.into()],
        });
    }

    let id = exec_state.id_generator.next_uuid();
    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::ImportFiles {
                files: import_files.clone(),
                format,
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::ImportFiles(imported_files),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("ImportFiles response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(ImportedGeometry {
        id: imported_files.object_id,
        value: import_files.iter().map(|f| f.path.to_string()).collect(),
        meta: vec![args.source_range.into()],
    })
}

/// Get the source format from the extension.
fn get_import_format_from_extension(ext: &str) -> Result<InputFormat> {
    let format = match FileImportFormat::from_str(ext) {
        Ok(format) => format,
        Err(_) => {
            if ext == "stp" {
                FileImportFormat::Step
            } else if ext == "glb" {
                FileImportFormat::Gltf
            } else {
                anyhow::bail!("unknown source format for file extension: {}. Try setting the `--src-format` flag explicitly or use a valid format.", ext)
            }
        }
    };

    // Make the default units millimeters.
    let ul = UnitLength::Millimeters;

    // Zoo co-ordinate system.
    //
    // * Forward: -Y
    // * Up: +Z
    // * Handedness: Right
    match format {
        FileImportFormat::Step => Ok(InputFormat::Step(kcmc::format::step::import::Options {
            split_closed_faces: false,
        })),
        FileImportFormat::Stl => Ok(InputFormat::Stl(kcmc::format::stl::import::Options {
            coords: ZOO_COORD_SYSTEM,
            units: ul,
        })),
        FileImportFormat::Obj => Ok(InputFormat::Obj(kcmc::format::obj::import::Options {
            coords: ZOO_COORD_SYSTEM,
            units: ul,
        })),
        FileImportFormat::Gltf => Ok(InputFormat::Gltf(kcmc::format::gltf::import::Options {})),
        FileImportFormat::Ply => Ok(InputFormat::Ply(kcmc::format::ply::import::Options {
            coords: ZOO_COORD_SYSTEM,
            units: ul,
        })),
        FileImportFormat::Fbx => Ok(InputFormat::Fbx(kcmc::format::fbx::import::Options {})),
        FileImportFormat::Sldprt => Ok(InputFormat::Sldprt(kcmc::format::sldprt::import::Options {
            split_closed_faces: false,
        })),
    }
}

fn validate_extension_format(ext: InputFormat, given: InputFormat) -> Result<()> {
    if let InputFormat::Stl(_) = ext {
        if let InputFormat::Stl(_) = given {
            return Ok(());
        }
    }

    if let InputFormat::Obj(_) = ext {
        if let InputFormat::Obj(_) = given {
            return Ok(());
        }
    }

    if let InputFormat::Ply(_) = ext {
        if let InputFormat::Ply(_) = given {
            return Ok(());
        }
    }

    if ext == given {
        return Ok(());
    }

    anyhow::bail!(
        "The given format does not match the file extension. Expected: `{}`, Given: `{}`",
        get_name_of_format(ext),
        get_name_of_format(given)
    )
}

fn get_name_of_format(type_: InputFormat) -> &'static str {
    match type_ {
        InputFormat::Fbx(_) => "fbx",
        InputFormat::Gltf(_) => "gltf",
        InputFormat::Obj(_) => "obj",
        InputFormat::Ply(_) => "ply",
        InputFormat::Sldprt(_) => "sldprt",
        InputFormat::Step(_) => "step",
        InputFormat::Stl(_) => "stl",
    }
}
