//! Standard library patterns.

use std::cmp::Ordering;

use anyhow::Result;
use kcmc::{
    ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, ok_response::OkModelingCmdResponse, shared::Transform,
    websocket::OkWebSocketResponseData,
};
use kittycad_modeling_cmds::{
    self as kcmc,
    shared::{Angle, OriginType, Rotation},
};
use serde::Serialize;
use uuid::Uuid;

use super::axis_or_reference::Axis3dOrPoint3d;
use crate::{
    ExecutorContext, SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, Geometries, Geometry, KclObjectFields, KclValue, Sketch, Solid,
        fn_call::{Arg, Args, KwArgs},
        kcl_value::FunctionSource,
        types::{NumericType, PrimitiveType, RuntimeType},
    },
    std::{
        args::TyF64,
        axis_or_reference::Axis2dOrPoint2d,
        utils::{point_3d_to_mm, point_to_mm},
    },
};

const MUST_HAVE_ONE_INSTANCE: &str = "There must be at least 1 instance of your geometry";

/// Repeat some 3D solid, changing each repetition slightly.
pub async fn pattern_transform(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg("solids", &RuntimeType::solids(), exec_state)?;
    let instances: u32 = args.get_kw_arg("instances", &RuntimeType::count(), exec_state)?;
    let transform: FunctionSource = args.get_kw_arg("transform", &RuntimeType::function(), exec_state)?;
    let use_original = args.get_kw_arg_opt("useOriginal", &RuntimeType::bool(), exec_state)?;

    let solids = inner_pattern_transform(solids, instances, transform, use_original, exec_state, &args).await?;
    Ok(solids.into())
}

/// Repeat some 2D sketch, changing each repetition slightly.
pub async fn pattern_transform_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let instances: u32 = args.get_kw_arg("instances", &RuntimeType::count(), exec_state)?;
    let transform: FunctionSource = args.get_kw_arg("transform", &RuntimeType::function(), exec_state)?;
    let use_original = args.get_kw_arg_opt("useOriginal", &RuntimeType::bool(), exec_state)?;

    let sketches = inner_pattern_transform_2d(sketches, instances, transform, use_original, exec_state, &args).await?;
    Ok(sketches.into())
}

async fn inner_pattern_transform(
    solids: Vec<Solid>,
    instances: u32,
    transform: FunctionSource,
    use_original: Option<bool>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<Solid>, KclError> {
    // Build the vec of transforms, one for each repetition.
    let mut transform_vec = Vec::with_capacity(usize::try_from(instances).unwrap());
    if instances < 1 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            MUST_HAVE_ONE_INSTANCE.to_owned(),
            vec![args.source_range],
        )));
    }
    for i in 1..instances {
        let t = make_transform::<Solid>(i, &transform, args.source_range, exec_state, &args.ctx).await?;
        transform_vec.push(t);
    }
    execute_pattern_transform(
        transform_vec,
        solids,
        use_original.unwrap_or_default(),
        exec_state,
        args,
    )
    .await
}

async fn inner_pattern_transform_2d(
    sketches: Vec<Sketch>,
    instances: u32,
    transform: FunctionSource,
    use_original: Option<bool>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<Sketch>, KclError> {
    // Build the vec of transforms, one for each repetition.
    let mut transform_vec = Vec::with_capacity(usize::try_from(instances).unwrap());
    if instances < 1 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            MUST_HAVE_ONE_INSTANCE.to_owned(),
            vec![args.source_range],
        )));
    }
    for i in 1..instances {
        let t = make_transform::<Sketch>(i, &transform, args.source_range, exec_state, &args.ctx).await?;
        transform_vec.push(t);
    }
    execute_pattern_transform(
        transform_vec,
        sketches,
        use_original.unwrap_or_default(),
        exec_state,
        args,
    )
    .await
}

async fn execute_pattern_transform<T: GeometryTrait>(
    transforms: Vec<Vec<Transform>>,
    geo_set: T::Set,
    use_original: bool,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<T>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these solids.
    T::flush_batch(args, exec_state, &geo_set).await?;
    let starting: Vec<T> = geo_set.into();

    if args.ctx.context_type == crate::execution::ContextType::Mock {
        return Ok(starting);
    }

    let mut output = Vec::new();
    for geo in starting {
        let new = send_pattern_transform(transforms.clone(), &geo, use_original, exec_state, args).await?;
        output.extend(new)
    }
    Ok(output)
}

async fn send_pattern_transform<T: GeometryTrait>(
    // This should be passed via reference, see
    // https://github.com/KittyCAD/modeling-app/issues/2821
    transforms: Vec<Vec<Transform>>,
    solid: &T,
    use_original: bool,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<T>, KclError> {
    let extra_instances = transforms.len();

    let resp = exec_state
        .send_modeling_cmd(
            args.into(),
            ModelingCmd::from(mcmd::EntityLinearPatternTransform {
                entity_id: if use_original { solid.original_id() } else { solid.id() },
                transform: Default::default(),
                transforms,
            }),
        )
        .await?;

    let mut mock_ids = Vec::new();
    let entity_ids = if let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityLinearPatternTransform(pattern_info),
    } = &resp
    {
        &pattern_info.entity_face_edge_ids.iter().map(|x| x.object_id).collect()
    } else if args.ctx.no_engine_commands().await {
        mock_ids.reserve(extra_instances);
        for _ in 0..extra_instances {
            mock_ids.push(exec_state.next_uuid());
        }
        &mock_ids
    } else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("EntityLinearPattern response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };

    let mut geometries = vec![solid.clone()];
    for id in entity_ids.iter().copied() {
        let mut new_solid = solid.clone();
        new_solid.set_id(id);
        geometries.push(new_solid);
    }
    Ok(geometries)
}

async fn make_transform<T: GeometryTrait>(
    i: u32,
    transform: &FunctionSource,
    source_range: SourceRange,
    exec_state: &mut ExecState,
    ctxt: &ExecutorContext,
) -> Result<Vec<Transform>, KclError> {
    // Call the transform fn for this repetition.
    let repetition_num = KclValue::Number {
        value: i.into(),
        ty: NumericType::count(),
        meta: vec![source_range.into()],
    };
    let kw_args = KwArgs {
        unlabeled: Some((None, Arg::new(repetition_num, source_range))),
        labeled: Default::default(),
        errors: Vec::new(),
    };
    let transform_fn_args = Args::new_kw(
        kw_args,
        source_range,
        ctxt.clone(),
        exec_state.pipe_value().map(|v| Arg::new(v.clone(), source_range)),
    );
    let transform_fn_return = transform
        .call_kw(None, exec_state, ctxt, transform_fn_args, source_range)
        .await?;

    // Unpack the returned transform object.
    let source_ranges = vec![source_range];
    let transform_fn_return = transform_fn_return.ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            "Transform function must return a value".to_string(),
            source_ranges.clone(),
        ))
    })?;
    let transforms = match transform_fn_return {
        KclValue::Object { value, meta: _ } => vec![value],
        KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => {
            let transforms: Vec<_> = value
                .into_iter()
                .map(|val| {
                    val.into_object().ok_or(KclError::new_semantic(KclErrorDetails::new(
                        "Transform function must return a transform object".to_string(),
                        source_ranges.clone(),
                    )))
                })
                .collect::<Result<_, _>>()?;
            transforms
        }
        _ => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Transform function must return a transform object".to_string(),
                source_ranges.clone(),
            )));
        }
    };

    transforms
        .into_iter()
        .map(|obj| transform_from_obj_fields::<T>(obj, source_ranges.clone(), exec_state))
        .collect()
}

fn transform_from_obj_fields<T: GeometryTrait>(
    transform: KclObjectFields,
    source_ranges: Vec<SourceRange>,
    exec_state: &mut ExecState,
) -> Result<Transform, KclError> {
    // Apply defaults to the transform.
    let replicate = match transform.get("replicate") {
        Some(KclValue::Bool { value: true, .. }) => true,
        Some(KclValue::Bool { value: false, .. }) => false,
        Some(_) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "The 'replicate' key must be a bool".to_string(),
                source_ranges.clone(),
            )));
        }
        None => true,
    };

    let scale = match transform.get("scale") {
        Some(x) => point_3d_to_mm(T::array_to_point3d(x, source_ranges.clone(), exec_state)?).into(),
        None => kcmc::shared::Point3d { x: 1.0, y: 1.0, z: 1.0 },
    };

    let translate = match transform.get("translate") {
        Some(x) => {
            let arr = point_3d_to_mm(T::array_to_point3d(x, source_ranges.clone(), exec_state)?);
            kcmc::shared::Point3d::<LengthUnit> {
                x: LengthUnit(arr[0]),
                y: LengthUnit(arr[1]),
                z: LengthUnit(arr[2]),
            }
        }
        None => kcmc::shared::Point3d::<LengthUnit> {
            x: LengthUnit(0.0),
            y: LengthUnit(0.0),
            z: LengthUnit(0.0),
        },
    };

    let mut rotation = Rotation::default();
    if let Some(rot) = transform.get("rotation") {
        let KclValue::Object { value: rot, meta: _ } = rot else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "The 'rotation' key must be an object (with optional fields 'angle', 'axis' and 'origin')".to_owned(),
                source_ranges.clone(),
            )));
        };
        if let Some(axis) = rot.get("axis") {
            rotation.axis = point_3d_to_mm(T::array_to_point3d(axis, source_ranges.clone(), exec_state)?).into();
        }
        if let Some(angle) = rot.get("angle") {
            match angle {
                KclValue::Number { value: number, .. } => {
                    rotation.angle = Angle::from_degrees(*number);
                }
                _ => {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "The 'rotation.angle' key must be a number (of degrees)".to_owned(),
                        source_ranges.clone(),
                    )));
                }
            }
        }
        if let Some(origin) = rot.get("origin") {
            rotation.origin = match origin {
                KclValue::String { value: s, meta: _ } if s == "local" => OriginType::Local,
                KclValue::String { value: s, meta: _ } if s == "global" => OriginType::Global,
                other => {
                    let origin = point_3d_to_mm(T::array_to_point3d(other, source_ranges.clone(), exec_state)?).into();
                    OriginType::Custom { origin }
                }
            };
        }
    }

    Ok(Transform {
        replicate,
        scale,
        translate,
        rotation,
    })
}

fn array_to_point3d(
    val: &KclValue,
    source_ranges: Vec<SourceRange>,
    exec_state: &mut ExecState,
) -> Result<[TyF64; 3], KclError> {
    val.coerce(&RuntimeType::point3d(), true, exec_state)
        .map_err(|e| {
            KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Expected an array of 3 numbers (i.e., a 3D point), found {}",
                    e.found
                        .map(|t| t.human_friendly_type())
                        .unwrap_or_else(|| val.human_friendly_type().to_owned())
                ),
                source_ranges,
            ))
        })
        .map(|val| val.as_point3d().unwrap())
}

fn array_to_point2d(
    val: &KclValue,
    source_ranges: Vec<SourceRange>,
    exec_state: &mut ExecState,
) -> Result<[TyF64; 2], KclError> {
    val.coerce(&RuntimeType::point2d(), true, exec_state)
        .map_err(|e| {
            KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Expected an array of 2 numbers (i.e., a 2D point), found {}",
                    e.found
                        .map(|t| t.human_friendly_type())
                        .unwrap_or_else(|| val.human_friendly_type().to_owned())
                ),
                source_ranges,
            ))
        })
        .map(|val| val.as_point2d().unwrap())
}

pub trait GeometryTrait: Clone {
    type Set: Into<Vec<Self>> + Clone;
    fn id(&self) -> Uuid;
    fn original_id(&self) -> Uuid;
    fn set_id(&mut self, id: Uuid);
    fn array_to_point3d(
        val: &KclValue,
        source_ranges: Vec<SourceRange>,
        exec_state: &mut ExecState,
    ) -> Result<[TyF64; 3], KclError>;
    #[allow(async_fn_in_trait)]
    async fn flush_batch(args: &Args, exec_state: &mut ExecState, set: &Self::Set) -> Result<(), KclError>;
}

impl GeometryTrait for Sketch {
    type Set = Vec<Sketch>;
    fn set_id(&mut self, id: Uuid) {
        self.id = id;
    }
    fn id(&self) -> Uuid {
        self.id
    }
    fn original_id(&self) -> Uuid {
        self.original_id
    }
    fn array_to_point3d(
        val: &KclValue,
        source_ranges: Vec<SourceRange>,
        exec_state: &mut ExecState,
    ) -> Result<[TyF64; 3], KclError> {
        let [x, y] = array_to_point2d(val, source_ranges, exec_state)?;
        let ty = x.ty;
        Ok([x, y, TyF64::new(0.0, ty)])
    }

    async fn flush_batch(_: &Args, _: &mut ExecState, _: &Self::Set) -> Result<(), KclError> {
        Ok(())
    }
}

impl GeometryTrait for Solid {
    type Set = Vec<Solid>;
    fn set_id(&mut self, id: Uuid) {
        self.id = id;
        // We need this for in extrude.rs when you sketch on face.
        self.sketch.id = id;
    }

    fn id(&self) -> Uuid {
        self.id
    }

    fn original_id(&self) -> Uuid {
        self.sketch.original_id
    }

    fn array_to_point3d(
        val: &KclValue,
        source_ranges: Vec<SourceRange>,
        exec_state: &mut ExecState,
    ) -> Result<[TyF64; 3], KclError> {
        array_to_point3d(val, source_ranges, exec_state)
    }

    async fn flush_batch(args: &Args, exec_state: &mut ExecState, solid_set: &Self::Set) -> Result<(), KclError> {
        exec_state.flush_batch_for_solids(args.into(), solid_set).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::types::{NumericType, PrimitiveType};

    #[tokio::test(flavor = "multi_thread")]
    async fn test_array_to_point3d() {
        let mut exec_state = ExecState::new(&ExecutorContext::new_mock(None).await);
        let input = KclValue::HomArray {
            value: vec![
                KclValue::Number {
                    value: 1.1,
                    meta: Default::default(),
                    ty: NumericType::mm(),
                },
                KclValue::Number {
                    value: 2.2,
                    meta: Default::default(),
                    ty: NumericType::mm(),
                },
                KclValue::Number {
                    value: 3.3,
                    meta: Default::default(),
                    ty: NumericType::mm(),
                },
            ],
            ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::mm())),
        };
        let expected = [
            TyF64::new(1.1, NumericType::mm()),
            TyF64::new(2.2, NumericType::mm()),
            TyF64::new(3.3, NumericType::mm()),
        ];
        let actual = array_to_point3d(&input, Vec::new(), &mut exec_state);
        assert_eq!(actual.unwrap(), expected);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_tuple_to_point3d() {
        let mut exec_state = ExecState::new(&ExecutorContext::new_mock(None).await);
        let input = KclValue::Tuple {
            value: vec![
                KclValue::Number {
                    value: 1.1,
                    meta: Default::default(),
                    ty: NumericType::mm(),
                },
                KclValue::Number {
                    value: 2.2,
                    meta: Default::default(),
                    ty: NumericType::mm(),
                },
                KclValue::Number {
                    value: 3.3,
                    meta: Default::default(),
                    ty: NumericType::mm(),
                },
            ],
            meta: Default::default(),
        };
        let expected = [
            TyF64::new(1.1, NumericType::mm()),
            TyF64::new(2.2, NumericType::mm()),
            TyF64::new(3.3, NumericType::mm()),
        ];
        let actual = array_to_point3d(&input, Vec::new(), &mut exec_state);
        assert_eq!(actual.unwrap(), expected);
    }
}

/// A linear pattern on a 2D sketch.
pub async fn pattern_linear_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let instances: u32 = args.get_kw_arg("instances", &RuntimeType::count(), exec_state)?;
    let distance: TyF64 = args.get_kw_arg("distance", &RuntimeType::length(), exec_state)?;
    let axis: Axis2dOrPoint2d = args.get_kw_arg(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Axis2d),
            RuntimeType::point2d(),
        ]),
        exec_state,
    )?;
    let use_original = args.get_kw_arg_opt("useOriginal", &RuntimeType::bool(), exec_state)?;

    let axis = axis.to_point2d();
    if axis[0].n == 0.0 && axis[1].n == 0.0 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                .to_owned(),
            vec![args.source_range],
        )));
    }

    let sketches = inner_pattern_linear_2d(sketches, instances, distance, axis, use_original, exec_state, args).await?;
    Ok(sketches.into())
}

async fn inner_pattern_linear_2d(
    sketches: Vec<Sketch>,
    instances: u32,
    distance: TyF64,
    axis: [TyF64; 2],
    use_original: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Sketch>, KclError> {
    let [x, y] = point_to_mm(axis);
    let axis_len = f64::sqrt(x * x + y * y);
    let normalized_axis = kcmc::shared::Point2d::from([x / axis_len, y / axis_len]);
    let transforms: Vec<_> = (1..instances)
        .map(|i| {
            let d = distance.to_mm() * (i as f64);
            let translate = (normalized_axis * d).with_z(0.0).map(LengthUnit);
            vec![Transform {
                translate,
                ..Default::default()
            }]
        })
        .collect();
    execute_pattern_transform(
        transforms,
        sketches,
        use_original.unwrap_or_default(),
        exec_state,
        &args,
    )
    .await
}

/// A linear pattern on a 3D model.
pub async fn pattern_linear_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg("solids", &RuntimeType::solids(), exec_state)?;
    let instances: u32 = args.get_kw_arg("instances", &RuntimeType::count(), exec_state)?;
    let distance: TyF64 = args.get_kw_arg("distance", &RuntimeType::length(), exec_state)?;
    let axis: Axis3dOrPoint3d = args.get_kw_arg(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Axis3d),
            RuntimeType::point3d(),
        ]),
        exec_state,
    )?;
    let use_original = args.get_kw_arg_opt("useOriginal", &RuntimeType::bool(), exec_state)?;

    let axis = axis.to_point3d();
    if axis[0].n == 0.0 && axis[1].n == 0.0 && axis[2].n == 0.0 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                .to_owned(),
            vec![args.source_range],
        )));
    }

    let solids = inner_pattern_linear_3d(solids, instances, distance, axis, use_original, exec_state, args).await?;
    Ok(solids.into())
}

async fn inner_pattern_linear_3d(
    solids: Vec<Solid>,
    instances: u32,
    distance: TyF64,
    axis: [TyF64; 3],
    use_original: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let [x, y, z] = point_3d_to_mm(axis);
    let axis_len = f64::sqrt(x * x + y * y + z * z);
    let normalized_axis = kcmc::shared::Point3d::from([x / axis_len, y / axis_len, z / axis_len]);
    let transforms: Vec<_> = (1..instances)
        .map(|i| {
            let d = distance.to_mm() * (i as f64);
            let translate = (normalized_axis * d).map(LengthUnit);
            vec![Transform {
                translate,
                ..Default::default()
            }]
        })
        .collect();
    execute_pattern_transform(transforms, solids, use_original.unwrap_or_default(), exec_state, &args).await
}

/// Data for a circular pattern on a 2D sketch.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CircularPattern2dData {
    /// The number of total instances. Must be greater than or equal to 1.
    /// This includes the original entity. For example, if instances is 2,
    /// there will be two copies -- the original, and one new copy.
    /// If instances is 1, this has no effect.
    pub instances: u32,
    /// The center about which to make the pattern. This is a 2D vector.
    pub center: [TyF64; 2],
    /// The arc angle (in degrees) to place the repetitions. Must be greater than 0.
    pub arc_degrees: Option<f64>,
    /// Whether or not to rotate the duplicates as they are copied.
    pub rotate_duplicates: Option<bool>,
    /// If the target being patterned is itself a pattern, then, should you use the original solid,
    /// or the pattern?
    #[serde(default)]
    pub use_original: Option<bool>,
}

/// Data for a circular pattern on a 3D model.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CircularPattern3dData {
    /// The number of total instances. Must be greater than or equal to 1.
    /// This includes the original entity. For example, if instances is 2,
    /// there will be two copies -- the original, and one new copy.
    /// If instances is 1, this has no effect.
    pub instances: u32,
    /// The axis around which to make the pattern. This is a 3D vector.
    // Only the direction should matter, not the magnitude so don't adjust units to avoid normalisation issues.
    pub axis: [f64; 3],
    /// The center about which to make the pattern. This is a 3D vector.
    pub center: [TyF64; 3],
    /// The arc angle (in degrees) to place the repetitions. Must be greater than 0.
    pub arc_degrees: Option<f64>,
    /// Whether or not to rotate the duplicates as they are copied.
    pub rotate_duplicates: Option<bool>,
    /// If the target being patterned is itself a pattern, then, should you use the original solid,
    /// or the pattern?
    #[serde(default)]
    pub use_original: Option<bool>,
}

#[allow(clippy::large_enum_variant)]
enum CircularPattern {
    ThreeD(CircularPattern3dData),
    TwoD(CircularPattern2dData),
}

enum RepetitionsNeeded {
    /// Add this number of repetitions
    More(u32),
    /// No repetitions needed
    None,
    /// Invalid number of total instances.
    Invalid,
}

impl From<u32> for RepetitionsNeeded {
    fn from(n: u32) -> Self {
        match n.cmp(&1) {
            Ordering::Less => Self::Invalid,
            Ordering::Equal => Self::None,
            Ordering::Greater => Self::More(n - 1),
        }
    }
}

impl CircularPattern {
    pub fn axis(&self) -> [f64; 3] {
        match self {
            CircularPattern::TwoD(_lp) => [0.0, 0.0, 0.0],
            CircularPattern::ThreeD(lp) => [lp.axis[0], lp.axis[1], lp.axis[2]],
        }
    }

    pub fn center_mm(&self) -> [f64; 3] {
        match self {
            CircularPattern::TwoD(lp) => [lp.center[0].to_mm(), lp.center[1].to_mm(), 0.0],
            CircularPattern::ThreeD(lp) => [lp.center[0].to_mm(), lp.center[1].to_mm(), lp.center[2].to_mm()],
        }
    }

    fn repetitions(&self) -> RepetitionsNeeded {
        let n = match self {
            CircularPattern::TwoD(lp) => lp.instances,
            CircularPattern::ThreeD(lp) => lp.instances,
        };
        RepetitionsNeeded::from(n)
    }

    pub fn arc_degrees(&self) -> Option<f64> {
        match self {
            CircularPattern::TwoD(lp) => lp.arc_degrees,
            CircularPattern::ThreeD(lp) => lp.arc_degrees,
        }
    }

    pub fn rotate_duplicates(&self) -> Option<bool> {
        match self {
            CircularPattern::TwoD(lp) => lp.rotate_duplicates,
            CircularPattern::ThreeD(lp) => lp.rotate_duplicates,
        }
    }

    pub fn use_original(&self) -> bool {
        match self {
            CircularPattern::TwoD(lp) => lp.use_original.unwrap_or_default(),
            CircularPattern::ThreeD(lp) => lp.use_original.unwrap_or_default(),
        }
    }
}

/// A circular pattern on a 2D sketch.
pub async fn pattern_circular_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let instances: u32 = args.get_kw_arg("instances", &RuntimeType::count(), exec_state)?;
    let center: [TyF64; 2] = args.get_kw_arg("center", &RuntimeType::point2d(), exec_state)?;
    let arc_degrees: Option<TyF64> = args.get_kw_arg_opt("arcDegrees", &RuntimeType::degrees(), exec_state)?;
    let rotate_duplicates = args.get_kw_arg_opt("rotateDuplicates", &RuntimeType::bool(), exec_state)?;
    let use_original = args.get_kw_arg_opt("useOriginal", &RuntimeType::bool(), exec_state)?;

    let sketches = inner_pattern_circular_2d(
        sketches,
        instances,
        center,
        arc_degrees.map(|x| x.n),
        rotate_duplicates,
        use_original,
        exec_state,
        args,
    )
    .await?;
    Ok(sketches.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_pattern_circular_2d(
    sketch_set: Vec<Sketch>,
    instances: u32,
    center: [TyF64; 2],
    arc_degrees: Option<f64>,
    rotate_duplicates: Option<bool>,
    use_original: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Sketch>, KclError> {
    let starting_sketches = sketch_set;

    if args.ctx.context_type == crate::execution::ContextType::Mock {
        return Ok(starting_sketches);
    }
    let data = CircularPattern2dData {
        instances,
        center,
        arc_degrees,
        rotate_duplicates,
        use_original,
    };

    let mut sketches = Vec::new();
    for sketch in starting_sketches.iter() {
        let geometries = pattern_circular(
            CircularPattern::TwoD(data.clone()),
            Geometry::Sketch(sketch.clone()),
            exec_state,
            args.clone(),
        )
        .await?;

        let Geometries::Sketches(new_sketches) = geometries else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Expected a vec of sketches".to_string(),
                vec![args.source_range],
            )));
        };

        sketches.extend(new_sketches);
    }

    Ok(sketches)
}

/// A circular pattern on a 3D model.
pub async fn pattern_circular_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg("solids", &RuntimeType::solids(), exec_state)?;
    // The number of total instances. Must be greater than or equal to 1.
    // This includes the original entity. For example, if instances is 2,
    // there will be two copies -- the original, and one new copy.
    // If instances is 1, this has no effect.
    let instances: u32 = args.get_kw_arg("instances", &RuntimeType::count(), exec_state)?;
    // The axis around which to make the pattern. This is a 3D vector.
    let axis: Axis3dOrPoint3d = args.get_kw_arg(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Axis3d),
            RuntimeType::point3d(),
        ]),
        exec_state,
    )?;
    let axis = axis.to_point3d();

    // The center about which to make the pattern. This is a 3D vector.
    let center: [TyF64; 3] = args.get_kw_arg("center", &RuntimeType::point3d(), exec_state)?;
    // The arc angle (in degrees) to place the repetitions. Must be greater than 0.
    let arc_degrees: Option<TyF64> = args.get_kw_arg_opt("arcDegrees", &RuntimeType::degrees(), exec_state)?;
    // Whether or not to rotate the duplicates as they are copied.
    let rotate_duplicates = args.get_kw_arg_opt("rotateDuplicates", &RuntimeType::bool(), exec_state)?;
    // If the target being patterned is itself a pattern, then, should you use the original solid,
    // or the pattern?
    let use_original = args.get_kw_arg_opt("useOriginal", &RuntimeType::bool(), exec_state)?;

    let solids = inner_pattern_circular_3d(
        solids,
        instances,
        [axis[0].n, axis[1].n, axis[2].n],
        center,
        arc_degrees.map(|x| x.n),
        rotate_duplicates,
        use_original,
        exec_state,
        args,
    )
    .await?;
    Ok(solids.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_pattern_circular_3d(
    solids: Vec<Solid>,
    instances: u32,
    axis: [f64; 3],
    center: [TyF64; 3],
    arc_degrees: Option<f64>,
    rotate_duplicates: Option<bool>,
    use_original: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these solids.
    exec_state.flush_batch_for_solids((&args).into(), &solids).await?;

    let starting_solids = solids;

    if args.ctx.context_type == crate::execution::ContextType::Mock {
        return Ok(starting_solids);
    }

    let mut solids = Vec::new();
    let data = CircularPattern3dData {
        instances,
        axis,
        center,
        arc_degrees,
        rotate_duplicates,
        use_original,
    };
    for solid in starting_solids.iter() {
        let geometries = pattern_circular(
            CircularPattern::ThreeD(data.clone()),
            Geometry::Solid(solid.clone()),
            exec_state,
            args.clone(),
        )
        .await?;

        let Geometries::Solids(new_solids) = geometries else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Expected a vec of solids".to_string(),
                vec![args.source_range],
            )));
        };

        solids.extend(new_solids);
    }

    Ok(solids)
}

async fn pattern_circular(
    data: CircularPattern,
    geometry: Geometry,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Geometries, KclError> {
    let num_repetitions = match data.repetitions() {
        RepetitionsNeeded::More(n) => n,
        RepetitionsNeeded::None => {
            return Ok(Geometries::from(geometry));
        }
        RepetitionsNeeded::Invalid => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                MUST_HAVE_ONE_INSTANCE.to_owned(),
                vec![args.source_range],
            )));
        }
    };

    let center = data.center_mm();
    let resp = exec_state
        .send_modeling_cmd(
            (&args).into(),
            ModelingCmd::from(mcmd::EntityCircularPattern {
                axis: kcmc::shared::Point3d::from(data.axis()),
                entity_id: if data.use_original() {
                    geometry.original_id()
                } else {
                    geometry.id()
                },
                center: kcmc::shared::Point3d {
                    x: LengthUnit(center[0]),
                    y: LengthUnit(center[1]),
                    z: LengthUnit(center[2]),
                },
                num_repetitions,
                arc_degrees: data.arc_degrees().unwrap_or(360.0),
                rotate_duplicates: data.rotate_duplicates().unwrap_or(true),
            }),
        )
        .await?;

    // The common case is borrowing from the response.  Instead of cloning,
    // create a Vec to borrow from in mock mode.
    let mut mock_ids = Vec::new();
    let entity_ids = if let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityCircularPattern(pattern_info),
    } = &resp
    {
        &pattern_info.entity_face_edge_ids.iter().map(|e| e.object_id).collect()
    } else if args.ctx.no_engine_commands().await {
        mock_ids.reserve(num_repetitions as usize);
        for _ in 0..num_repetitions {
            mock_ids.push(exec_state.next_uuid());
        }
        &mock_ids
    } else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("EntityCircularPattern response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };

    let geometries = match geometry {
        Geometry::Sketch(sketch) => {
            let mut geometries = vec![sketch.clone()];
            for id in entity_ids.iter().copied() {
                let mut new_sketch = sketch.clone();
                new_sketch.id = id;
                geometries.push(new_sketch);
            }
            Geometries::Sketches(geometries)
        }
        Geometry::Solid(solid) => {
            let mut geometries = vec![solid.clone()];
            for id in entity_ids.iter().copied() {
                let mut new_solid = solid.clone();
                new_solid.id = id;
                geometries.push(new_solid);
            }
            Geometries::Solids(geometries)
        }
    };

    Ok(geometries)
}
