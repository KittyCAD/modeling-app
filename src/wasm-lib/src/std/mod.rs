//! Functions implemented for language execution.

mod extrude;
mod segment;
mod sketch;
mod utils;

// TODO: Something that would be nice is if we could generate docs for Kcl based on the
// actual stdlib functions below.

use std::collections::HashMap;

use crate::{
    abstract_syntax_tree_types::parse_json_number_as_f64,
    engine::EngineConnection,
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, MemoryItem, Metadata, SketchGroup, SourceRange},
    std::extrude::{extrude, get_extrude_wall_transform},
    std::segment::{
        angle_to_match_length_x, angle_to_match_length_y, last_segment_x, last_segment_y,
        segment_angle, segment_end_x, segment_end_y, segment_length,
    },
    std::sketch::{
        angled_line, angled_line_of_x_length, angled_line_of_y_length, angled_line_that_intersects,
        angled_line_to_x, angled_line_to_y, close, line, line_to, start_sketch_at, x_line,
        x_line_to, y_line, y_line_to,
    },
};

use anyhow::Result;
use lazy_static::lazy_static;

pub type FnMap = HashMap<String, StdFn>;
pub type StdFn = fn(&mut Args) -> Result<MemoryItem, KclError>;

lazy_static! {
   pub static ref INTERNAL_FNS: FnMap =
        {
            HashMap::from([
                // Extrude functions.
                ("extrude".to_string(), extrude as StdFn),
                ("getExtrudeWallTransform".to_string(), get_extrude_wall_transform as StdFn),

                ("min".to_string(), min as StdFn),
                ("legLen".to_string(), leg_length as StdFn),
                ("legAngX".to_string(),leg_angle_x as StdFn),
                ("legAngY".to_string(), leg_angle_y as StdFn),
                // Sketch segment functions.
                ("segEndX".to_string(), segment_end_x as StdFn),
                ("segEndY".to_string(), segment_end_y as StdFn),
                ("lastSegX".to_string(), last_segment_x as StdFn),
                ("lastSegY".to_string(), last_segment_y as StdFn),
                ("segLen".to_string(), segment_length as StdFn),
                ("segAng".to_string(), segment_angle as StdFn),
                ("angleToMatchLengthX".to_string(), angle_to_match_length_x as StdFn),
                ("angleToMatchLengthY".to_string(), angle_to_match_length_y as StdFn),

                // Sketch functions.
                ("lineTo".to_string(), line_to as StdFn),
                ("xLineTo".to_string(), x_line_to as StdFn),
                ("yLineTo".to_string(), y_line_to as StdFn),
                ("line".to_string(), line as StdFn),
                ("xLine".to_string(), x_line as StdFn),
                ("yLine".to_string(), y_line as StdFn),
                ("angledLine".to_string(), angled_line as StdFn),
                ("angledLineOfXLength".to_string(), angled_line_of_x_length as StdFn),
                ("angledLineToX".to_string(), angled_line_to_x as StdFn),
                ("angledLineOfYLength".to_string(), angled_line_of_y_length as StdFn),
                ("angledLineToY".to_string(), angled_line_to_y as StdFn),
                ("angledLineThatIntersects".to_string(), angled_line_that_intersects as StdFn),
                ("startSketchAt".to_string(), start_sketch_at as StdFn),
                ("close".to_string(), close as StdFn),
            ])

        };
}

#[derive(Debug)]
pub struct Args<'a> {
    pub args: Vec<MemoryItem>,
    pub source_range: SourceRange,
    engine: &'a mut EngineConnection,
}

impl<'a> Args<'a> {
    pub fn new(
        args: Vec<MemoryItem>,
        source_range: SourceRange,
        engine: &'a mut EngineConnection,
    ) -> Self {
        Self {
            args,
            source_range,
            engine,
        }
    }
    pub fn send_modeling_cmd(
        &mut self,
        id: uuid::Uuid,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        self.engine.send_modeling_cmd(id, self.source_range, cmd)
    }

    fn make_user_val_from_json(&self, j: serde_json::Value) -> Result<MemoryItem, KclError> {
        Ok(MemoryItem::UserVal {
            value: j,
            meta: vec![Metadata {
                source_range: self.source_range,
            }],
        })
    }

    fn make_user_val_from_f64(&self, f: f64) -> Result<MemoryItem, KclError> {
        self.make_user_val_from_json(serde_json::Value::Number(
            serde_json::Number::from_f64(f).ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to convert `{}` to a number", f),
                    source_ranges: vec![self.source_range],
                })
            })?,
        ))
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

    fn get_segment_name_sketch_group(&self) -> Result<(String, SketchGroup), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a SketchGroup.
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!(
                        "Expected a string as the first argument, found `{:?}`",
                        self.args
                    ),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let segment_name = if let serde_json::Value::String(s) = first_value {
            s.to_string()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a string as the first argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((segment_name, sketch_group))
    }

    fn get_sketch_group(&self) -> Result<SketchGroup, KclError> {
        let first_value = self.args.first().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the first argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = first_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the first argument, found `{:?}`",
                    self.args
                ),
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
                    message: format!(
                        "Expected a struct as the first argument, found `{:?}`",
                        self.args
                    ),
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

    fn get_data_and_sketch_group<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, SketchGroup), KclError> {
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!(
                        "Expected a struct as the first argument, found `{:?}`",
                        self.args
                    ),
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
                    "Expected a SketchGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((data, sketch_group))
    }

    fn get_segment_name_to_number_sketch_group(
        &self,
    ) -> Result<(String, f64, SketchGroup), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a number.
        // The third argument should be a SketchGroup.
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!(
                        "Expected a string as the first argument, found `{:?}`",
                        self.args
                    ),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let segment_name = if let serde_json::Value::String(s) = first_value {
            s.to_string()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a string as the first argument, found `{:?}`",
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
                    message: format!(
                        "Expected a number as the second argument, found `{:?}`",
                        self.args
                    ),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let to_number = parse_json_number_as_f64(&second_value, self.source_range)?;

        let third_value = self.args.get(2).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the third argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = third_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the third argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((segment_name, to_number, sketch_group))
    }

    fn get_number_sketch_group(&self) -> Result<(f64, SketchGroup), KclError> {
        // Iterate over our args, the first argument should be a number.
        // The second argument should be a SketchGroup.
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!(
                        "Expected a number as the first argument, found `{:?}`",
                        self.args
                    ),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let number = parse_json_number_as_f64(&first_value, self.source_range)?;

        let second_value = self.args.get(1).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            })
        })?;

        let sketch_group = if let MemoryItem::SketchGroup(sg) = second_value {
            sg.clone()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup as the second argument, found `{:?}`",
                    self.args
                ),
                source_ranges: vec![self.source_range],
            }));
        };

        Ok((number, sketch_group))
    }

    fn get_path_name_extrude_group(&self) -> Result<(String, ExtrudeGroup), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a ExtrudeGroup.
        let first_value = self
            .args
            .first()
            .ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!(
                        "Expected a string as the first argument, found `{:?}`",
                        self.args
                    ),
                    source_ranges: vec![self.source_range],
                })
            })?
            .get_json_value()?;

        let path_name = if let serde_json::Value::String(s) = first_value {
            s.to_string()
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a string as the first argument, found `{:?}`",
                    self.args
                ),
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

/// Returns the minimum of the given arguments.
pub fn min(args: &mut Args) -> Result<MemoryItem, KclError> {
    let mut min = std::f64::MAX;
    for arg in args.get_number_array()? {
        if arg < min {
            min = arg;
        }
    }

    args.make_user_val_from_f64(min)
}

/// Returns the length of the given leg.
pub fn leg_length(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = (hypotenuse.powi(2) - f64::min(hypotenuse.abs(), leg.abs()).powi(2)).sqrt();
    args.make_user_val_from_f64(result)
}

/// Returns the angle of the given leg for x.
pub fn leg_angle_x(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = (leg.min(hypotenuse) / hypotenuse).acos() * 180.0 / std::f64::consts::PI;
    args.make_user_val_from_f64(result)
}

/// Returns the angle of the given leg for y.
pub fn leg_angle_y(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = (leg.min(hypotenuse) / hypotenuse).asin() * 180.0 / std::f64::consts::PI;
    args.make_user_val_from_f64(result)
}
