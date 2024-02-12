//! Functions implemented for language execution.

pub mod extrude;
pub mod import;
pub mod kcl_stdlib;
pub mod math;
pub mod patterns;
pub mod segment;
pub mod shapes;
pub mod sketch;
pub mod utils;

use std::collections::HashMap;

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::OkWebSocketResponseData;
use lazy_static::lazy_static;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use self::kcl_stdlib::KclStdLibFn;
use crate::{
    ast::types::parse_json_number_as_f64,
    docs::StdLibFn,
    engine::EngineManager,
    errors::{KclError, KclErrorDetails},
    executor::{
        ExecutorContext, ExtrudeGroup, Geometry, MemoryItem, Metadata, Plane, SketchGroup, SketchGroupSet, SourceRange,
    },
};

pub type StdFn = fn(Args) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<MemoryItem, KclError>>>>;
pub type FnMap = HashMap<String, StdFn>;

lazy_static! {
    static ref CORE_FNS: Vec<Box<dyn StdLibFn>> = vec![
        Box::new(Show),
        Box::new(LegLen),
        Box::new(LegAngX),
        Box::new(LegAngY),
        Box::new(crate::std::extrude::Extrude),
        Box::new(crate::std::extrude::GetExtrudeWallTransform),
        Box::new(crate::std::segment::SegEndX),
        Box::new(crate::std::segment::SegEndY),
        Box::new(crate::std::segment::LastSegX),
        Box::new(crate::std::segment::LastSegY),
        Box::new(crate::std::segment::SegLen),
        Box::new(crate::std::segment::SegAng),
        Box::new(crate::std::segment::AngleToMatchLengthX),
        Box::new(crate::std::segment::AngleToMatchLengthY),
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
        Box::new(crate::std::sketch::Close),
        Box::new(crate::std::sketch::Arc),
        Box::new(crate::std::sketch::TangentialArc),
        Box::new(crate::std::sketch::TangentialArcTo),
        Box::new(crate::std::sketch::BezierCurve),
        Box::new(crate::std::sketch::Hole),
        Box::new(crate::std::patterns::PatternLinear),
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

        let kcl_internal_fns: [Box<dyn KclStdLibFn>; 1] = [Box::<shapes::Circle>::default()];
        let kcl_fns = kcl_internal_fns
            .into_iter()
            .map(|internal_fn| (internal_fn.name(), internal_fn))
            .collect();

        Self { fns, kcl_fns }
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
}

impl Args {
    pub fn new(args: Vec<MemoryItem>, source_range: SourceRange, ctx: ExecutorContext) -> Self {
        Self {
            args,
            source_range,
            ctx,
        }
    }

    pub async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        self.ctx.engine.send_modeling_cmd(id, self.source_range, cmd).await
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

        let sketch_set = if let MemoryItem::SketchGroup(sg) = first_value {
            SketchGroupSet::SketchGroup(sg.clone())
        } else if let MemoryItem::SketchGroups { value } = first_value {
            SketchGroupSet::SketchGroups(value.clone())
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup or Vector of SketchGroups as the first argument, found `{:?}`",
                    self.args
                ),
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

    fn get_data_and_geometry<T: serde::de::DeserializeOwned>(&self) -> Result<(T, Geometry), KclError> {
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

        let geometry = if let MemoryItem::SketchGroup(sg) = second_value {
            Geometry::SketchGroup(sg.clone())
        } else if let MemoryItem::ExtrudeGroup(eg) = second_value {
            Geometry::ExtrudeGroup(eg.clone())
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup or ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((data, geometry))
    }

    fn get_data_and_plane<T: serde::de::DeserializeOwned>(&self) -> Result<(T, Box<Plane>), KclError> {
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

        let plane = if let MemoryItem::Plane(p) = second_value {
            p.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a Plane as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((data, plane))
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

    fn get_number_sketch_group(&self) -> Result<(f64, Box<SketchGroup>), KclError> {
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

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a SketchGroup as the second argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((number, sketch_group))
    }

    fn get_path_name_extrude_group(&self) -> Result<(String, Box<ExtrudeGroup>), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a ExtrudeGroup.
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

        let path_name = if let serde_json::Value::String(s) = first_value {
            s.to_string()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a string as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            }));
        };

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let extrude_group = if let MemoryItem::ExtrudeGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a ExtrudeGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((path_name, extrude_group))
    }
}

/// Render a model.
// This never actually gets called so this is fine.
pub async fn show<'a>(args: Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;
    inner_show(sketch_group);

    args.make_user_val_from_f64(0.0)
}

/// Render a model.
#[stdlib {
    name = "show",
}]
fn inner_show(_sketch: Box<SketchGroup>) {}

/// Returns the length of the given leg.
pub async fn leg_length(args: Args) -> Result<MemoryItem, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = inner_leg_length(hypotenuse, leg);
    args.make_user_val_from_f64(result)
}

/// Returns the length of the given leg.
#[stdlib {
    name = "legLen",
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
#[stdlib {
    name = "legAngX",
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
#[stdlib {
    name = "legAngY",
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
    use itertools::Itertools;

    use crate::std::StdLib;

    #[test]
    fn test_generate_stdlib_markdown_docs() {
        let stdlib = StdLib::new();
        let mut buf = String::new();

        buf.push_str("<!--- DO NOT EDIT THIS FILE. IT IS AUTOMATICALLY GENERATED. -->\n\n");

        buf.push_str("# KCL Standard Library\n\n");

        // Generate a table of contents.
        buf.push_str("## Table of Contents\n\n");

        buf.push_str("* [Functions](#functions)\n");

        for key in stdlib.fns.keys().sorted() {
            let internal_fn = stdlib.fns.get(key).unwrap();
            if internal_fn.unpublished() || internal_fn.deprecated() {
                continue;
            }

            buf.push_str(&format!("\t* [`{}`](#{})\n", internal_fn.name(), internal_fn.name()));
        }

        buf.push_str("\n\n");

        buf.push_str("## Functions\n\n");

        for key in stdlib.fns.keys().sorted() {
            let internal_fn = stdlib.fns.get(key).unwrap();
            if internal_fn.unpublished() {
                continue;
            }

            let mut fn_docs = String::new();

            if internal_fn.deprecated() {
                fn_docs.push_str(&format!("### {} DEPRECATED\n\n", internal_fn.name()));
            } else {
                fn_docs.push_str(&format!("### {}\n\n", internal_fn.name()));
            }

            fn_docs.push_str(&format!("{}\n\n", internal_fn.summary()));
            fn_docs.push_str(&format!("{}\n\n", internal_fn.description()));

            fn_docs.push_str("```\n");
            let signature = internal_fn.fn_signature();
            fn_docs.push_str(&signature);
            fn_docs.push_str("\n```\n\n");

            fn_docs.push_str("#### Arguments\n\n");
            for arg in internal_fn.args() {
                let (format, should_be_indented) = arg.get_type_string().unwrap();
                if let Some(description) = arg.description() {
                    fn_docs.push_str(&format!("* `{}`: `{}` - {}\n", arg.name, arg.type_, description));
                } else {
                    fn_docs.push_str(&format!("* `{}`: `{}`\n", arg.name, arg.type_));
                }

                if should_be_indented {
                    fn_docs.push_str(&format!("```\n{}\n```\n", format));
                }
            }

            if let Some(return_type) = internal_fn.return_value() {
                fn_docs.push_str("\n#### Returns\n\n");
                if let Some(description) = return_type.description() {
                    fn_docs.push_str(&format!("* `{}` - {}\n", return_type.type_, description));
                } else {
                    fn_docs.push_str(&format!("* `{}`\n", return_type.type_));
                }

                let (format, should_be_indented) = return_type.get_type_string().unwrap();
                if should_be_indented {
                    fn_docs.push_str(&format!("```\n{}\n```\n", format));
                }
            }

            fn_docs.push_str("\n\n\n");

            buf.push_str(&fn_docs);
        }

        expectorate::assert_contents("../../../docs/kcl/std.md", &buf);
    }

    #[test]
    fn test_generate_stdlib_json_schema() {
        let stdlib = StdLib::new();

        let mut json_data = vec![];

        for key in stdlib.fns.keys().sorted() {
            let internal_fn = stdlib.fns.get(key).unwrap();
            json_data.push(internal_fn.to_json().unwrap());
        }
        expectorate::assert_contents(
            "../../../docs/kcl/std.json",
            &serde_json::to_string_pretty(&json_data).unwrap(),
        );
    }
}
