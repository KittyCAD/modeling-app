use std::{any::type_name, collections::HashMap, num::NonZeroU32};

use anyhow::Result;
use kcmc::{websocket::OkWebSocketResponseData, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::shapes::PolygonType;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        kcl_value::{FunctionSource, NumericType},
        ExecState, ExecutorContext, ExtrudeSurface, Helix, KclObjectFields, KclValue, Metadata, Sketch, SketchSet,
        SketchSurface, Solid, SolidSet, TagIdentifier,
    },
    parsing::ast::types::TagNode,
    source_range::SourceRange,
    std::{shapes::SketchOrSurface, sketch::FaceTag, sweep::SweepPath},
    ModuleId,
};

#[derive(Debug, Clone)]
pub struct Arg {
    /// The evaluated argument.
    pub value: KclValue,
    /// The source range of the unevaluated argument.
    pub source_range: SourceRange,
}

impl Arg {
    pub fn new(value: KclValue, source_range: SourceRange) -> Self {
        Self { value, source_range }
    }

    pub fn synthetic(value: KclValue) -> Self {
        Self {
            value,
            source_range: SourceRange::synthetic(),
        }
    }

    pub fn source_ranges(&self) -> Vec<SourceRange> {
        vec![self.source_range]
    }
}

#[derive(Debug, Clone, Default)]
pub struct KwArgs {
    /// Unlabeled keyword args. Currently only the first arg can be unlabeled.
    pub unlabeled: Option<Arg>,
    /// Labeled args.
    pub labeled: HashMap<String, Arg>,
}

impl KwArgs {
    /// How many arguments are there?
    pub fn len(&self) -> usize {
        self.labeled.len() + if self.unlabeled.is_some() { 1 } else { 0 }
    }
    /// Are there no arguments?
    pub fn is_empty(&self) -> bool {
        self.labeled.len() == 0 && self.unlabeled.is_none()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TyF64 {
    pub n: f64,
    pub ty: NumericType,
}

impl TyF64 {
    pub fn new(n: f64, ty: NumericType) -> Self {
        Self { n, ty }
    }

    pub fn count(n: f64) -> Self {
        Self {
            n,
            ty: NumericType::count(),
        }
    }

    pub fn map(mut self, n: f64) -> Self {
        self.n = n;
        self
    }
}

#[derive(Debug, Clone)]
pub struct Args {
    /// Positional args.
    pub args: Vec<Arg>,
    /// Keyword arguments
    pub kw_args: KwArgs,
    pub source_range: SourceRange,
    pub ctx: ExecutorContext,
    /// If this call happens inside a pipe (|>) expression, this holds the LHS of that |>.
    /// Otherwise it's None.
    pipe_value: Option<Arg>,
}

impl Args {
    pub fn new(args: Vec<Arg>, source_range: SourceRange, ctx: ExecutorContext, pipe_value: Option<Arg>) -> Self {
        Self {
            args,
            kw_args: Default::default(),
            source_range,
            ctx,
            pipe_value,
        }
    }

    /// Collect the given keyword arguments.
    pub fn new_kw(kw_args: KwArgs, source_range: SourceRange, ctx: ExecutorContext, pipe_value: Option<Arg>) -> Self {
        Self {
            args: Default::default(),
            kw_args,
            source_range,
            ctx,
            pipe_value,
        }
    }

    /// Get a keyword argument. If not set, returns None.
    pub(crate) fn get_kw_arg_opt<'a, T>(&'a self, label: &str) -> Result<Option<T>, KclError>
    where
        T: FromKclValue<'a>,
    {
        let Some(arg) = self.kw_args.labeled.get(label) else {
            return Ok(None);
        };

        T::from_kcl_val(&arg.value).map(Some).ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                source_ranges: vec![self.source_range],
                message: format!(
                    "The optional arg {label} was given, but it was the wrong type. It should be type {} but it was {}",
                    type_name::<T>(),
                    arg.value.human_friendly_type(),
                ),
            })
        })
    }

    /// Get a keyword argument. If not set, returns Err.
    pub(crate) fn get_kw_arg<'a, T>(&'a self, label: &str) -> Result<T, KclError>
    where
        T: FromKclValue<'a>,
    {
        self.get_kw_arg_opt(label)?.ok_or_else(|| {
            KclError::Semantic(KclErrorDetails {
                source_ranges: vec![self.source_range],
                message: format!("This function requires a keyword argument '{label}'"),
            })
        })
    }

    /// Get the unlabeled keyword argument. If not set, returns None.
    pub(crate) fn unlabeled_kw_arg_unconverted(&self) -> Option<&Arg> {
        self.kw_args
            .unlabeled
            .as_ref()
            .or(self.args.first())
            .or(self.pipe_value.as_ref())
    }

    /// Get the unlabeled keyword argument. If not set, returns Err.  If it
    /// can't be converted to the given type, returns Err.
    pub(crate) fn get_unlabeled_kw_arg<'a, T>(&'a self, label: &str) -> Result<T, KclError>
    where
        T: FromKclValue<'a>,
    {
        let arg = self
            .unlabeled_kw_arg_unconverted()
            .ok_or(KclError::Semantic(KclErrorDetails {
                source_ranges: vec![self.source_range],
                message: format!("This function requires a value for the special unlabeled first parameter, '{label}'"),
            }))?;

        T::from_kcl_val(&arg.value).ok_or_else(|| {
            KclError::Semantic(KclErrorDetails {
                source_ranges: arg.source_ranges(),
                message: format!(
                    "Expected a {} but found {}",
                    type_name::<T>(),
                    arg.value.human_friendly_type()
                ),
            })
        })
    }

    // Add a modeling command to the batch but don't fire it right away.
    pub(crate) async fn batch_modeling_cmd(
        &self,
        id: uuid::Uuid,
        cmd: ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        self.ctx.engine.batch_modeling_cmd(id, self.source_range, &cmd).await
    }

    // Add a modeling command to the batch that gets executed at the end of the file.
    // This is good for something like fillet or chamfer where the engine would
    // eat the path id if we executed it right away.
    pub(crate) async fn batch_end_cmd(&self, id: uuid::Uuid, cmd: ModelingCmd) -> Result<(), crate::errors::KclError> {
        self.ctx.engine.batch_end_cmd(id, self.source_range, &cmd).await
    }

    /// Send the modeling cmd and wait for the response.
    pub(crate) async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        cmd: ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        self.ctx.engine.send_modeling_cmd(id, self.source_range, &cmd).await
    }

    fn get_tag_info_from_memory<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'e crate::execution::TagEngineInfo, KclError> {
        if let KclValue::TagIdentifier(t) = exec_state.stack().get_from_call_stack(&tag.value, self.source_range)? {
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

    pub(crate) fn get_tag_engine_info<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'a crate::execution::TagEngineInfo, KclError>
    where
        'e: 'a,
    {
        if let Some(info) = &tag.info {
            return Ok(info);
        }

        self.get_tag_info_from_memory(exec_state, tag)
    }

    fn get_tag_engine_info_check_surface<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'a crate::execution::TagEngineInfo, KclError>
    where
        'e: 'a,
    {
        if let Some(info) = &tag.info {
            if info.surface.is_some() {
                return Ok(info);
            }
        }

        self.get_tag_info_from_memory(exec_state, tag)
    }

    /// Flush just the fillets and chamfers for this specific SolidSet.
    #[allow(clippy::vec_box)]
    pub(crate) async fn flush_batch_for_solid_set(
        &self,
        exec_state: &mut ExecState,
        solids: Vec<Box<Solid>>,
    ) -> Result<(), KclError> {
        // Make sure we don't traverse sketches more than once.
        let mut traversed_sketches = Vec::new();

        // Collect all the fillet/chamfer ids for the solids.
        let mut ids = Vec::new();
        for solid in solids {
            // We need to traverse the solids that share the same sketch.
            let sketch_id = solid.sketch.id;
            if !traversed_sketches.contains(&sketch_id) {
                // Find all the solids on the same shared sketch.
                ids.extend(
                    exec_state
                        .stack()
                        .walk_call_stack()
                        .filter(|v| matches!(v, KclValue::Solid { value } if value.sketch.id == sketch_id))
                        .flat_map(|v| match v {
                            KclValue::Solid { value } => value.get_all_edge_cut_ids(),
                            _ => unreachable!(),
                        }),
                );
                traversed_sketches.push(sketch_id);
            }

            ids.extend(solid.get_all_edge_cut_ids());
        }

        // We can return early if there are no fillets or chamfers.
        if ids.is_empty() {
            return Ok(());
        }

        // We want to move these fillets and chamfers from batch_end to batch so they get executed
        // before what ever we call next.
        for id in ids {
            // Pop it off the batch_end and add it to the batch.
            let Some(item) = self.ctx.engine.batch_end().write().await.shift_remove(&id) else {
                // It might be in the batch already.
                continue;
            };
            // Add it to the batch.
            self.ctx.engine.batch().write().await.push(item);
        }

        // Run flush.
        // Yes, we do need to actually flush the batch here, or references will fail later.
        self.ctx.engine.flush_batch(false, SourceRange::default()).await?;

        Ok(())
    }

    pub(crate) fn make_user_val_from_point(&self, p: [f64; 2]) -> Result<KclValue, KclError> {
        let meta = Metadata {
            source_range: self.source_range,
        };
        let x = KclValue::Number {
            value: p[0],
            meta: vec![meta],
            ty: NumericType::Unknown,
        };
        let y = KclValue::Number {
            value: p[1],
            meta: vec![meta],
            ty: NumericType::Unknown,
        };
        Ok(KclValue::MixedArray {
            value: vec![x, y],
            meta: vec![meta],
        })
    }

    pub(crate) fn make_user_val_from_f64(&self, f: f64) -> KclValue {
        KclValue::from_number(
            f,
            vec![Metadata {
                source_range: self.source_range,
            }],
        )
    }

    pub(crate) fn make_user_val_from_f64_with_type(&self, f: TyF64) -> KclValue {
        KclValue::from_number_with_type(
            f.n,
            f.ty,
            vec![Metadata {
                source_range: self.source_range,
            }],
        )
    }

    pub(crate) fn make_user_val_from_f64_array(&self, f: Vec<f64>, ty: &NumericType) -> Result<KclValue, KclError> {
        let array = f
            .into_iter()
            .map(|n| KclValue::Number {
                value: n,
                meta: vec![Metadata {
                    source_range: self.source_range,
                }],
                ty: ty.clone(),
            })
            .collect::<Vec<_>>();
        Ok(KclValue::MixedArray {
            value: array,
            meta: vec![Metadata {
                source_range: self.source_range,
            }],
        })
    }

    pub(crate) fn get_number(&self) -> Result<f64, KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_number_with_type(&self) -> Result<TyF64, KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_number_array(&self) -> Result<Vec<f64>, KclError> {
        let numbers = self
            .args
            .iter()
            .map(|arg| {
                let Some(num) = f64::from_kcl_val(&arg.value) else {
                    return Err(KclError::Semantic(KclErrorDetails {
                        source_ranges: arg.source_ranges(),
                        message: format!("Expected a number but found {}", arg.value.human_friendly_type()),
                    }));
                };
                Ok(num)
            })
            .collect::<Result<_, _>>()?;
        Ok(numbers)
    }

    pub(crate) fn get_number_array_with_types(&self) -> Result<Vec<TyF64>, KclError> {
        let numbers = self
            .args
            .iter()
            .map(|arg| {
                let Some(num) = <TyF64>::from_kcl_val(&arg.value) else {
                    return Err(KclError::Semantic(KclErrorDetails {
                        source_ranges: arg.source_ranges(),
                        message: format!("Expected a number but found {}", arg.value.human_friendly_type()),
                    }));
                };
                Ok(num)
            })
            .collect::<Result<_, _>>()?;
        Ok(numbers)
    }

    pub(crate) fn get_hypotenuse_leg(&self) -> Result<(f64, f64, NumericType), KclError> {
        let numbers = self.get_number_array_with_types()?;

        if numbers.len() != 2 {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a number array of length 2, found `{:?}`", numbers),
                source_ranges: vec![self.source_range],
            }));
        }

        let mut numbers = numbers.into_iter();
        let a = numbers.next().unwrap();
        let b = numbers.next().unwrap();
        let ty = a.ty.combine_eq(&b.ty);
        Ok((a.n, b.n, ty))
    }

    pub(crate) fn get_sketches(&self) -> Result<(SketchSet, Sketch), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketch(&self) -> Result<Sketch, KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data<'a, T>(&'a self) -> Result<T, KclError>
    where
        T: FromArgs<'a> + serde::de::DeserializeOwned,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_import_data(&self) -> Result<(String, Option<crate::std::import::ImportFormat>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_optional_tag<'a, T>(&'a self) -> Result<(T, Option<FaceTag>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch<'a, T>(&'a self) -> Result<(T, Sketch), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_set<'a, T>(&'a self) -> Result<(T, SketchSet), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_and_tag<'a, T>(&'a self) -> Result<(T, Sketch, Option<TagNode>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_surface<'a, T>(&'a self) -> Result<(T, SketchSurface, Option<TagNode>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_solid<'a, T>(&'a self) -> Result<(T, Box<Solid>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_tag_to_number_sketch(&self) -> Result<(TagIdentifier, f64, Sketch), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) async fn get_adjacent_face_to_tag(
        &self,
        exec_state: &mut ExecState,
        tag: &TagIdentifier,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        if tag.value.is_empty() {
            return Err(KclError::Type(KclErrorDetails {
                message: "Expected a non-empty tag for the face".to_string(),
                source_ranges: vec![self.source_range],
            }));
        }

        let engine_info = self.get_tag_engine_info_check_surface(exec_state, tag)?;

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
            ExtrudeSurface::Chamfer(chamfer) => {
                if let Some(chamfer_tag) = &chamfer.tag {
                    if chamfer_tag.name == tag.value {
                        Some(Ok(chamfer.face_id))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            // The must be planar check must be called before the fillet check.
            ExtrudeSurface::Fillet(_) if must_be_planar => Some(Err(KclError::Type(KclErrorDetails {
                message: format!("Tag `{}` is a non-planar surface", tag.value),
                source_ranges: vec![self.source_range],
            }))),
            ExtrudeSurface::Fillet(fillet) => {
                if let Some(fillet_tag) = &fillet.tag {
                    if fillet_tag.name == tag.value {
                        Some(Ok(fillet.face_id))
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

        // If we still haven't found the face, return an error.
        Err(KclError::Type(KclErrorDetails {
            message: format!("Expected a face with the tag `{}`", tag.value),
            source_ranges: vec![self.source_range],
        }))
    }

    pub(crate) fn get_polygon_args(
        &self,
    ) -> Result<
        (
            crate::std::shapes::PolygonData,
            crate::std::shapes::SketchOrSurface,
            Option<TagNode>,
        ),
        KclError,
    > {
        FromArgs::from_args(self, 0)
    }
}

/// Types which impl this trait can be read out of the `Args` passed into a KCL function.
pub trait FromArgs<'a>: Sized {
    /// Get this type from the args passed into a KCL function, at the given index in the argument list.
    fn from_args(args: &'a Args, index: usize) -> Result<Self, KclError>;
}

/// Types which impl this trait can be extracted from a `KclValue`.
pub trait FromKclValue<'a>: Sized {
    /// Try to convert a KclValue into this type.
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self>;
}

impl<'a> FromArgs<'a> for Vec<KclValue> {
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected an argument at index {i}"),
                source_ranges: vec![args.source_range],
            }));
        };
        let KclValue::MixedArray { value: array, meta: _ } = &arg.value else {
            let message = format!("Expected an array but found {}", arg.value.human_friendly_type());
            return Err(KclError::Type(KclErrorDetails {
                source_ranges: arg.source_ranges(),
                message,
            }));
        };
        Ok(array.to_owned())
    }
}

impl<'a, T> FromArgs<'a> for T
where
    T: FromKclValue<'a> + Sized,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected an argument at index {i}"),
                source_ranges: vec![args.source_range],
            }));
        };
        let Some(val) = T::from_kcl_val(&arg.value) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Argument at index {i} was supposed to be type {} but found {}",
                    type_name::<T>(),
                    arg.value.human_friendly_type(),
                ),
                source_ranges: arg.source_ranges(),
            }));
        };
        Ok(val)
    }
}

impl<'a, T> FromArgs<'a> for Option<T>
where
    T: FromKclValue<'a> + Sized,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else { return Ok(None) };
        if crate::parsing::ast::types::KclNone::from_kcl_val(&arg.value).is_some() {
            return Ok(None);
        }
        let Some(val) = T::from_kcl_val(&arg.value) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Argument at index {i} was supposed to be type Option<{}> but found {}",
                    type_name::<T>(),
                    arg.value.human_friendly_type()
                ),
                source_ranges: arg.source_ranges(),
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

impl<'a> FromKclValue<'a> for [f64; 2] {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::MixedArray { value, meta: _ } = arg else {
            return None;
        };
        if value.len() != 2 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let array = [v0.as_f64()?, v1.as_f64()?];
        Some(array)
    }
}

impl<'a> FromKclValue<'a> for [usize; 3] {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::MixedArray { value, meta: _ } = arg else {
            return None;
        };
        if value.len() != 3 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let v2 = value.get(2)?;
        let array = [v0.as_usize()?, v1.as_usize()?, v2.as_usize()?];
        Some(array)
    }
}

impl<'a> FromKclValue<'a> for [f64; 3] {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::MixedArray { value, meta: _ } = arg else {
            return None;
        };
        if value.len() != 3 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let v2 = value.get(2)?;
        let array = [v0.as_f64()?, v1.as_f64()?, v2.as_f64()?];
        Some(array)
    }
}

impl<'a> FromKclValue<'a> for TagNode {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_declarator().ok()
    }
}

impl<'a> FromKclValue<'a> for TagIdentifier {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_identifier().ok()
    }
}

impl<'a> FromKclValue<'a> for KclValue {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        Some(arg.clone())
    }
}

macro_rules! let_field_of {
    // Optional field
    ($obj:ident, $field:ident?) => {
        let $field = $obj.get(stringify!($field)).and_then(FromKclValue::from_kcl_val);
    };
    // Optional field but with a different string used as the key
    ($obj:ident, $field:ident? $key:literal) => {
        let $field = $obj.get($key).and_then(FromKclValue::from_kcl_val);
    };
    // Mandatory field, but with a different string used as the key.
    ($obj:ident, $field:ident $key:literal) => {
        let $field = $obj.get($key).and_then(FromKclValue::from_kcl_val)?;
    };
    // Mandatory field, optionally with a type annotation
    ($obj:ident, $field:ident $(, $annotation:ty)?) => {
        let $field $(: $annotation)? = $obj.get(stringify!($field)).and_then(FromKclValue::from_kcl_val)?;
    };
}

impl<'a> FromKclValue<'a> for crate::std::import::ImportFormat {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, typ "format");
        match typ {
            "fbx" => Some(Self::Fbx {}),
            "gltf" => Some(Self::Gltf {}),
            "sldprt" => Some(Self::Sldprt {}),
            "step" => Some(Self::Step {}),
            "stl" => {
                let_field_of!(obj, coords?);
                let_field_of!(obj, units);
                Some(Self::Stl { coords, units })
            }
            "obj" => {
                let_field_of!(obj, coords?);
                let_field_of!(obj, units);
                Some(Self::Obj { coords, units })
            }
            "ply" => {
                let_field_of!(obj, coords?);
                let_field_of!(obj, units);
                Some(Self::Ply { coords, units })
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for super::sketch::AngledLineThatIntersectsData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, angle);
        let_field_of!(obj, intersect_tag "intersectTag");
        let_field_of!(obj, offset?);
        Some(Self {
            angle,
            intersect_tag,
            offset,
        })
    }
}

impl<'a> FromKclValue<'a> for super::shapes::PolygonData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, radius);
        let_field_of!(obj, num_sides "numSides");
        let_field_of!(obj, center);
        let_field_of!(obj, inscribed);
        let polygon_type = if inscribed {
            PolygonType::Inscribed
        } else {
            PolygonType::Circumscribed
        };
        Some(Self {
            radius,
            num_sides,
            center,
            polygon_type,
            inscribed,
        })
    }
}

impl<'a> FromKclValue<'a> for crate::std::polar::PolarCoordsData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, angle);
        let_field_of!(obj, length);
        Some(Self { angle, length })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Plane {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.as_plane().cloned()
    }
}

impl<'a> FromKclValue<'a> for crate::execution::PlaneType {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let plane_type = match arg.as_str()? {
            "XY" | "xy" => Self::XY,
            "XZ" | "xz" => Self::XZ,
            "YZ" | "yz" => Self::YZ,
            "Custom" => Self::Custom,
            _ => return None,
        };
        Some(plane_type)
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::units::UnitLength {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        s.parse().ok()
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::System {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, forward);
        let_field_of!(obj, up);
        Some(Self { forward, up })
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::AxisDirectionPair {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, axis);
        let_field_of!(obj, direction);
        Some(Self { axis, direction })
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::Axis {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "y" => Some(Self::Y),
            "z" => Some(Self::Z),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for PolygonType {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "inscribed" => Some(Self::Inscribed),
            _ => Some(Self::Circumscribed),
        }
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::Direction {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "positive" => Some(Self::Positive),
            "negative" => Some(Self::Negative),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for super::sketch::BezierData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, to);
        let_field_of!(obj, control1);
        let_field_of!(obj, control2);
        Some(Self { to, control1, control2 })
    }
}

impl<'a> FromKclValue<'a> for super::helix::HelixRevolutionsData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, revolutions);
        let_field_of!(obj, length?);
        let_field_of!(obj, ccw?);
        let ccw = ccw.unwrap_or_default();
        let angle_start = obj.get("angleStart")?.as_f64()?;
        Some(Self {
            revolutions,
            angle_start,
            ccw,
            length,
        })
    }
}

impl<'a> FromKclValue<'a> for FaceTag {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = || match arg.as_str() {
            Some("start" | "START") => Some(Self::StartOrEnd(super::sketch::StartOrEnd::Start)),
            Some("end" | "END") => Some(Self::StartOrEnd(super::sketch::StartOrEnd::End)),
            _ => None,
        };
        let case2 = || {
            let tag = TagIdentifier::from_kcl_val(arg)?;
            Some(Self::Tag(Box::new(tag)))
        };
        case1().or_else(case2)
    }
}

impl<'a> FromKclValue<'a> for super::sketch::AngledLineToData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Deserialize from an {angle, to} object.
        let case1 = || {
            let obj = arg.as_object()?;
            let_field_of!(obj, to);
            let_field_of!(obj, angle);
            Some(Self { angle, to })
        };
        // Deserialize from an [angle, to] array.
        let case2 = || {
            let [angle, to] = arg.as_point2d()?;
            Some(Self { angle, to })
        };
        case1().or_else(case2)
    }
}

impl<'a> FromKclValue<'a> for super::sketch::ArcData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, radius);
        let case1 = || {
            let angle_start = obj.get("angleStart")?.as_f64()?;
            let angle_end = obj.get("angleEnd")?.as_f64()?;
            Some(Self::AnglesAndRadius {
                angle_start,
                angle_end,
                radius,
            })
        };
        let case2 = || {
            let obj = arg.as_object()?;
            let_field_of!(obj, to);
            let_field_of!(obj, center);
            Some(Self::CenterToRadius { center, to, radius })
        };
        case1().or_else(case2)
    }
}

impl<'a> FromKclValue<'a> for super::sketch::ArcToData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, end);
        let_field_of!(obj, interior);
        Some(Self { end, interior })
    }
}

impl<'a> FromKclValue<'a> for super::revolve::RevolveData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let angle = obj.get("angle").and_then(|x| x.as_f64());
        let tolerance = obj.get("tolerance").and_then(|x| x.as_f64());
        let_field_of!(obj, axis);
        Some(Self { angle, axis, tolerance })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::TangentialArcData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, radius);
        let_field_of!(obj, offset);
        Some(Self::RadiusAndOffset { radius, offset })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Point3d {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Case 1: object with x/y/z fields
        if let Some(obj) = arg.as_object() {
            let_field_of!(obj, x);
            let_field_of!(obj, y);
            let_field_of!(obj, z);
            return Some(Self { x, y, z });
        }
        // Case 2: Array of 3 numbers.
        let [x, y, z]: [f64; 3] = FromKclValue::from_kcl_val(arg)?;
        Some(Self { x, y, z })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::PlaneData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Case 0: actual plane
        if let KclValue::Plane { value } = arg {
            return Some(Self::Plane {
                origin: value.origin,
                x_axis: value.x_axis,
                y_axis: value.y_axis,
                z_axis: value.z_axis,
            });
        }
        // Case 1: predefined plane
        if let Some(s) = arg.as_str() {
            return match s {
                "XY" | "xy" => Some(Self::XY),
                "-XY" | "-xy" => Some(Self::NegXY),
                "XZ" | "xz" => Some(Self::XZ),
                "-XZ" | "-xz" => Some(Self::NegXZ),
                "YZ" | "yz" => Some(Self::YZ),
                "-YZ" | "-yz" => Some(Self::NegYZ),
                _ => None,
            };
        }
        // Case 2: custom plane
        let obj = arg.as_object()?;
        let_field_of!(obj, plane, &KclObjectFields);
        let origin = plane.get("origin").and_then(FromKclValue::from_kcl_val)?;
        let x_axis = plane.get("xAxis").and_then(FromKclValue::from_kcl_val)?;
        let y_axis = plane.get("yAxis").and_then(FromKclValue::from_kcl_val)?;
        let z_axis = plane.get("zAxis").and_then(FromKclValue::from_kcl_val)?;
        Some(Self::Plane {
            origin,
            x_axis,
            y_axis,
            z_axis,
        })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::ExtrudePlane {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::ExtrudeArc {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::GeoMeta {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, id);
        let_field_of!(obj, source_range "sourceRange");
        Some(Self {
            id,
            metadata: Metadata { source_range },
        })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::ChamferSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::FilletSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for ExtrudeSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = crate::execution::ExtrudePlane::from_kcl_val;
        let case2 = crate::execution::ExtrudeArc::from_kcl_val;
        let case3 = crate::execution::ChamferSurface::from_kcl_val;
        let case4 = crate::execution::FilletSurface::from_kcl_val;
        case1(arg)
            .map(Self::ExtrudePlane)
            .or_else(|| case2(arg).map(Self::ExtrudeArc))
            .or_else(|| case3(arg).map(Self::Chamfer))
            .or_else(|| case4(arg).map(Self::Fillet))
    }
}

impl<'a> FromKclValue<'a> for crate::execution::EdgeCut {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, typ "type");
        let tag = Box::new(obj.get("tag").and_then(FromKclValue::from_kcl_val));
        let_field_of!(obj, edge_id "edgeId");
        let_field_of!(obj, id);
        match typ {
            "fillet" => {
                let_field_of!(obj, radius);
                Some(Self::Fillet {
                    edge_id,
                    tag,
                    id,
                    radius,
                })
            }
            "chamfer" => {
                let_field_of!(obj, length);
                Some(Self::Chamfer {
                    id,
                    length,
                    edge_id,
                    tag,
                })
            }
            _ => None,
        }
    }
}

macro_rules! impl_from_kcl_for_vec {
    ($typ:path) => {
        impl<'a> FromKclValue<'a> for Vec<$typ> {
            fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
                arg.as_array()?
                    .iter()
                    .map(|value| FromKclValue::from_kcl_val(value))
                    .collect::<Option<_>>()
            }
        }
    };
}

impl_from_kcl_for_vec!(FaceTag);
impl_from_kcl_for_vec!(crate::execution::EdgeCut);
impl_from_kcl_for_vec!(crate::execution::Metadata);
impl_from_kcl_for_vec!(super::fillet::EdgeReference);
impl_from_kcl_for_vec!(ExtrudeSurface);
impl_from_kcl_for_vec!(Sketch);

impl<'a> FromKclValue<'a> for SourceRange {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::MixedArray { value, meta: _ } = arg else {
            return None;
        };
        if value.len() != 3 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let v2 = value.get(2)?;
        Some(SourceRange::new(
            v0.as_usize()?,
            v1.as_usize()?,
            ModuleId::from_usize(v2.as_usize()?),
        ))
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Metadata {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        FromKclValue::from_kcl_val(arg).map(|sr| Self { source_range: sr })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Solid {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.as_solid().cloned()
    }
}

impl<'a> FromKclValue<'a> for super::sketch::SketchData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Order is critical since PlaneData is a subset of Plane.
        let case1 = crate::execution::Plane::from_kcl_val;
        let case2 = super::sketch::PlaneData::from_kcl_val;
        let case3 = crate::execution::Solid::from_kcl_val;
        case1(arg)
            .map(Box::new)
            .map(Self::Plane)
            .or_else(|| case2(arg).map(Self::PlaneOrientation))
            .or_else(|| case3(arg).map(Box::new).map(Self::Solid))
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::AxisAndOrigin2d {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Case 1: predefined planes.
        if let Some(s) = arg.as_str() {
            return match s {
                "X" | "x" => Some(Self::X),
                "Y" | "y" => Some(Self::Y),
                "-X" | "-x" => Some(Self::NegX),
                "-Y" | "-y" => Some(Self::NegY),
                _ => None,
            };
        }
        // Case 2: custom planes.
        let obj = arg.as_object()?;
        let_field_of!(obj, custom, &KclObjectFields);
        let_field_of!(custom, origin);
        let_field_of!(custom, axis);
        Some(Self::Custom { axis, origin })
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::AxisAndOrigin3d {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Case 1: predefined planes.
        if let Some(s) = arg.as_str() {
            return match s {
                "X" | "x" => Some(Self::X),
                "Y" | "y" => Some(Self::Y),
                "Z" | "z" => Some(Self::Z),
                "-X" | "-x" => Some(Self::NegX),
                "-Y" | "-y" => Some(Self::NegY),
                "-Z" | "-z" => Some(Self::NegZ),
                _ => None,
            };
        }
        // Case 2: custom planes.
        let obj = arg.as_object()?;
        let_field_of!(obj, custom, &KclObjectFields);
        let_field_of!(custom, origin);
        let_field_of!(custom, axis);
        Some(Self::Custom { axis, origin })
    }
}

impl<'a> FromKclValue<'a> for super::fillet::EdgeReference {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let id = arg.as_uuid().map(Self::Uuid);
        let tag = || TagIdentifier::from_kcl_val(arg).map(Box::new).map(Self::Tag);
        id.or_else(tag)
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::Axis2dOrEdgeReference {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = super::axis_or_reference::AxisAndOrigin2d::from_kcl_val;
        let case2 = super::fillet::EdgeReference::from_kcl_val;
        case1(arg).map(Self::Axis).or_else(|| case2(arg).map(Self::Edge))
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::Axis3dOrEdgeReference {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = super::axis_or_reference::AxisAndOrigin3d::from_kcl_val;
        let case2 = super::fillet::EdgeReference::from_kcl_val;
        case1(arg).map(Self::Axis).or_else(|| case2(arg).map(Self::Edge))
    }
}

impl<'a> FromKclValue<'a> for super::mirror::Mirror2dData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, axis);
        Some(Self { axis })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::AngledLineData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = |arg: &KclValue| {
            let obj = arg.as_object()?;
            let_field_of!(obj, angle);
            let_field_of!(obj, length);
            Some(Self::AngleAndLengthNamed { angle, length })
        };
        let case2 = |arg: &KclValue| {
            let array = arg.as_array()?;
            let ang = array.first()?.as_f64()?;
            let len = array.get(1)?.as_f64()?;
            Some(Self::AngleAndLengthPair([ang, len]))
        };
        case1(arg).or_else(|| case2(arg))
    }
}

impl<'a> FromKclValue<'a> for i64 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, .. } => crate::try_f64_to_i64(*value),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for &'a str {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::String { value, meta: _ } = arg else {
            return None;
        };
        Some(value)
    }
}

impl<'a> FromKclValue<'a> for &'a KclObjectFields {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Object { value, meta: _ } = arg else {
            return None;
        };
        Some(value)
    }
}

impl<'a> FromKclValue<'a> for uuid::Uuid {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Uuid { value, meta: _ } = arg else {
            return None;
        };
        Some(*value)
    }
}

impl<'a> FromKclValue<'a> for u32 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, .. } => crate::try_f64_to_u32(*value),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for NonZeroU32 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        u32::from_kcl_val(arg).and_then(|x| x.try_into().ok())
    }
}

impl<'a> FromKclValue<'a> for u64 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, .. } => crate::try_f64_to_u64(*value),
            _ => None,
        }
    }
}
impl<'a> FromKclValue<'a> for f64 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, .. } => Some(*value),
            _ => None,
        }
    }
}
impl<'a> FromKclValue<'a> for TyF64 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, ty, .. } => Some(TyF64::new(*value, ty.clone())),
            _ => None,
        }
    }
}
impl<'a> FromKclValue<'a> for Sketch {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Sketch { value } = arg else {
            return None;
        };
        Some(value.as_ref().to_owned())
    }
}

impl<'a> FromKclValue<'a> for Helix {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Helix { value } = arg else {
            return None;
        };
        Some(value.as_ref().to_owned())
    }
}
impl<'a> FromKclValue<'a> for SweepPath {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = Sketch::from_kcl_val;
        let case2 = Helix::from_kcl_val;
        case1(arg)
            .map(Self::Sketch)
            .or_else(|| case2(arg).map(|arg0: Helix| Self::Helix(Box::new(arg0))))
    }
}
impl<'a> FromKclValue<'a> for String {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::String { value, meta: _ } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}
impl<'a> FromKclValue<'a> for crate::parsing::ast::types::KclNone {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::KclNone { value, meta: _ } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}
impl<'a> FromKclValue<'a> for bool {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Bool { value, meta: _ } = arg else {
            return None;
        };
        Some(*value)
    }
}

impl<'a> FromKclValue<'a> for SketchSet {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Sketch { value: sketch } => Some(SketchSet::from(sketch.to_owned())),
            KclValue::Sketches { value } => Some(SketchSet::from(value.to_owned())),
            KclValue::MixedArray { .. } => {
                let v: Option<Vec<Sketch>> = FromKclValue::from_kcl_val(arg);
                Some(SketchSet::Sketches(v?.iter().cloned().map(Box::new).collect()))
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for Box<Solid> {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Solid { value } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}

impl<'a> FromKclValue<'a> for &'a FunctionSource {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.get_function()
    }
}

impl<'a> FromKclValue<'a> for SolidSet {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.get_solid_set().ok()
    }
}

impl<'a> FromKclValue<'a> for SketchOrSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Sketch { value: sg } => Some(Self::Sketch(sg.to_owned())),
            KclValue::Plane { value } => Some(Self::SketchSurface(SketchSurface::Plane(value.clone()))),
            KclValue::Face { value } => Some(Self::SketchSurface(SketchSurface::Face(value.clone()))),
            _ => None,
        }
    }
}
impl<'a> FromKclValue<'a> for SketchSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Plane { value } => Some(Self::Plane(value.clone())),
            KclValue::Face { value } => Some(Self::Face(value.clone())),
            _ => None,
        }
    }
}

impl From<Args> for Metadata {
    fn from(value: Args) -> Self {
        Self {
            source_range: value.source_range,
        }
    }
}

impl From<Args> for Vec<Metadata> {
    fn from(value: Args) -> Self {
        vec![Metadata {
            source_range: value.source_range,
        }]
    }
}
