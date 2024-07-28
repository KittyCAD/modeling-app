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

use super::{shapes::SketchSurfaceOrGroup, sketch::FaceTag, FnAsArg};

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

    pub(crate) fn get_tag_engine_info<'a>(
        &'a self,
        tag: &'a TagIdentifier,
    ) -> Result<&'a crate::executor::TagEngineInfo, KclError> {
        /* if let Some(info) = &tag.info {
            return Ok(info);
        }*/

        if let MemoryItem::TagIdentifier(t) = self.current_program_memory.get(&tag.value, self.source_range)? {
            Ok(t.info.as_ref().ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Tag `{}` does not have engine info", tag.value),
                    source_ranges: vec![self.source_range],
                })
            })?)
        } else {
            Err(KclError::Type(KclErrorDetails {
                message: format!("Tag `{}` does not exist", tag.value),
                source_ranges: vec![self.source_range],
            }))
        }
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

    pub(crate) fn make_null_user_val(&self) -> Result<MemoryItem, KclError> {
        self.make_user_val_from_json(serde_json::Value::Null)
    }

    pub(crate) fn make_user_val_from_i64(&self, n: i64) -> Result<MemoryItem, KclError> {
        self.make_user_val_from_json(serde_json::Value::Number(serde_json::Number::from(n)))
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
        FromArgs::from_args(self, 0)
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
        FromArgs::from_args(self, 0)
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
        FromArgs::from_args(self, 0)
    }

    pub fn get_sketch_groups(&self) -> Result<(SketchGroupSet, Box<SketchGroup>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub fn get_sketch_group(&self) -> Result<Box<SketchGroup>, KclError> {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data<'a, T>(&'a self) -> Result<T, KclError>
    where
        T: FromArgs<'a> + serde::de::DeserializeOwned,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_import_data(&self) -> Result<(String, Option<crate::std::import::ImportFormat>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub fn get_sketch_group_and_optional_tag(&self) -> Result<(Box<SketchGroup>, Option<TagDeclarator>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_optional_tag<'a, T>(&'a self) -> Result<(T, Option<FaceTag>), KclError>
    where
        T: serde::de::DeserializeOwned + FromMemoryItem<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_sketch_group<'a, T>(&'a self) -> Result<(T, Box<SketchGroup>), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_sketch_group_set<'a, T>(&'a self) -> Result<(T, SketchGroupSet), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_sketch_group_and_tag<'a, T>(
        &'a self,
    ) -> Result<(T, Box<SketchGroup>, Option<TagDeclarator>), KclError>
    where
        T: serde::de::DeserializeOwned + FromMemoryItem<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_sketch_surface<'a, T>(&'a self) -> Result<(T, SketchSurface, Option<TagDeclarator>), KclError>
    where
        T: serde::de::DeserializeOwned + FromMemoryItem<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_extrude_group_set<'a, T>(&'a self) -> Result<(T, ExtrudeGroupSet), KclError>
    where
        T: serde::de::DeserializeOwned + FromMemoryItem<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_extrude_group<'a, T>(&'a self) -> Result<(T, Box<ExtrudeGroup>), KclError>
    where
        T: serde::de::DeserializeOwned + FromMemoryItem<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_data_and_extrude_group_and_tag<'a, T>(
        &'a self,
    ) -> Result<(T, Box<ExtrudeGroup>, Option<TagDeclarator>), KclError>
    where
        T: serde::de::DeserializeOwned + FromMemoryItem<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub fn get_tag_and_extrude_group(&self) -> Result<(TagIdentifier, Box<ExtrudeGroup>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub fn get_tag_to_number_sketch_group(&self) -> Result<(TagIdentifier, f64, Box<SketchGroup>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub fn get_number_sketch_group_set(&self) -> Result<(f64, SketchGroupSet), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub async fn get_adjacent_face_to_tag(
        &self,
        tag: &TagIdentifier,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        if tag.value.is_empty() {
            return Err(KclError::Type(KclErrorDetails {
                message: "Expected a non-empty tag for the face".to_string(),
                source_ranges: vec![self.source_range],
            }));
        }

        let engine_info = self.get_tag_engine_info(tag)?;

        let surface = engine_info.surface.as_ref().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Tag `{}` does not have a surface", tag.value),
                source_ranges: vec![self.source_range],
            })
        })?;

        if let Some(face_from_surface) = match surface {
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
        } {
            return face_from_surface;
        }

        // A face could also be the result of a chamfer or fillet.
        // TODO: come back to this.
        /* if let Some(face_from_chamfer_fillet) = extrude_group.fillet_or_chamfers.iter().find_map(|fc| {
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
        }*/

        // If we still haven't found the face, return an error.
        Err(KclError::Type(KclErrorDetails {
            message: format!("Expected a face with the tag `{}`", tag.value),
            source_ranges: vec![self.source_range],
        }))
    }
}

/// Types which impl this trait can be read out of the `Args` passed into a KCL function.
pub trait FromArgs<'a>: Sized {
    /// Get this type from the args passed into a KCL function, at the given index in the argument list.
    fn from_args(args: &'a Args, index: usize) -> Result<Self, KclError>;
}

/// Types which impl this trait can be extracted from a `MemoryItem`.
pub trait FromMemoryItem<'a>: Sized {
    /// Try to convert a MemoryItem into this type.
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self>;
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
        let Some(val) = T::from_mem_item(arg) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Argument at index {i} was supposed to be type {} but wasn't",
                    type_name::<T>(),
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
        let Some(val) = T::from_mem_item(arg) else {
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
impl<'a, A, B, C, D> FromArgs<'a> for (A, B, C, D)
where
    A: FromArgs<'a>,
    B: FromArgs<'a>,
    C: FromArgs<'a>,
    D: FromArgs<'a>,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let a = A::from_args(args, i)?;
        let b = B::from_args(args, i + 1)?;
        let c = C::from_args(args, i + 2)?;
        let d = D::from_args(args, i + 3)?;
        Ok((a, b, c, d))
    }
}

impl<'a> FromMemoryItem<'a> for &'a str {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        arg.as_user_val().and_then(|uv| uv.value.as_str())
    }
}

impl<'a> FromMemoryItem<'a> for TagDeclarator {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        arg.get_tag_declarator().ok()
    }
}

impl<'a> FromMemoryItem<'a> for TagIdentifier {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        arg.get_tag_identifier().ok()
    }
}

impl<'a> FromMemoryItem<'a> for &'a SketchGroup {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        let MemoryItem::SketchGroup(s) = arg else {
            return None;
        };
        Some(s.as_ref())
    }
}

macro_rules! impl_from_arg_via_json {
    ($typ:path) => {
        impl<'a> FromMemoryItem<'a> for $typ {
            fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
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
            fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
                from_user_val(arg)
            }
        }
    };
}

fn from_user_val<T: DeserializeOwned>(arg: &MemoryItem) -> Option<T> {
    let v = match arg {
        MemoryItem::UserVal(v) => v.value.clone(),
        other => serde_json::to_value(other).ok()?,
    };
    serde_json::from_value(v).ok()
}

impl_from_arg_via_json!(super::sketch::AngledLineData);
impl_from_arg_via_json!(super::sketch::AngledLineToData);
impl_from_arg_via_json!(super::sketch::AngledLineThatIntersectsData);
impl_from_arg_via_json!(super::sketch::ArcData);
impl_from_arg_via_json!(super::sketch::TangentialArcData);
impl_from_arg_via_json!(super::sketch::BezierData);
impl_from_arg_via_json!(super::chamfer::ChamferData);
impl_from_arg_via_json!(super::patterns::LinearPattern3dData);
impl_from_arg_via_json!(super::patterns::CircularPattern3dData);
impl_from_arg_via_json!(super::patterns::LinearPattern2dData);
impl_from_arg_via_json!(super::patterns::CircularPattern2dData);
impl_from_arg_via_json!(super::helix::HelixData);
impl_from_arg_via_json!(super::shell::ShellData);
impl_from_arg_via_json!(super::fillet::FilletData);
impl_from_arg_via_json!(super::revolve::RevolveData);
impl_from_arg_via_json!(super::sketch::SketchData);
impl_from_arg_via_json!(crate::std::import::ImportFormat);
impl_from_arg_via_json!(FaceTag);
impl_from_arg_via_json!(String);
impl_from_arg_via_json!(u32);
impl_from_arg_via_json!(u64);
impl_from_arg_via_json!(f64);
impl_from_arg_via_json!(bool);

impl_from_arg_for_array!(2);
impl_from_arg_for_array!(3);

impl<'a> FromMemoryItem<'a> for &'a Box<SketchGroup> {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        let MemoryItem::SketchGroup(s) = arg else {
            return None;
        };
        Some(s)
    }
}

impl<'a> FromMemoryItem<'a> for Box<SketchGroup> {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        let MemoryItem::SketchGroup(s) = arg else {
            return None;
        };
        Some(s.to_owned())
    }
}

impl<'a> FromMemoryItem<'a> for Box<ExtrudeGroup> {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        let MemoryItem::ExtrudeGroup(s) = arg else {
            return None;
        };
        Some(s.to_owned())
    }
}

impl<'a> FromMemoryItem<'a> for FnAsArg<'a> {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        arg.get_function()
    }
}

impl<'a> FromMemoryItem<'a> for ExtrudeGroupSet {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        arg.get_extrude_group_set().ok()
    }
}
impl<'a> FromMemoryItem<'a> for SketchGroupSet {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        arg.get_sketch_group_set().ok()
    }
}
impl<'a> FromMemoryItem<'a> for SketchSurfaceOrGroup {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        match arg {
            MemoryItem::SketchGroup(sg) => Some(Self::SketchGroup(sg.clone())),
            MemoryItem::Plane(sg) => Some(Self::SketchSurface(SketchSurface::Plane(sg.clone()))),
            MemoryItem::Face(sg) => Some(Self::SketchSurface(SketchSurface::Face(sg.clone()))),
            _ => None,
        }
    }
}
impl<'a> FromMemoryItem<'a> for SketchSurface {
    fn from_mem_item(arg: &'a MemoryItem) -> Option<Self> {
        match arg {
            MemoryItem::Plane(sg) => Some(Self::Plane(sg.clone())),
            MemoryItem::Face(sg) => Some(Self::Face(sg.clone())),
            _ => None,
        }
    }
}
