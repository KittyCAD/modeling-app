//! Standard library functions involved in importing files.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{coord::System, format::InputFormat3d, units::UnitLength};
use kittycad_modeling_cmds as kcmc;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{import_foreign, send_import_to_engine, ExecState, ImportedGeometry, KclValue, ZOO_COORD_SYSTEM},
    std::Args,
};

/// Import format specifier
#[derive(serde :: Serialize, serde :: Deserialize, PartialEq, Debug, Clone, schemars :: JsonSchema)]
#[cfg_attr(feature = "tabled", derive(tabled::Tabled))]
#[serde(tag = "format")]
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

impl From<ImportFormat> for InputFormat3d {
    fn from(format: ImportFormat) -> Self {
        match format {
            ImportFormat::Fbx {} => InputFormat3d::Fbx(Default::default()),
            ImportFormat::Gltf {} => InputFormat3d::Gltf(Default::default()),
            ImportFormat::Obj { coords, units } => InputFormat3d::Obj(kcmc::format::obj::import::Options {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            }),
            ImportFormat::Ply { coords, units } => InputFormat3d::Ply(kcmc::format::ply::import::Options {
                coords: coords.unwrap_or(ZOO_COORD_SYSTEM),
                units,
            }),
            ImportFormat::Sldprt {} => InputFormat3d::Sldprt(kcmc::format::sldprt::import::Options {
                split_closed_faces: false,
            }),
            ImportFormat::Step {} => InputFormat3d::Step(kcmc::format::step::import::Options {
                split_closed_faces: false,
            }),
            ImportFormat::Stl { coords, units } => InputFormat3d::Stl(kcmc::format::stl::import::Options {
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
/// **DEPRECATED** Prefer to use import statements.
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
/// ```no_run
/// model = import("tests/inputs/cube.obj")
/// ```
///
/// ```no_run
/// model = import("tests/inputs/cube.obj", {format: "obj", units: "m"})
/// ```
///
/// ```no_run
/// model = import("tests/inputs/cube.gltf")
/// ```
///
/// ```no_run
/// model = import("tests/inputs/cube.sldprt")
/// ```
///
/// ```no_run
/// model = import("tests/inputs/cube.step")
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
    feature_tree_operation = true,
    deprecated = true,
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

    let format = options.map(InputFormat3d::from);
    send_import_to_engine(
        import_foreign(
            std::path::Path::new(&file_path),
            format,
            exec_state,
            &args.ctx,
            args.source_range,
        )
        .await?,
        &args.ctx,
    )
    .await
}
