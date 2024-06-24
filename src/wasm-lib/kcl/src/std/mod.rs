//! Functions implemented for language execution.

pub mod chamfer;
pub mod extrude;
pub mod fillet;
pub mod helix;
pub mod import;
pub mod kcl_stdlib;
pub mod math;
pub mod patterns;
pub mod revolve;
pub mod segment;
pub mod shapes;
pub mod shell;
pub mod sketch;
pub mod types;
pub mod utils;

use std::collections::HashMap;

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::OkWebSocketResponseData;
use lazy_static::lazy_static;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::parse_json_number_as_f64,
    docs::StdLibFn,
    errors::{KclError, KclErrorDetails},
    executor::{
        ExecutorContext, ExtrudeGroup, ExtrudeGroupSet, ExtrudeSurface, MemoryItem, Metadata, ProgramMemory,
        SketchGroup, SketchGroupSet, SketchSurface, SourceRange,
    },
    std::{kcl_stdlib::KclStdLibFn, sketch::FaceTag},
};

pub type StdFn = fn(Args) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<MemoryItem, KclError>> + Send>>;

pub type FnMap = HashMap<String, StdFn>;

lazy_static! {
    static ref CORE_FNS: Vec<Box<dyn StdLibFn>> = vec![
        Box::new(LegLen),
        Box::new(LegAngX),
        Box::new(LegAngY),
        Box::new(crate::std::extrude::Extrude),
        Box::new(crate::std::segment::SegEndX),
        Box::new(crate::std::segment::SegEndY),
        Box::new(crate::std::segment::LastSegX),
        Box::new(crate::std::segment::LastSegY),
        Box::new(crate::std::segment::SegLen),
        Box::new(crate::std::segment::SegAng),
        Box::new(crate::std::segment::AngleToMatchLengthX),
        Box::new(crate::std::segment::AngleToMatchLengthY),
        Box::new(crate::std::shapes::Circle),
        Box::new(crate::std::sketch::LineTo),
        Box::new(crate::std::sketch::Line),
        Box::new(crate::std::sketch::XLineTo),
        Box::new(crate::std::sketch::XLine),
        Box::new(crate::std::sketch::YLineTo),
        Box::new(crate::std::sketch::YLine),
        Box::new(crate::std::sketch::AngledLineToX),
        Box::new(crate::std::sketch::AngledLineToY),
        Box::new(crate::std::sketch::AngledLine),
        Box::new(crate::std::sketch::AngledLineOfXLength),
        Box::new(crate::std::sketch::AngledLineOfYLength),
        Box::new(crate::std::sketch::AngledLineThatIntersects),
        Box::new(crate::std::sketch::StartSketchAt),
        Box::new(crate::std::sketch::StartSketchOn),
        Box::new(crate::std::sketch::StartProfileAt),
        Box::new(crate::std::sketch::ProfileStartX),
        Box::new(crate::std::sketch::ProfileStartY),
        Box::new(crate::std::sketch::ProfileStart),
        Box::new(crate::std::sketch::Close),
        Box::new(crate::std::sketch::Arc),
        Box::new(crate::std::sketch::TangentialArc),
        Box::new(crate::std::sketch::TangentialArcTo),
        Box::new(crate::std::sketch::BezierCurve),
        Box::new(crate::std::sketch::Hole),
        Box::new(crate::std::patterns::PatternLinear2D),
        Box::new(crate::std::patterns::PatternLinear3D),
        Box::new(crate::std::patterns::PatternCircular2D),
        Box::new(crate::std::patterns::PatternCircular3D),
        Box::new(crate::std::chamfer::Chamfer),
        Box::new(crate::std::fillet::Fillet),
        Box::new(crate::std::fillet::GetOppositeEdge),
        Box::new(crate::std::fillet::GetNextAdjacentEdge),
        Box::new(crate::std::fillet::GetPreviousAdjacentEdge),
        Box::new(crate::std::helix::Helix),
        Box::new(crate::std::shell::Shell),
        Box::new(crate::std::revolve::Revolve),
        Box::new(crate::std::revolve::GetEdge),
        Box::new(crate::std::import::Import),
        Box::new(crate::std::math::Cos),
        Box::new(crate::std::math::Sin),
        Box::new(crate::std::math::Tan),
        Box::new(crate::std::math::Acos),
        Box::new(crate::std::math::Asin),
        Box::new(crate::std::math::Atan),
        Box::new(crate::std::math::Pi),
        Box::new(crate::std::math::E),
        Box::new(crate::std::math::Tau),
        Box::new(crate::std::math::Sqrt),
        Box::new(crate::std::math::Abs),
        Box::new(crate::std::math::Floor),
        Box::new(crate::std::math::Ceil),
        Box::new(crate::std::math::Min),
        Box::new(crate::std::math::Max),
        Box::new(crate::std::math::Pow),
        Box::new(crate::std::math::Log),
        Box::new(crate::std::math::Log2),
        Box::new(crate::std::math::Log10),
        Box::new(crate::std::math::Ln),
        Box::new(crate::std::math::ToDegrees),
        Box::new(crate::std::math::ToRadians),
    ];
}

pub fn name_in_stdlib(name: &str) -> bool {
    CORE_FNS.iter().any(|f| f.name() == name)
}

pub struct StdLib {
    pub fns: HashMap<String, Box<dyn StdLibFn>>,
    pub kcl_fns: HashMap<String, Box<dyn KclStdLibFn>>,
}

impl std::fmt::Debug for StdLib {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StdLib")
            .field("fns.len()", &self.fns.len())
            .field("kcl_fns.len()", &self.kcl_fns.len())
            .finish()
    }
}

impl StdLib {
    pub fn new() -> Self {
        let fns = CORE_FNS
            .clone()
            .into_iter()
            .map(|internal_fn| (internal_fn.name(), internal_fn))
            .collect();

        let kcl_internal_fns: [Box<dyn KclStdLibFn>; 0] = [];
        let kcl_fns = kcl_internal_fns
            .into_iter()
            .map(|internal_fn| (internal_fn.name(), internal_fn))
            .collect();

        Self { fns, kcl_fns }
    }

    // Get the combined hashmaps.
    pub fn combined(&self) -> HashMap<String, Box<dyn StdLibFn>> {
        let mut combined = self.fns.clone();
        for (k, v) in self.kcl_fns.clone() {
            combined.insert(k, v.std_lib());
        }
        combined
    }

    pub fn get(&self, name: &str) -> Option<Box<dyn StdLibFn>> {
        self.fns.get(name).cloned()
    }

    pub fn get_kcl(&self, name: &str) -> Option<Box<dyn KclStdLibFn>> {
        self.kcl_fns.get(name).cloned()
    }

    pub fn get_either(&self, name: &str) -> FunctionKind {
        if let Some(f) = self.get(name) {
            FunctionKind::Core(f)
        } else if let Some(f) = self.get_kcl(name) {
            FunctionKind::Std(f)
        } else {
            FunctionKind::UserDefined
        }
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.fns.contains_key(key) || self.kcl_fns.contains_key(key)
    }
}

impl Default for StdLib {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub enum FunctionKind {
    Core(Box<dyn StdLibFn>),
    Std(Box<dyn KclStdLibFn>),
    UserDefined,
}

#[derive(Debug, Clone)]
pub struct Args {
    pub args: Vec<MemoryItem>,
    pub source_range: SourceRange,
    pub ctx: ExecutorContext,
    pub current_program_memory: ProgramMemory,
}

impl Args {
    pub fn new(
        args: Vec<MemoryItem>,
        source_range: SourceRange,
        ctx: ExecutorContext,
        current_program_memory: ProgramMemory,
    ) -> Self {
        Self {
            args,
            source_range,
            ctx,
            current_program_memory,
        }
    }

    // Add a modeling command to the batch but don't fire it right away.
    pub async fn batch_modeling_cmd(
        &self,
        id: uuid::Uuid,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        self.ctx.engine.batch_modeling_cmd(id, self.source_range, &cmd).await
    }

    // Add a modeling command to the batch that gets executed at the end of the file.
    // This is good for something like fillet or chamfer where the engine would
    // eat the path id if we executed it right away.
    pub async fn batch_end_cmd(
        &self,
        id: uuid::Uuid,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        self.ctx.engine.batch_end_cmd(id, self.source_range, &cmd).await
    }

    /// Send the modeling cmd and wait for the response.
    pub async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        self.ctx.engine.send_modeling_cmd(id, self.source_range, cmd).await
    }

    /// Flush just the fillets and chamfers for this specific ExtrudeGroupSet.
    pub async fn flush_batch_for_extrude_group_set(
        &self,
        extrude_groups: Vec<Box<ExtrudeGroup>>,
    ) -> Result<(), KclError> {
        // Make sure we don't traverse sketch_groups more than once.
        let mut traversed_sketch_groups = Vec::new();

        // Collect all the fillet/chamfer ids for the extrude groups.
        let mut ids = Vec::new();
        for extrude_group in extrude_groups {
            // We need to traverse the extrude groups that share the same sketch group.
            let sketch_group_id = extrude_group.sketch_group.id;
            if !traversed_sketch_groups.contains(&sketch_group_id) {
                // Find all the extrude groups on the same shared sketch group.
                ids.extend(
                    self.current_program_memory
                        .find_extrude_groups_on_sketch_group(extrude_group.sketch_group.id)
                        .iter()
                        .flat_map(|eg| eg.get_all_fillet_or_chamfer_ids()),
                );
                traversed_sketch_groups.push(sketch_group_id);
            }

            ids.extend(extrude_group.get_all_fillet_or_chamfer_ids());
        }

        // We can return early if there are no fillets or chamfers.
        if ids.is_empty() {
            return Ok(());
        }

        // We want to move these fillets and chamfers from batch_end to batch so they get executed
        // before what ever we call next.
        for id in ids {
            // Pop it off the batch_end and add it to the batch.
            let Some(item) = self.ctx.engine.batch_end().lock().unwrap().remove(&id) else {
                // It might be in the batch already.
                continue;
            };
            // Add it to the batch.
            self.ctx.engine.batch().lock().unwrap().push(item);
        }

        // Run flush.
        // Yes, we do need to actually flush the batch here, or references will fail later.
        self.ctx.engine.flush_batch(false, SourceRange::default()).await?;

        Ok(())
    }

    fn make_user_val_from_json(&self, j: serde_json::Value) -> Result<MemoryItem, KclError> {
        Ok(MemoryItem::UserVal(crate::executor::UserVal {
            value: j,
            meta: vec![Metadata {
                source_range: self.source_range,
            }],
        }))
    }

    fn make_user_val_from_f64(&self, f: f64) -> Result<MemoryItem, KclError> {
        self.make_user_val_from_json(serde_json::Value::Number(serde_json::Number::from_f64(f).ok_or_else(
            || {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to convert `{}` to a number", f),
                    source_ranges: vec![self.source_range],
                })
            },
        )?))
    }

    fn get_number(&self) -> Result<f64, KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a number as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        parse_json_number_as_f64(&first_value, self.source_range)
    }

    fn get_number_array(&self) -> Result<Vec<f64>, KclError> {
        let mut numbers: Vec<f64> = Vec::new();
        for arg in &self.args {
            let parsed = arg.get_json_value()?;
            numbers.push(parse_json_number_as_f64(&parsed, self.source_range)?);
        }
        Ok(numbers)
    }

    fn get_hypotenuse_leg(&self) -> Result<(f64, f64), KclError> {
        let numbers = self.get_number_array()?;

        if numbers.len() != 2 {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a number array of length 2, found `{:?}`", numbers),
                source_ranges: vec![self.source_range],
            }));
        }

        Ok((numbers[0], numbers[1]))
    }

    fn get_circle_args(
        &self,
    ) -> Result<([f64; 2], f64, crate::std::shapes::SketchSurfaceOrGroup, Option<String>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!(
                        "Expected a [number, number] as the first argument, found `{:?}`",
                        self.args
                    ),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let center: [f64; 2] = if let serde_json::Value::Array(arr) = first_value {
            if arr.len() != 2 {
                return Err(KclError::Type(KclErrorDetails {
                    message: format!(
                        "Expected a [number, number] as the first argument, found `{:?}`",
                        self.args
                    ),
                    source_ranges: vec![self.source_range],
                }));
            }
            let x = parse_json_number_as_f64(&arr[0], self.source_range)?;
            let y = parse_json_number_as_f64(&arr[1], self.source_range)?;
            [x, y]
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a [number, number] as the first argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        let second_value = self
            .args
            .get(1)
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a number as the second argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let radius: f64 = serde_json::from_value(second_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize number from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let third_value = self.args.get(2).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup or SketchSurface as the third argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group_or_surface = if let MemoryItem::SketchGroup(sg) = third_value {
            crate::std::shapes::SketchSurfaceOrGroup::SketchGroup(sg.clone())
        } else if let MemoryItem::Plane(sg) = third_value {
            crate::std::shapes::SketchSurfaceOrGroup::SketchSurface(SketchSurface::Plane(sg.clone()))
        } else if let MemoryItem::Face(sg) = third_value {
            crate::std::shapes::SketchSurfaceOrGroup::SketchSurface(SketchSurface::Face(sg.clone()))
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup or SketchSurface as the third argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        if let Some(fourth_value) = self.args.get(3) {
            let tag: String = serde_json::from_value(fourth_value.get_json_value()?).map_err(|e| {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to deserialize String from JSON: {}", e),
                    source_ranges: vec![self.source_range],
                })
            })?;
            Ok((center, radius, sketch_group_or_surface, Some(tag)))
        } else {
            Ok((center, radius, sketch_group_or_surface, None))
        }
    }

    fn get_segment_name_sketch_group(&self) -> Result<(String, Box<SketchGroup>), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a SketchGroup.
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a string as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let segment_name = if let serde_json::Value::String(s) = first_value {
            s.to_string()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a string as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((segment_name, sketch_group))
    }

    fn get_sketch_groups(&self) -> Result<(SketchGroupSet, Box<SketchGroup>), KclError> {
        let first_value = self.args.first().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_set = match first_value.get_sketch_group_set() {
            Ok(set) => set,
            Err(err) => {
                return Err(KclError::Type(KclErrorDetails {
                    message: format!("Expected an SketchGroupSet as the first argument: {}", err),
                    source_ranges: vec![self.source_range],
                }))
            }
        };

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((sketch_set, sketch_group))
    }

    fn get_sketch_group(&self) -> Result<Box<SketchGroup>, KclError> {
        let first_value = self.args.first().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = first_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok(sketch_group)
    }

    fn get_data<T: serde::de::DeserializeOwned>(&self) -> Result<T, KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        Ok(data)
    }

    fn get_import_data(&self) -> Result<(String, Option<crate::std::import::ImportFormat>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;
        let data: String = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a file path string: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        if let Some(second_value) = self.args.get(1) {
            let options: crate::std::import::ImportFormat = serde_json::from_value(second_value.get_json_value()?)
                .map_err(|e| {
                    KclError::Type(KclErrorDetails {
                        message: format!("Expected input format data: {}", e),
                        source_ranges: vec![self.source_range],
                    })
                })?;
            Ok((data, Some(options)))
        } else {
            Ok((data, None))
        }
    }

    fn get_sketch_group_and_optional_tag(&self) -> Result<(Box<SketchGroup>, Option<String>), KclError> {
        let first_value = self.args.first().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = first_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        if let Some(second_value) = self.args.get(1) {
            let tag: String = serde_json::from_value(second_value.get_json_value()?).map_err(|e| {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to deserialize String from JSON: {}", e),
                    source_ranges: vec![self.source_range],
                })
            })?;
            Ok((sketch_group, Some(tag)))
        } else {
            Ok((sketch_group, None))
        }
    }

    fn get_data_and_optional_tag<T: serde::de::DeserializeOwned>(&self) -> Result<(T, Option<FaceTag>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        if let Some(second_value) = self.args.get(1) {
            let tag: FaceTag = serde_json::from_value(second_value.get_json_value()?).map_err(|e| {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to deserialize FaceTag from JSON: {}", e),
                    source_ranges: vec![self.source_range],
                })
            })?;
            Ok((data, Some(tag)))
        } else {
            Ok((data, None))
        }
    }

    fn get_data_and_sketch_group<T: serde::de::DeserializeOwned>(&self) -> Result<(T, Box<SketchGroup>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((data, sketch_group))
    }

    fn get_data_and_sketch_group_set<T: serde::de::DeserializeOwned>(&self) -> Result<(T, SketchGroupSet), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_set = match second_value.get_sketch_group_set() {
            Ok(set) => set,
            Err(err) => {
                return Err(KclError::Type(KclErrorDetails {
                    message: format!("Expected an SketchGroupSet as the second argument: {}", err),
                    source_ranges: vec![self.source_range],
                }))
            }
        };

        Ok((data, sketch_set))
    }

    fn get_data_and_sketch_group_and_tag<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, Box<SketchGroup>, Option<String>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };
        let tag = if let Some(tag) = self.args.get(2) {
            tag.get_json_opt()?
        } else {
            None
        };

        Ok((data, sketch_group, tag))
    }

    fn get_data_and_sketch_surface<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, SketchSurface, Option<String>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a Plane as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_surface = if let MemoryItem::Plane(p) = second_value {
            SketchSurface::Plane(p.clone())
        } else if let MemoryItem::Face(face) = second_value {
            SketchSurface::Face(face.clone())
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a plane or face (SketchSurface) as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };
        let tag = if let Some(tag) = self.args.get(2) {
            tag.get_json_opt()?
        } else {
            None
        };

        Ok((data, sketch_surface, tag))
    }

    fn get_data_and_extrude_group_set<T: serde::de::DeserializeOwned>(&self) -> Result<(T, ExtrudeGroupSet), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected an ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let extrude_set = match second_value.get_extrude_group_set() {
            Ok(set) => set,
            Err(err) => {
                return Err(KclError::Type(KclErrorDetails {
                    message: format!("Expected an ExtrudeGroupSet as the second argument: {}", err),
                    source_ranges: vec![self.source_range],
                }))
            }
        };

        Ok((data, extrude_set))
    }

    fn get_data_and_extrude_group<T: serde::de::DeserializeOwned>(&self) -> Result<(T, Box<ExtrudeGroup>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected an ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let extrude_group = if let MemoryItem::ExtrudeGroup(eg) = second_value {
            eg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected an ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((data, extrude_group))
    }

    fn get_data_and_extrude_group_and_tag<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, Box<ExtrudeGroup>, Option<String>), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let data: T = serde_json::from_value(first_value).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: vec![self.source_range],
            })
        })?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected an ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let extrude_group = if let MemoryItem::ExtrudeGroup(eg) = second_value {
            eg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected an ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };
        let tag = if let Some(tag) = self.args.get(2) {
            tag.get_json_opt()?
        } else {
            None
        };

        Ok((data, extrude_group, tag))
    }

    fn get_segment_name_to_number_sketch_group(&self) -> Result<(String, f64, Box<SketchGroup>), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a number.
        // The third argument should be a SketchGroup.
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a string as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let segment_name = if let serde_json::Value::String(s) = first_value {
            s.to_string()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a string as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        let second_value = self
            .args
            .get(1)
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a number as the second argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let to_number = parse_json_number_as_f64(&second_value, self.source_range)?;

        let third_value = self.args.get(2).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the third argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = third_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the third argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((segment_name, to_number, sketch_group))
    }

    fn get_number_sketch_group_set(&self) -> Result<(f64, SketchGroupSet), KclError> {
        // Iterate over our args, the first argument should be a number.
        // The second argument should be a SketchGroup.
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Expected a number as the first argument, found `{:?}`", self.args),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let number = parse_json_number_as_f64(&first_value, self.source_range)?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_set = match second_value.get_sketch_group_set() {
            Ok(set) => set,
            Err(err) => {
                return Err(KclError::Type(KclErrorDetails {
                    message: format!("Expected an SketchGroupSet as the second argument: {}", err),
                    source_ranges: vec![self.source_range],
                }))
            }
        };

        Ok((number, sketch_set))
    }

    pub async fn get_adjacent_face_to_tag(
        &self,
        extrude_group: &ExtrudeGroup,
        tag: &str,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        if tag.is_empty() {
            return Err(KclError::Type(KclErrorDetails {
                message: "Expected a non-empty tag for the face".to_string(),
                source_ranges: vec![self.source_range],
            }));
        }

        if let Some(face_from_surface) = extrude_group
            .value
            .iter()
            .find_map(|extrude_surface| match extrude_surface {
                ExtrudeSurface::ExtrudePlane(extrude_plane) if extrude_plane.name == tag => {
                    Some(Ok(extrude_plane.face_id))
                }
                // The must be planar check must be called before the arc check.
                ExtrudeSurface::ExtrudeArc(_) if must_be_planar => Some(Err(KclError::Type(KclErrorDetails {
                    message: format!("Tag `{}` is a non-planar surface", tag),
                    source_ranges: vec![self.source_range],
                }))),
                ExtrudeSurface::ExtrudeArc(extrude_arc) if extrude_arc.name == tag => Some(Ok(extrude_arc.face_id)),
                ExtrudeSurface::ExtrudePlane(_) | ExtrudeSurface::ExtrudeArc(_) => None,
            })
        {
            return face_from_surface;
        }

        // A face could also be the result of a chamfer or fillet.
        if let Some(face_from_chamfer_fillet) = extrude_group.fillet_or_chamfers.iter().find_map(|fc| {
            if fc.tag() == Some(tag) {
                Some(Ok(fc.id()))
            } else {
                None
            }
        }) {
            // We want to make sure we execute the fillet before this operation.
            self.flush_batch_for_extrude_group_set(extrude_group.into()).await?;

            return face_from_chamfer_fillet;
        }

        // If we still haven't found the face, return an error.
        Err(KclError::Type(KclErrorDetails {
            message: format!("Expected a face with the tag `{}`", tag),
            source_ranges: vec![self.source_range],
        }))
    }
}

/// Returns the length of the given leg.
pub async fn leg_length(args: Args) -> Result<MemoryItem, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = inner_leg_length(hypotenuse, leg);
    args.make_user_val_from_f64(result)
}

/// Returns the length of the given leg.
///
/// ```no_run
/// legLen(5, 3)
/// ```
#[stdlib {
    name = "legLen",
    tags = ["utilities"],
}]
fn inner_leg_length(hypotenuse: f64, leg: f64) -> f64 {
    (hypotenuse.powi(2) - f64::min(hypotenuse.abs(), leg.abs()).powi(2)).sqrt()
}

/// Returns the angle of the given leg for x.
pub async fn leg_angle_x(args: Args) -> Result<MemoryItem, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = inner_leg_angle_x(hypotenuse, leg);
    args.make_user_val_from_f64(result)
}

/// Returns the angle of the given leg for x.
///
/// ```no_run
/// legAngX(5, 3)
/// ```
#[stdlib {
    name = "legAngX",
    tags = ["utilities"],
}]
fn inner_leg_angle_x(hypotenuse: f64, leg: f64) -> f64 {
    (leg.min(hypotenuse) / hypotenuse).acos().to_degrees()
}

/// Returns the angle of the given leg for y.
pub async fn leg_angle_y(args: Args) -> Result<MemoryItem, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = inner_leg_angle_y(hypotenuse, leg);
    args.make_user_val_from_f64(result)
}

/// Returns the angle of the given leg for y.
///
/// ```no_run
/// legAngY(5, 3)
/// ```
#[stdlib {
    name = "legAngY",
    tags = ["utilities"],
}]
fn inner_leg_angle_y(hypotenuse: f64, leg: f64) -> f64 {
    (leg.min(hypotenuse) / hypotenuse).asin().to_degrees()
}

/// The primitive types that can be used in a KCL file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, Display, FromStr)]
#[serde(rename_all = "lowercase")]
#[display(style = "lowercase")]
pub enum Primitive {
    /// A boolean value.
    Bool,
    /// A number value.
    Number,
    /// A string value.
    String,
    /// A uuid value.
    Uuid,
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use convert_case::Casing;
    use itertools::Itertools;

    use crate::std::StdLib;

    #[test]
    fn test_generate_stdlib_markdown_docs() {
        let stdlib = StdLib::new();
        let combined = stdlib.combined();
        let mut buf = String::new();

        buf.push_str(
            r#"---
title: "KCL Standard Library"
excerpt: "Documentation for the KCL standard library for the Zoo Modeling App."
layout: manual
---

"#,
        );

        // Generate a table of contents.
        buf.push_str("## Table of Contents\n\n");

        buf.push_str("* [Types](kcl/types)\n");
        buf.push_str("* [Known Issues](kcl/KNOWN-ISSUES)\n");

        for key in combined.keys().sorted() {
            let internal_fn = combined.get(key).unwrap();
            if internal_fn.unpublished() || internal_fn.deprecated() {
                continue;
            }

            buf.push_str(&format!("* [`{}`](kcl/{})\n", internal_fn.name(), internal_fn.name()));
        }

        // Write the index.
        expectorate::assert_contents("../../../docs/kcl/index.md", &buf);

        for key in combined.keys().sorted() {
            let mut buf = String::new();
            let internal_fn = combined.get(key).unwrap();
            if internal_fn.unpublished() {
                continue;
            }

            let mut fn_docs = String::new();

            fn_docs.push_str(&format!(
                r#"---
title: "{}"
excerpt: "{}"
layout: manual
---

"#,
                internal_fn.name(),
                internal_fn.summary()
            ));

            if internal_fn.deprecated() {
                fn_docs.push_str("**WARNING:** This function is deprecated.\n\n");
            }

            fn_docs.push_str(&format!("{}\n\n", internal_fn.summary()));
            fn_docs.push_str(&format!("{}\n\n", internal_fn.description()));

            fn_docs.push_str("```js\n");
            let signature = internal_fn.fn_signature();
            fn_docs.push_str(&signature);
            fn_docs.push_str("\n```\n\n");

            // If the function has tags, we should add them to the docs.
            let tags = internal_fn.tags().clone();
            if !tags.is_empty() {
                fn_docs.push_str("### Tags\n\n");
                for tag in tags {
                    fn_docs.push_str(&format!("* `{}`\n", tag));
                }
                fn_docs.push('\n');
            }

            if !internal_fn.examples().is_empty() {
                fn_docs.push_str("### Examples\n\n");

                for (index, example) in internal_fn.examples().iter().enumerate() {
                    fn_docs.push_str("```js\n");
                    fn_docs.push_str(example);
                    fn_docs.push_str("\n```\n\n");

                    // If this is not a "utilities" function,
                    // we should add the image to the docs.
                    if !internal_fn.tags().contains(&"utilities".to_string()) {
                        // Get the path to this specific rust file.
                        let dir = env!("CARGO_MANIFEST_DIR");

                        // Convert from camel case to snake case.
                        let mut fn_name = internal_fn.name().to_case(convert_case::Case::Snake);
                        // Clean the fn name.
                        if fn_name.starts_with("last_seg_") {
                            fn_name = fn_name.replace("last_seg_", "last_segment_");
                        } else if fn_name.contains("_2_d") {
                            fn_name = fn_name.replace("_2_d", "_2d");
                        } else if fn_name.contains("_3_d") {
                            fn_name = fn_name.replace("_3_d", "_3d");
                        } else if fn_name == "seg_ang" {
                            fn_name = "segment_angle".to_string();
                        } else if fn_name == "seg_len" {
                            fn_name = "segment_length".to_string();
                        } else if fn_name.starts_with("seg_") {
                            fn_name = fn_name.replace("seg_", "segment_");
                        } else if fn_name.starts_with("log_") {
                            fn_name = fn_name.replace("log_", "log");
                        }

                        // Read the image file and encode as base64.
                        let image_path = format!("{}/tests/outputs/serial_test_example_{}{}.png", dir, fn_name, index);

                        let image_data = std::fs::read(&image_path)
                            .unwrap_or_else(|_| panic!("Failed to read image file: {}", image_path));
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&image_data);

                        fn_docs.push_str(&format!(
                            r#"![Rendered example of {} {}](data:image/png;base64,{})

"#,
                            internal_fn.name(),
                            index,
                            encoded,
                        ));
                    }
                }
            }

            fn_docs.push_str("### Arguments\n\n");
            for arg in internal_fn.args() {
                let (format, should_be_indented) = arg.get_type_string().unwrap();
                let optional_string = if arg.required { " (REQUIRED)" } else { " (OPTIONAL)" }.to_string();
                if let Some(description) = arg.description() {
                    fn_docs.push_str(&format!(
                        "* `{}`: `{}` - {}{}\n",
                        arg.name, arg.type_, description, optional_string
                    ));
                } else {
                    fn_docs.push_str(&format!("* `{}`: `{}`{}\n", arg.name, arg.type_, optional_string));
                }

                if should_be_indented {
                    fn_docs.push_str(&format!("```js\n{}\n```\n", format));
                }
            }

            if let Some(return_type) = internal_fn.return_value() {
                fn_docs.push_str("\n### Returns\n\n");
                if let Some(description) = return_type.description() {
                    fn_docs.push_str(&format!("`{}` - {}\n", return_type.type_, description));
                } else {
                    fn_docs.push_str(&format!("`{}`\n", return_type.type_));
                }

                let (format, should_be_indented) = return_type.get_type_string().unwrap();
                if should_be_indented {
                    fn_docs.push_str(&format!("```js\n{}\n```\n", format));
                }
            }

            fn_docs.push_str("\n\n\n");

            buf.push_str(&fn_docs);

            // Write the file.
            expectorate::assert_contents(&format!("../../../docs/kcl/{}.md", internal_fn.name()), &buf);
        }
    }

    #[test]
    fn test_generate_stdlib_json_schema() {
        let stdlib = StdLib::new();
        let combined = stdlib.combined();

        let mut json_data = vec![];

        for key in combined.keys().sorted() {
            let internal_fn = combined.get(key).unwrap();
            json_data.push(internal_fn.to_json().unwrap());
        }
        expectorate::assert_contents(
            "../../../docs/kcl/std.json",
            &serde_json::to_string_pretty(&json_data).unwrap(),
        );
    }
}
