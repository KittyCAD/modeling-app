use std::any::type_name;

use crate::{
    ast::types::{parse_json_number_as_f64, TagDeclarator},
    errors::{KclError, KclErrorDetails},
    executor::{
        ExecutorContext, ExtrudeGroup, ExtrudeGroupSet, ExtrudeSurface, MemoryItem, Metadata, ProgramMemory,
        SketchGroup, SketchGroupSet, SketchSurface, SourceRange, TagIdentifier,
    },
};
use kittycad::types::OkWebSocketResponseData;
use serde::de::DeserializeOwned;

use super::{sketch::FaceTag, FnAsArg};

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

    pub fn make_user_val_from_f64(&self, f: f64) -> Result<MemoryItem, KclError> {
        self.make_user_val_from_json(serde_json::Value::Number(serde_json::Number::from_f64(f).ok_or_else(
            || {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to convert `{}` to a number", f),
                    source_ranges: vec![self.source_range],
                })
            },
        )?))
    }

    pub fn get_number(&self) -> Result<f64, KclError> {
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

    pub fn get_number_array(&self) -> Result<Vec<f64>, KclError> {
        let mut numbers: Vec<f64> = Vec::new();
        for arg in &self.args {
            let parsed = arg.get_json_value()?;
            numbers.push(parse_json_number_as_f64(&parsed, self.source_range)?);
        }
        Ok(numbers)
    }

    pub fn get_pattern_transform_args(&self) -> Result<(u32, FnAsArg<'_>, ExtrudeGroupSet), KclError> {
        let sr = vec![self.source_range];
        let mut args = self.args.iter();
        let num_repetitions = args.next().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: "Missing first argument (should be the number of repetitions)".to_owned(),
                source_ranges: sr.clone(),
            })
        })?;
        let num_repetitions = num_repetitions.get_u32(sr.clone())?;
        let transform = args.next().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: "Missing second argument (should be the transform function)".to_owned(),
                source_ranges: sr.clone(),
            })
        })?;
        let func = transform.get_function(sr.clone())?;
        let eg = args.next().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: "Missing third argument (should be a Sketch/ExtrudeGroup or an array of Sketch/ExtrudeGroups)"
                    .to_owned(),
                source_ranges: sr.clone(),
            })
        })?;
        let eg = eg.get_extrude_group_set().map_err(|_e| {
            KclError::Type(KclErrorDetails {
                message: "Third argument was not an ExtrudeGroup".to_owned(),
                source_ranges: sr.clone(),
            })
        })?;
        Ok((num_repetitions, func, eg))
    }

    pub fn get_hypotenuse_leg(&self) -> Result<(f64, f64), KclError> {
        let numbers = self.get_number_array()?;

        if numbers.len() != 2 {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a number array of length 2, found `{:?}`", numbers),
                source_ranges: vec![self.source_range],
            }));
        }

        Ok((numbers[0], numbers[1]))
    }

    pub fn get_circle_args(
        &self,
    ) -> Result<
        (
            [f64; 2],
            f64,
            crate::std::shapes::SketchSurfaceOrGroup,
            Option<TagDeclarator>,
        ),
        KclError,
    > {
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

        let tag = if let Some(tag) = self.args.get(3) {
            tag.get_tag_declarator_opt()?
        } else {
            None
        };

        Ok((center, radius, sketch_group_or_surface, tag))
    }

    pub fn get_segment_name_sketch_group(&self) -> Result<(TagIdentifier, Box<SketchGroup>), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a SketchGroup.
        let first_value = self.args.first().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a string as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let segment_name = first_value.get_tag_identifier()?;

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

    pub fn get_sketch_groups(&self) -> Result<(SketchGroupSet, Box<SketchGroup>), KclError> {
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

    pub fn get_sketch_group(&self) -> Result<Box<SketchGroup>, KclError> {
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

    pub fn get_data<T: serde::de::DeserializeOwned>(&self) -> Result<T, KclError> {
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

    pub fn get_import_data(&self) -> Result<(String, Option<crate::std::import::ImportFormat>), KclError> {
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

    pub fn get_sketch_group_and_optional_tag(&self) -> Result<(Box<SketchGroup>, Option<TagDeclarator>), KclError> {
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

        let tag = if let Some(tag) = self.args.get(1) {
            tag.get_tag_declarator_opt()?
        } else {
            None
        };

        Ok((sketch_group, tag))
    }

    pub fn get_data_and_optional_tag<T: serde::de::DeserializeOwned>(&self) -> Result<(T, Option<FaceTag>), KclError> {
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

    pub fn get_data_and_sketch_group<T: serde::de::DeserializeOwned>(&self) -> Result<(T, Box<SketchGroup>), KclError> {
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

    pub fn get_data_and_sketch_group_set<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, SketchGroupSet), KclError> {
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

    pub fn get_data_and_sketch_group_and_tag<'a, T>(
        &'a self,
    ) -> Result<(T, Box<SketchGroup>, Option<TagDeclarator>), KclError>
    where
        T: serde::de::DeserializeOwned + FromMemoryItem<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_sketch_surface<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, SketchSurface, Option<TagDeclarator>), KclError> {
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
            tag.get_tag_declarator_opt()?
        } else {
            None
        };

        Ok((data, sketch_surface, tag))
    }

    pub fn get_data_and_extrude_group_set<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, ExtrudeGroupSet), KclError> {
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

    pub fn get_data_and_extrude_group<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, Box<ExtrudeGroup>), KclError> {
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

    pub fn get_data_and_extrude_group_and_tag<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<(T, Box<ExtrudeGroup>, Option<TagDeclarator>), KclError> {
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
            tag.get_tag_declarator_opt()?
        } else {
            None
        };

        Ok((data, extrude_group, tag))
    }

    pub fn get_tag_and_extrude_group(&self) -> Result<(TagIdentifier, Box<ExtrudeGroup>), KclError> {
        let first_value = self.args.first().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a struct as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let tag = first_value.get_tag_identifier()?;

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

        Ok((tag, extrude_group))
    }

    pub fn get_segment_name_to_number_sketch_group(&self) -> Result<(TagIdentifier, f64, Box<SketchGroup>), KclError> {
        // Iterate over our args, the first argument should be a UserVal with a string value.
        // The second argument should be a number.
        // The third argument should be a SketchGroup.
        let first_value = self.args.first().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a string as the first argument, found `{:?}`", self.args),
                source_ranges: vec![self.source_range],
            })
        })?;

        let segment_name = first_value.get_tag_identifier()?;

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

    pub fn get_number_sketch_group_set(&self) -> Result<(f64, SketchGroupSet), KclError> {
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
        tag: &TagIdentifier,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        if tag.value.is_empty() {
            return Err(KclError::Type(KclErrorDetails {
                message: "Expected a non-empty tag for the face".to_string(),
                source_ranges: vec![self.source_range],
            }));
        }

        if let Some(face_from_surface) = extrude_group
            .value
            .iter()
            .find_map(|extrude_surface| match extrude_surface {
                ExtrudeSurface::ExtrudePlane(extrude_plane) => {
                    if let Some(plane_tag) = &extrude_plane.tag {
                        if plane_tag.name == tag.value {
                            Some(Ok(extrude_plane.face_id))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                // The must be planar check must be called before the arc check.
                ExtrudeSurface::ExtrudeArc(_) if must_be_planar => Some(Err(KclError::Type(KclErrorDetails {
                    message: format!("Tag `{}` is a non-planar surface", tag.value),
                    source_ranges: vec![self.source_range],
                }))),
                ExtrudeSurface::ExtrudeArc(extrude_arc) => {
                    if let Some(arc_tag) = &extrude_arc.tag {
                        if arc_tag.name == tag.value {
                            Some(Ok(extrude_arc.face_id))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
            })
        {
            return face_from_surface;
        }

        // A face could also be the result of a chamfer or fillet.
        if let Some(face_from_chamfer_fillet) = extrude_group.fillet_or_chamfers.iter().find_map(|fc| {
            if let Some(ntag) = &fc.tag() {
                if ntag.name == tag.value {
                    Some(Ok(fc.id()))
                } else {
                    None
                }
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
            message: format!("Expected a face with the tag `{}`", tag.value),
            source_ranges: vec![self.source_range],
        }))
    }
}

trait FromArgs<'a>: Sized {
    fn from_args(args: &'a Args, index: usize) -> Result<Self, KclError>;
}

pub trait FromMemoryItem<'a>: Sized {
    fn from_arg(arg: &'a MemoryItem) -> Option<Self>;
}

impl<'a, T> FromArgs<'a> for T
where
    T: FromMemoryItem<'a> + Sized,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected an argument at index {i}"),
                source_ranges: vec![args.source_range],
            }));
        };
        let Some(val) = T::from_arg(arg) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Argument at index {i} was supposed to be type {} but wasn't",
                    type_name::<T>()
                ),
                source_ranges: vec![args.source_range],
            }));
        };
        Ok(val)
    }
}

impl<'a, T> FromArgs<'a> for Option<T>
where
    T: FromMemoryItem<'a> + Sized,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else { return Ok(None) };
        let Some(val) = T::from_arg(arg) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Argument at index {i} was supposed to be type {} but wasn't",
                    type_name::<T>()
                ),
                source_ranges: vec![args.source_range],
            }));
        };
        Ok(Some(val))
    }
}

impl<'a, A, B> FromArgs<'a> for (A, B)
where
    A: FromArgs<'a>,
    B: FromArgs<'a>,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let a = A::from_args(args, i)?;
        let b = B::from_args(args, i + 1)?;
        Ok((a, b))
    }
}

impl<'a, A, B, C> FromArgs<'a> for (A, B, C)
where
    A: FromArgs<'a>,
    B: FromArgs<'a>,
    C: FromArgs<'a>,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let a = A::from_args(args, i)?;
        let b = B::from_args(args, i + 1)?;
        let c = C::from_args(args, i + 2)?;
        Ok((a, b, c))
    }
}

impl<'a> FromMemoryItem<'a> for &'a str {
    fn from_arg(arg: &'a MemoryItem) -> Option<Self> {
        arg.as_user_val().and_then(|uv| uv.value.as_str())
    }
}

impl<'a> FromMemoryItem<'a> for TagDeclarator {
    fn from_arg(arg: &'a MemoryItem) -> Option<Self> {
        arg.get_tag_declarator().ok()
    }
}

impl<'a> FromMemoryItem<'a> for &'a SketchGroup {
    fn from_arg(arg: &'a MemoryItem) -> Option<Self> {
        let MemoryItem::SketchGroup(s) = arg else {
            return None;
        };
        Some(s.as_ref())
    }
}

macro_rules! impl_from_arg_via_json {
    ($typ:path) => {
        impl<'a> FromMemoryItem<'a> for $typ {
            fn from_arg(arg: &'a MemoryItem) -> Option<Self> {
                from_user_val(arg)
            }
        }
    };
}

macro_rules! impl_from_arg_for_array {
    ($n:literal) => {
        impl<'a, T> FromMemoryItem<'a> for [T; $n]
        where
            T: serde::de::DeserializeOwned + FromMemoryItem<'a>,
        {
            fn from_arg(arg: &'a MemoryItem) -> Option<Self> {
                from_user_val(arg)
            }
        }
    };
}

fn from_user_val<T: DeserializeOwned>(arg: &MemoryItem) -> Option<T> {
    let MemoryItem::UserVal(v) = arg else {
        return None;
    };
    let v = v.value.to_owned();
    serde_json::from_value(v).ok()
}

impl_from_arg_via_json!(super::sketch::AngledLineData);
impl_from_arg_via_json!(super::sketch::AngledLineToData);
impl_from_arg_via_json!(super::sketch::AngledLineThatIntersectsData);
impl_from_arg_via_json!(super::sketch::ArcData);
impl_from_arg_via_json!(super::sketch::TangentialArcData);
impl_from_arg_via_json!(super::sketch::BezierData);
impl_from_arg_via_json!(String);
impl_from_arg_via_json!(u32);
impl_from_arg_via_json!(u64);
impl_from_arg_via_json!(f64);
impl_from_arg_via_json!(bool);

impl_from_arg_for_array!(2);
impl_from_arg_for_array!(3);

impl<'a> FromMemoryItem<'a> for &'a Box<SketchGroup> {
    fn from_arg(arg: &'a MemoryItem) -> Option<Self> {
        let MemoryItem::SketchGroup(s) = arg else {
            return None;
        };
        Some(s)
    }
}

impl<'a> FromMemoryItem<'a> for Box<SketchGroup> {
    fn from_arg(arg: &'a MemoryItem) -> Option<Self> {
        let MemoryItem::SketchGroup(s) = arg else {
            return None;
        };
        Some(s.to_owned())
    }
}
