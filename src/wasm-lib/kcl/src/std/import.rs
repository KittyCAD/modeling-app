//! Standard library functions involved in importing files.

use std::str::FromStr;

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ImportedGeometry, MemoryItem},
    fs::FileSystem,
    std::Args,
};

// Zoo co-ordinate system.
//
// * Forward: -Y
// * Up: +Z
// * Handedness: Right
const ZOO_COORD_SYSTEM: kittycad::types::System = kittycad::types::System {
    forward: kittycad::types::AxisDirectionPair {
        axis: kittycad::types::Axis::Y,
        direction: kittycad::types::Direction::Negative,
    },
    up: kittycad::types::AxisDirectionPair {
        axis: kittycad::types::Axis::Z,
        direction: kittycad::types::Direction::Positive,
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
        coords: Option<kittycad::types::System>,
        /// The units of the input data. This is very important for correct scaling and when
        /// calculating physics properties like mass, etc.
        /// Defaults to millimeters.
        units: kittycad::types::UnitLength,
    },
    /// The PLY Polygon File Format.
    #[serde(rename = "ply")]
    Ply {
        /// Co-ordinate system of input data.
        /// Defaults to the [KittyCAD co-ordinate system.
        coords: Option<kittycad::types::System>,
        /// The units of the input data. This is very important for correct scaling and when
        /// calculating physics properties like mass, etc.
        /// Defaults to millimeters.
        units: kittycad::types::UnitLength,
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
        coords: Option<kittycad::types::System>,
        /// The units of the input data. This is very important for correct scaling and when
        /// calculating physics properties like mass, etc.
        /// Defaults to millimeters.
        units: kittycad::types::UnitLength,
    },
}

impl From<ImportFormat> for kittycad::types::InputFormat {
    fn from(format: ImportFormat) -> Self {
        match format {
            ImportFormat::Fbx {} => kittycad::types::InputFormat::Fbx {},
            ImportFormat::Gltf {} => kittycad::types::InputFormat::Gltf {},
            ImportFormat::Obj { coords, units } => kittycad::types::InputFormat::Obj {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            },
            ImportFormat::Ply { coords, units } => kittycad::types::InputFormat::Ply {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            },
            ImportFormat::Sldprt {} => kittycad::types::InputFormat::Sldprt {},
            ImportFormat::Step {} => kittycad::types::InputFormat::Step {},
            ImportFormat::Stl { coords, units } => kittycad::types::InputFormat::Stl {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            },
        }
    }
}

/// Import a CAD file.
/// For formats lacking unit data (STL, OBJ, PLY), the default import unit is millimeters.
/// Otherwise you can specify the unit by passing in the options parameter.
/// If you import a gltf file, we will try to find the bin file and import it as well.
pub async fn import(args: Args) -> Result<MemoryItem, KclError> {
    let (file_path, options): (String, Option<ImportFormat>) = args.get_import_data()?;

    let imported_geometry = inner_import(file_path, options, args).await?;
    Ok(MemoryItem::ImportedGeometry(imported_geometry))
}

/// Import a CAD file.
/// For formats lacking unit data (STL, OBJ, PLY), the default import unit is millimeters.
/// Otherwise you can specify the unit by passing in the options parameter.
/// If you import a gltf file, we will try to find the bin file and import it as well.
#[stdlib {
    name = "import",
}]
async fn inner_import(
    file_path: String,
    options: Option<ImportFormat>,
    args: Args,
) -> Result<ImportedGeometry, KclError> {
    if file_path.is_empty() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "No file path was provided.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure the file exists.
    let fsm = crate::fs::FileManager::new();
    if !fsm.exists(&file_path, args.source_range).await? {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("File `{}` does not exist.", file_path),
            source_ranges: vec![args.source_range],
        }));
    }

    // Get the format type from the extension of the file.
    let format: kittycad::types::InputFormat = if let Some(options) = options {
        options.into()
    } else {
        get_import_format_from_extension(file_path.split('.').last().ok_or_else(|| {
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
        })?
    };

    // Get the file contents for each file path.
    let file_contents = fsm.read(&file_path, args.source_range).await.map_err(|e| {
        KclError::Semantic(KclErrorDetails {
            message: e.to_string(),
            source_ranges: vec![args.source_range],
        })
    })?;

    let import_files = vec![kittycad::types::ImportFile {
        path: file_path.to_string(),
        data: file_contents,
    }];

    // TODO: In the case of a gltf importing a bin file we need to handle that! and figure out where the
    // file is relative to our current file.

    let id = uuid::Uuid::new_v4();
    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::ImportFiles {
                files: import_files.clone(),
                format,
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::ImportFiles { data: imported_files },
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
fn get_import_format_from_extension(ext: &str) -> Result<kittycad::types::InputFormat> {
    let format = match kittycad::types::FileImportFormat::from_str(ext) {
        Ok(format) => format,
        Err(_) => {
            if ext == "stp" {
                kittycad::types::FileImportFormat::Step
            } else if ext == "glb" {
                kittycad::types::FileImportFormat::Gltf
            } else {
                anyhow::bail!(
                    "unknown source format for file extension: {}. Try setting the `--src-format` flag explicitly or use a valid format.",
                    ext
                )
            }
        }
    };

    // Make the default units millimeters.
    let ul = kittycad::types::UnitLength::Mm;

    // Zoo co-ordinate system.
    //
    // * Forward: -Y
    // * Up: +Z
    // * Handedness: Right
    match format {
        kittycad::types::FileImportFormat::Step => Ok(kittycad::types::InputFormat::Step {}),
        kittycad::types::FileImportFormat::Stl => Ok(kittycad::types::InputFormat::Stl {
            coords: ZOO_COORD_SYSTEM,
            units: ul,
        }),
        kittycad::types::FileImportFormat::Obj => Ok(kittycad::types::InputFormat::Obj {
            coords: ZOO_COORD_SYSTEM,
            units: ul,
        }),
        kittycad::types::FileImportFormat::Gltf => Ok(kittycad::types::InputFormat::Gltf {}),
        kittycad::types::FileImportFormat::Ply => Ok(kittycad::types::InputFormat::Ply {
            coords: ZOO_COORD_SYSTEM,
            units: ul,
        }),
        kittycad::types::FileImportFormat::Fbx => Ok(kittycad::types::InputFormat::Fbx {}),
        kittycad::types::FileImportFormat::Sldprt => Ok(kittycad::types::InputFormat::Sldprt {}),
    }
}
