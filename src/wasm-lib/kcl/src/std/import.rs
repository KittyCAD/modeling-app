//! Standard library functions involved in importing files.

use std::str::FromStr;

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ImportedGeometry, MemoryItem},
    std::Args,
};

/// Import a CAD file.
/// For formats lacking unit data (STL, OBJ, PLY), the default import unit is millimeters.
/// Otherwise you can specify the unit by passing in the options parameter.
pub async fn import(args: Args) -> Result<MemoryItem, KclError> {
    let (file_paths, options): (Vec<String>, Option<kittycad::types::InputFormat>) = args.get_import_data()?;

    let imported_geometry = inner_import(file_paths, options, args).await?;
    Ok(MemoryItem::ImportedGeometry(imported_geometry))
}

/// Import a CAD file.
#[stdlib {
    name = "import",
}]
async fn inner_import(
    file_paths: Vec<String>,
    options: Option<kittycad::types::InputFormat>,
    args: Args,
) -> Result<ImportedGeometry, KclError> {
    if file_paths.is_empty() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "No file paths were provided.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // TODO: we need to ensure that the file paths are all related to a single mesh and not multiple meshes.
    // In that if there is more than one file, its like a glTF file with binary data.

    // Get the format type from the extension of the file.
    let format = if let Some(options) = options {
        options
    } else {
        get_import_format_from_extension(file_paths[0].split('.').last().ok_or_else(|| {
            KclError::Semantic(KclErrorDetails {
                message: format!("No file extension found for `{}`", file_paths[0]),
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
    let fsm = crate::fs::FileManager::new();
    let mut import_files: Vec<kittycad::types::ImportFile> = Vec::new();
    for file_path in &file_paths {
        let file_contents = fsm.read(file_path).await.map_err(|e| {
            KclError::Semantic(KclErrorDetails {
                message: e.to_string(),
                source_ranges: vec![args.source_range],
            })
        })?;

        import_files.push(kittycad::types::ImportFile {
            path: file_path.to_string(),
            data: file_contents,
        });
    }

    let id = uuid::Uuid::new_v4();
    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::ImportFiles {
                files: import_files,
                format,
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::ImportFiles { data: import_files },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("ImportFiles response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(ImportedGeometry {
        id: import_files.object_id,
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
    let coords = kittycad::types::System {
        forward: kittycad::types::AxisDirectionPair {
            axis: kittycad::types::Axis::Y,
            direction: kittycad::types::Direction::Negative,
        },
        up: kittycad::types::AxisDirectionPair {
            axis: kittycad::types::Axis::Z,
            direction: kittycad::types::Direction::Positive,
        },
    };
    match format {
        kittycad::types::FileImportFormat::Step => Ok(kittycad::types::InputFormat::Step {}),
        kittycad::types::FileImportFormat::Stl => Ok(kittycad::types::InputFormat::Stl { coords, units: ul }),
        kittycad::types::FileImportFormat::Obj => Ok(kittycad::types::InputFormat::Obj { coords, units: ul }),
        kittycad::types::FileImportFormat::Gltf => Ok(kittycad::types::InputFormat::Gltf {}),
        kittycad::types::FileImportFormat::Ply => Ok(kittycad::types::InputFormat::Ply { coords, units: ul }),
        kittycad::types::FileImportFormat::Fbx => Ok(kittycad::types::InputFormat::Fbx {}),
        kittycad::types::FileImportFormat::Sldprt => Ok(kittycad::types::InputFormat::Sldprt {}),
    }
}
