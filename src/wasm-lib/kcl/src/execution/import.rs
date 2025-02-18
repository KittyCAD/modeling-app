use std::{ffi::OsStr, path::Path, str::FromStr};

use anyhow::Result;
use kcmc::{
    coord::{System, KITTYCAD},
    each_cmd as mcmd,
    format::InputFormat,
    ok_response::OkModelingCmdResponse,
    shared::FileImportFormat,
    units::UnitLength,
    websocket::OkWebSocketResponseData,
    ImportFile, ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{annotations, kcl_value::UnitLen, ExecState, ExecutorContext, ImportedGeometry},
    fs::FileSystem,
    parsing::ast::types::{Annotation, Node},
    source_range::SourceRange,
};

// Zoo co-ordinate system.
//
// * Forward: -Y
// * Up: +Z
// * Handedness: Right
pub const ZOO_COORD_SYSTEM: System = *KITTYCAD;

pub async fn import_foreign(
    file_path: &Path,
    format: Option<InputFormat>,
    exec_state: &mut ExecState,
    ctxt: &ExecutorContext,
    source_range: SourceRange,
) -> Result<PreImportedGeometry, KclError> {
    // Make sure the file exists.
    if !ctxt.fs.exists(file_path, source_range).await? {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("File `{}` does not exist.", file_path.display()),
            source_ranges: vec![source_range],
        }));
    }

    let ext_format =
        get_import_format_from_extension(file_path.extension().and_then(OsStr::to_str).ok_or_else(|| {
            KclError::Semantic(KclErrorDetails {
                message: format!("No file extension found for `{}`", file_path.display()),
                source_ranges: vec![source_range],
            })
        })?)
        .map_err(|e| {
            KclError::Semantic(KclErrorDetails {
                message: e.to_string(),
                source_ranges: vec![source_range],
            })
        })?;

    // Get the format type from the extension of the file.
    let format = if let Some(format) = format {
        // Validate the given format with the extension format.
        validate_extension_format(ext_format, format.clone()).map_err(|e| {
            KclError::Semantic(KclErrorDetails {
                message: e.to_string(),
                source_ranges: vec![source_range],
            })
        })?;
        format
    } else {
        ext_format
    };

    // Get the file contents for each file path.
    let file_contents = ctxt.fs.read(file_path, source_range).await.map_err(|e| {
        KclError::Semantic(KclErrorDetails {
            message: e.to_string(),
            source_ranges: vec![source_range],
        })
    })?;

    // We want the file_path to be without the parent.
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| {
            KclError::Semantic(KclErrorDetails {
                message: format!("Could not get the file name from the path `{}`", file_path.display()),
                source_ranges: vec![source_range],
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
                    source_ranges: vec![source_range],
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
                                    message: format!(
                                        "Could not get the parent path of the file `{}`",
                                        file_path.display()
                                    ),
                                    source_ranges: vec![source_range],
                                })
                            })?;

                        let bin_contents = ctxt.fs.read(&bin_path, source_range).await.map_err(|e| {
                            KclError::Semantic(KclErrorDetails {
                                message: e.to_string(),
                                source_ranges: vec![source_range],
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
    Ok(PreImportedGeometry {
        id: exec_state.next_uuid(),
        source_range,
        command: mcmd::ImportFiles {
            files: import_files.clone(),
            format,
        },
    })
}

pub(super) fn format_from_annotations(
    annotations: &[Node<Annotation>],
    path: &Path,
    import_source_range: SourceRange,
) -> Result<Option<InputFormat>, KclError> {
    if annotations.is_empty() {
        return Ok(None);
    }

    let props = annotations.iter().flat_map(|a| a.properties.as_deref().unwrap_or(&[]));

    let mut result = None;
    for p in props.clone() {
        if p.key.name == annotations::IMPORT_FORMAT {
            result = Some(
                get_import_format_from_extension(annotations::expect_ident(&p.value)?).map_err(|_| {
                    KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "Unknown format for import, expected one of: {}",
                            annotations::IMPORT_FORMAT_VALUES.join(", ")
                        ),
                        source_ranges: vec![p.as_source_range()],
                    })
                })?,
            );
            break;
        }
    }

    let mut result = result
        .or_else(|| {
            path.extension()
                .and_then(OsStr::to_str)
                .and_then(|ext| get_import_format_from_extension(ext).ok())
        })
        .ok_or(KclError::Semantic(KclErrorDetails {
            message: "Unknown or missing extension, and no specified format for imported file".to_owned(),
            source_ranges: vec![import_source_range],
        }))?;

    for p in props {
        match p.key.name.as_str() {
            annotations::IMPORT_COORDS => {
                set_coords(&mut result, annotations::expect_ident(&p.value)?, p.as_source_range())?;
            }
            annotations::IMPORT_LENGTH_UNIT => {
                set_length_unit(&mut result, annotations::expect_ident(&p.value)?, p.as_source_range())?;
            }
            annotations::IMPORT_FORMAT => {}
            _ => {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Unexpected annotation for import, expected one of: {}, {}, {}",
                        annotations::IMPORT_FORMAT,
                        annotations::IMPORT_COORDS,
                        annotations::IMPORT_LENGTH_UNIT
                    ),
                    source_ranges: vec![p.as_source_range()],
                }))
            }
        }
    }

    Ok(Some(result))
}

fn set_coords(fmt: &mut InputFormat, coords_str: &str, source_range: SourceRange) -> Result<(), KclError> {
    let mut coords = None;
    for (name, val) in annotations::IMPORT_COORDS_VALUES {
        if coords_str == name {
            coords = Some(*val);
        }
    }

    let Some(coords) = coords else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!(
                "Unknown coordinate system: {coords_str}, expected one of: {}",
                annotations::IMPORT_COORDS_VALUES
                    .iter()
                    .map(|(n, _)| *n)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            source_ranges: vec![source_range],
        }));
    };

    match fmt {
        InputFormat::Obj(opts) => opts.coords = coords,
        InputFormat::Ply(opts) => opts.coords = coords,
        InputFormat::Stl(opts) => opts.coords = coords,
        _ => {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "`{}` option cannot be applied to the specified format",
                    annotations::IMPORT_COORDS
                ),
                source_ranges: vec![source_range],
            }))
        }
    }

    Ok(())
}

fn set_length_unit(fmt: &mut InputFormat, units_str: &str, source_range: SourceRange) -> Result<(), KclError> {
    let units = UnitLen::from_str(units_str, source_range)?;

    match fmt {
        InputFormat::Obj(opts) => opts.units = units.into(),
        InputFormat::Ply(opts) => opts.units = units.into(),
        InputFormat::Stl(opts) => opts.units = units.into(),
        _ => {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "`{}` option cannot be applied to the specified format",
                    annotations::IMPORT_LENGTH_UNIT
                ),
                source_ranges: vec![source_range],
            }))
        }
    }

    Ok(())
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct PreImportedGeometry {
    id: Uuid,
    command: mcmd::ImportFiles,
    pub source_range: SourceRange,
}

pub async fn send_to_engine(pre: PreImportedGeometry, ctxt: &ExecutorContext) -> Result<ImportedGeometry, KclError> {
    if ctxt.no_engine_commands().await {
        return Ok(ImportedGeometry {
            id: pre.id,
            value: pre.command.files.iter().map(|f| f.path.to_string()).collect(),
            meta: vec![pre.source_range.into()],
        });
    }

    let resp = ctxt
        .engine
        .send_modeling_cmd(pre.id, pre.source_range, &ModelingCmd::from(pre.command.clone()))
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::ImportFiles(imported_files),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("ImportFiles response was not as expected: {:?}", resp),
            source_ranges: vec![pre.source_range],
        }));
    };

    Ok(ImportedGeometry {
        id: imported_files.object_id,
        value: pre.command.files.iter().map(|f| f.path.to_string()).collect(),
        meta: vec![pre.source_range.into()],
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
                anyhow::bail!("unknown source format for file extension: {ext}. Try setting the `--src-format` flag explicitly or use a valid format.")
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

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn annotations() {
        // no annotations
        assert!(
            format_from_annotations(&[], Path::new("../foo.txt"), SourceRange::default(),)
                .unwrap()
                .is_none()
        );

        // no format, no options
        let text = "@()\nimport '../foo.gltf' as foo";
        let parsed = crate::Program::parse_no_errs(text).unwrap().ast;
        let attrs = parsed.body[0].get_attrs();
        let fmt = format_from_annotations(attrs, Path::new("../foo.gltf"), SourceRange::default())
            .unwrap()
            .unwrap();
        assert_eq!(
            fmt,
            InputFormat::Gltf(kittycad_modeling_cmds::format::gltf::import::Options {})
        );

        // format, no options
        let text = "@(format = gltf)\nimport '../foo.txt' as foo";
        let parsed = crate::Program::parse_no_errs(text).unwrap().ast;
        let attrs = parsed.body[0].get_attrs();
        let fmt = format_from_annotations(attrs, Path::new("../foo.txt"), SourceRange::default())
            .unwrap()
            .unwrap();
        assert_eq!(
            fmt,
            InputFormat::Gltf(kittycad_modeling_cmds::format::gltf::import::Options {})
        );

        // format, no extension (wouldn't parse but might some day)
        let fmt = format_from_annotations(attrs, Path::new("../foo"), SourceRange::default())
            .unwrap()
            .unwrap();
        assert_eq!(
            fmt,
            InputFormat::Gltf(kittycad_modeling_cmds::format::gltf::import::Options {})
        );

        // format, options
        let text = "@(format = obj, coords = vulkan, lengthUnit = ft)\nimport '../foo.txt' as foo";
        let parsed = crate::Program::parse_no_errs(text).unwrap().ast;
        let attrs = parsed.body[0].get_attrs();
        let fmt = format_from_annotations(attrs, Path::new("../foo.txt"), SourceRange::default())
            .unwrap()
            .unwrap();
        assert_eq!(
            fmt,
            InputFormat::Obj(kittycad_modeling_cmds::format::obj::import::Options {
                coords: *kittycad_modeling_cmds::coord::VULKAN,
                units: kittycad_modeling_cmds::units::UnitLength::Feet,
            })
        );

        // no format, options
        let text = "@(coords = vulkan, lengthUnit = ft)\nimport '../foo.obj' as foo";
        let parsed = crate::Program::parse_no_errs(text).unwrap().ast;
        let attrs = parsed.body[0].get_attrs();
        let fmt = format_from_annotations(attrs, Path::new("../foo.obj"), SourceRange::default())
            .unwrap()
            .unwrap();
        assert_eq!(
            fmt,
            InputFormat::Obj(kittycad_modeling_cmds::format::obj::import::Options {
                coords: *kittycad_modeling_cmds::coord::VULKAN,
                units: kittycad_modeling_cmds::units::UnitLength::Feet,
            })
        );

        // err - format, options, but no options for specified format
        assert_annotation_error(
            "@(format = gltf, lengthUnit = ft)\nimport '../foo.txt' as foo",
            "../foo.txt",
            "`lengthUnit` option cannot be applied",
        );
        // err - no format, options, but no options for specified format
        assert_annotation_error(
            "@(lengthUnit = ft)\nimport '../foo.gltf' as foo",
            "../foo.gltf",
            "lengthUnit` option cannot be applied",
        );
        // err - bad option
        assert_annotation_error(
            "@(format = obj, coords = vulkan, lengthUni = ft)\nimport '../foo.txt' as foo",
            "../foo.txt",
            "Unexpected annotation",
        );
        // err - bad format
        assert_annotation_error(
            "@(format = foo)\nimport '../foo.txt' as foo",
            "../foo.txt",
            "Unknown format for import",
        );
        // err - bad coord value
        assert_annotation_error(
            "@(format = gltf, coords = north)\nimport '../foo.txt' as foo",
            "../foo.txt",
            "Unknown coordinate system",
        );
        // err - bad unit value
        assert_annotation_error(
            "@(format = gltf, lengthUnit = gallons)\nimport '../foo.txt' as foo",
            "../foo.txt",
            "Unexpected value for length units",
        );
    }

    #[track_caller]
    fn assert_annotation_error(src: &str, path: &str, expected: &str) {
        let parsed = crate::Program::parse_no_errs(src).unwrap().ast;
        let attrs = parsed.body[0].get_attrs();
        let err = format_from_annotations(attrs, Path::new(path), SourceRange::default()).unwrap_err();
        assert!(
            err.message().contains(expected),
            "Expected: `{expected}`, found `{}`",
            err.message()
        );
    }
}
