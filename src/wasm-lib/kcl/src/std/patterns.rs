//! Standard library patterns.

use std::cmp::Ordering;

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd, length_unit::LengthUnit, ok_response::OkModelingCmdResponse, shared::Transform,
    websocket::OkWebSocketResponseData, ModelingCmd,
};
use kittycad_modeling_cmds::{
    self as kcmc,
    shared::{Angle, OriginType, Rotation},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::args::Arg;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, FunctionParam, Geometries, Geometry, KclObjectFields, KclValue, Point2d, Point3d, Sketch, SketchSet,
        Solid, SolidSet,
    },
    std::Args,
    SourceRange,
};

const MUST_HAVE_ONE_INSTANCE: &str = "There must be at least 1 instance of your geometry";

/// Data for a linear pattern on a 2D sketch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinearPattern2dData {
    /// The number of total instances. Must be greater than or equal to 1.
    /// This includes the original entity. For example, if instances is 2,
    /// there will be two copies -- the original, and one new copy.
    /// If instances is 1, this has no effect.
    pub instances: u32,
    /// The distance between each repetition. This can also be referred to as spacing.
    pub distance: f64,
    /// The axis of the pattern. This is a 2D vector.
    pub axis: [f64; 2],
}

/// Data for a linear pattern on a 3D model.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinearPattern3dData {
    /// The number of total instances. Must be greater than or equal to 1.
    /// This includes the original entity. For example, if instances is 2,
    /// there will be two copies -- the original, and one new copy.
    /// If instances is 1, this has no effect.
    pub instances: u32,
    /// The distance between each repetition. This can also be referred to as spacing.
    pub distance: f64,
    /// The axis of the pattern.
    pub axis: [f64; 3],
}

/// Repeat some 3D solid, changing each repetition slightly.
pub async fn pattern_transform(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (num_repetitions, transform, extr) = args.get_pattern_transform_args()?;

    let solids = inner_pattern_transform(
        num_repetitions,
        FunctionParam {
            inner: transform.func,
            fn_expr: transform.expr,
            meta: vec![args.source_range.into()],
            ctx: args.ctx.clone(),
            memory: *transform.memory,
        },
        extr,
        exec_state,
        &args,
    )
    .await?;
    Ok(KclValue::Solids { value: solids })
}

/// Repeat some 2D sketch, changing each repetition slightly.
pub async fn pattern_transform_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (num_repetitions, transform, sketch): (u32, super::FnAsArg<'_>, SketchSet) =
        super::args::FromArgs::from_args(&args, 0)?;

    let sketches = inner_pattern_transform_2d(
        num_repetitions,
        FunctionParam {
            inner: transform.func,
            fn_expr: transform.expr,
            meta: vec![args.source_range.into()],
            ctx: args.ctx.clone(),
            memory: *transform.memory,
        },
        sketch,
        exec_state,
        &args,
    )
    .await?;
    Ok(KclValue::Sketches { value: sketches })
}

/// Repeat a 3-dimensional solid, changing it each time.
///
/// Replicates the 3D solid, applying a transformation function to each replica.
/// Transformation function could alter rotation, scale, visibility, position, etc.
///
/// The `patternTransform` call itself takes a number for how many total instances of
/// the shape should be. For example, if you use a circle with `patternTransform(4, transform)`
/// then there will be 4 circles: the original, and 3 created by replicating the original and
/// calling the transform function on each.
///
/// The transform function takes a single parameter: an integer representing which
/// number replication the transform is for. E.g. the first replica to be transformed
/// will be passed the argument `1`. This simplifies your math: the transform function can
/// rely on id `0` being the original instance passed into the `patternTransform`. See the examples.
///
/// The transform function returns a transform object. All properties of the object are optional,
/// they each default to "no change". So the overall transform object defaults to "no change" too.
/// Its properties are:
///
///  - `translate` (3D point)
///
///    Translates the replica, moving its position in space.      
///
///  - `replicate` (bool)
///
///    If false, this ID will not actually copy the object. It'll be skipped.
///
///  - `scale` (3D point)
///
///    Stretches the object, multiplying its width in the given dimension by the point's component in
///    that direction.      
///
///  - `rotation` (object, with the following properties)
///
///    - `rotation.axis` (a 3D point, defaults to the Z axis)
///
///    - `rotation.angle` (number of degrees)
///
///    - `rotation.origin` (either "local" i.e. rotate around its own center, "global" i.e. rotate around the scene's center, or a 3D point, defaults to "local")
///
/// ```no_run
/// // Each instance will be shifted along the X axis.
/// fn transform(id) {
///   return { translate = [4 * id, 0, 0] }
/// }
///
/// // Sketch 4 cylinders.
/// sketch001 = startSketchOn('XZ')
///   |> circle({ center = [0, 0], radius = 2 }, %)
///   |> extrude(length = 5)
///   |> patternTransform(4, transform, %)
/// ```
/// ```no_run
/// // Each instance will be shifted along the X axis,
/// // with a gap between the original (at x = 0) and the first replica
/// // (at x = 8). This is because `id` starts at 1.
/// fn transform(id) {
///   return { translate: [4 * (1+id), 0, 0] }
/// }
///
/// sketch001 = startSketchOn('XZ')
///   |> circle({ center = [0, 0], radius = 2 }, %)
///   |> extrude(length = 5)
///   |> patternTransform(4, transform, %)
/// ```
/// ```no_run
/// fn cube(length, center) {
///   l = length/2
///   x = center[0]
///   y = center[1]
///   p0 = [-l + x, -l + y]
///   p1 = [-l + x,  l + y]
///   p2 = [ l + x,  l + y]
///   p3 = [ l + x, -l + y]
///
///   return startSketchOn('XY')
///   |> startProfileAt(p0, %)
///   |> line(endAbsolute = p1)
///   |> line(endAbsolute = p2)
///   |> line(endAbsolute = p3)
///   |> line(endAbsolute = p0)
///   |> close()
///   |> extrude(length = length)
/// }
///
/// width = 20
/// fn transform(i) {
///   return {
///     // Move down each time.
///     translate = [0, 0, -i * width],
///     // Make the cube longer, wider and flatter each time.
///     scale = [pow(1.1, i), pow(1.1, i), pow(0.9, i)],
///     // Turn by 15 degrees each time.
///     rotation = {
///       angle = 15 * i,
///       origin = "local",
///     }
///   }
/// }
///
/// myCubes =
///   cube(width, [100,0])
///   |> patternTransform(25, transform, %)
/// ```
///
/// ```no_run
/// fn cube(length, center) {
///   l = length/2
///   x = center[0]
///   y = center[1]
///   p0 = [-l + x, -l + y]
///   p1 = [-l + x,  l + y]
///   p2 = [ l + x,  l + y]
///   p3 = [ l + x, -l + y]
///   
///   return startSketchOn('XY')
///   |> startProfileAt(p0, %)
///   |> line(endAbsolute = p1)
///   |> line(endAbsolute = p2)
///   |> line(endAbsolute = p3)
///   |> line(endAbsolute = p0)
///   |> close()
///   |> extrude(length = length)
/// }
///
/// width = 20
/// fn transform(i) {
///   return {
///     translate = [0, 0, -i * width],
///     rotation = {
///       angle = 90 * i,
///       // Rotate around the overall scene's origin.
///       origin = "global",
///     }
///   }
/// }
/// myCubes =
///   cube(width, [100,100])
///   |> patternTransform(4, transform, %)
/// ```
/// ```no_run
/// // Parameters
/// r = 50    // base radius
/// h = 10    // layer height
/// t = 0.005 // taper factor [0-1)
/// // Defines how to modify each layer of the vase.
/// // Each replica is shifted up the Z axis, and has a smoothly-varying radius
/// fn transform(replicaId) {
///   scale = r * abs(1 - (t * replicaId)) * (5 + cos(replicaId / 8))
///   return {
///     translate = [0, 0, replicaId * 10],
///     scale = [scale, scale, 0],
///   }
/// }
/// // Each layer is just a pretty thin cylinder.
/// fn layer() {
///   return startSketchOn("XY") // or some other plane idk
///     |> circle({ center = [0, 0], radius = 1 }, %, $tag1)
///     |> extrude(length = h)
/// }
/// // The vase is 100 layers tall.
/// // The 100 layers are replica of each other, with a slight transformation applied to each.
/// vase = layer() |> patternTransform(100, transform, %)
/// ```
/// ```
/// fn transform(i) {
///   // Transform functions can return multiple transforms. They'll be applied in order.
///   return [
///     { translate: [30 * i, 0, 0] },
///     { rotation: { angle: 45 * i } },
///   ]
/// }
/// startSketchOn('XY')
///   |> startProfileAt([0, 0], %)
///   |> polygon({
///        radius: 10,
///        numSides: 4,
///        center: [0, 0],
///        inscribed: false
///      }, %)
///   |> extrude(length = 4)
///   |> patternTransform(3, transform, %)
/// ```
#[stdlib {
    name = "patternTransform",
    feature_tree_operation = true,
}]
async fn inner_pattern_transform<'a>(
    total_instances: u32,
    transform_function: FunctionParam<'a>,
    solid_set: SolidSet,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<Vec<Box<Solid>>, KclError> {
    // Build the vec of transforms, one for each repetition.
    let mut transform = Vec::with_capacity(usize::try_from(total_instances).unwrap());
    if total_instances < 1 {
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: MUST_HAVE_ONE_INSTANCE.to_owned(),
        }));
    }
    for i in 1..total_instances {
        let t = make_transform::<Box<Solid>>(i, &transform_function, args.source_range, exec_state).await?;
        transform.push(t);
    }
    execute_pattern_transform(transform, solid_set, exec_state, args).await
}

/// Just like patternTransform, but works on 2D sketches not 3D solids.
/// ```no_run
/// // Each instance will be shifted along the X axis.
/// fn transform(id) {
///   return { translate: [4 * id, 0] }
/// }
///
/// // Sketch 4 circles.
/// sketch001 = startSketchOn('XZ')
///   |> circle({ center: [0, 0], radius: 2 }, %)
///   |> patternTransform2d(4, transform, %)
/// ```
#[stdlib {
    name = "patternTransform2d",
}]
async fn inner_pattern_transform_2d<'a>(
    total_instances: u32,
    transform_function: FunctionParam<'a>,
    solid_set: SketchSet,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<Vec<Box<Sketch>>, KclError> {
    // Build the vec of transforms, one for each repetition.
    let mut transform = Vec::with_capacity(usize::try_from(total_instances).unwrap());
    if total_instances < 1 {
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: MUST_HAVE_ONE_INSTANCE.to_owned(),
        }));
    }
    for i in 1..total_instances {
        let t = make_transform::<Box<Sketch>>(i, &transform_function, args.source_range, exec_state).await?;
        transform.push(t);
    }
    execute_pattern_transform(transform, solid_set, exec_state, args).await
}

async fn execute_pattern_transform<T: GeometryTrait>(
    transforms: Vec<Vec<Transform>>,
    geo_set: T::Set,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<T>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these solids.
    T::flush_batch(args, exec_state, geo_set.clone()).await?;
    let starting: Vec<T> = geo_set.into();

    if args.ctx.context_type == crate::execution::ContextType::Mock {
        return Ok(starting);
    }

    let mut output = Vec::new();
    for geo in starting {
        let new = send_pattern_transform(transforms.clone(), &geo, exec_state, args).await?;
        output.extend(new)
    }
    Ok(output)
}

async fn send_pattern_transform<T: GeometryTrait>(
    // This should be passed via reference, see
    // https://github.com/KittyCAD/modeling-app/issues/2821
    transforms: Vec<Vec<Transform>>,
    solid: &T,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<T>, KclError> {
    let id = exec_state.next_uuid();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::EntityLinearPatternTransform {
                entity_id: solid.id(),
                transform: Default::default(),
                transforms,
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityLinearPatternTransform(pattern_info),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityLinearPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let mut geometries = vec![solid.clone()];
    for id in pattern_info.entity_ids.iter().copied() {
        let mut new_solid = solid.clone();
        new_solid.set_id(id);
        geometries.push(new_solid);
    }
    Ok(geometries)
}

async fn make_transform<T: GeometryTrait>(
    i: u32,
    transform_function: &FunctionParam<'_>,
    source_range: SourceRange,
    exec_state: &mut ExecState,
) -> Result<Vec<Transform>, KclError> {
    // Call the transform fn for this repetition.
    let repetition_num = KclValue::Int {
        value: i.into(),
        meta: vec![source_range.into()],
    };
    let transform_fn_args = vec![Arg::synthetic(repetition_num)];
    let transform_fn_return = transform_function.call(exec_state, transform_fn_args).await?;

    // Unpack the returned transform object.
    let source_ranges = vec![source_range];
    let transform_fn_return = transform_fn_return.ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: "Transform function must return a value".to_string(),
            source_ranges: source_ranges.clone(),
        })
    })?;
    let transforms = match transform_fn_return {
        KclValue::Object { value, meta: _ } => vec![value],
        KclValue::Array { value, meta: _ } => {
            let transforms: Vec<_> = value
                .into_iter()
                .map(|val| {
                    val.into_object().ok_or(KclError::Semantic(KclErrorDetails {
                        message: "Transform function must return a transform object".to_string(),
                        source_ranges: source_ranges.clone(),
                    }))
                })
                .collect::<Result<_, _>>()?;
            transforms
        }
        _ => {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Transform function must return a transform object".to_string(),
                source_ranges: source_ranges.clone(),
            }))
        }
    };

    transforms
        .into_iter()
        .map(|obj| transform_from_obj_fields::<T>(obj, source_ranges.clone()))
        .collect()
}

fn transform_from_obj_fields<T: GeometryTrait>(
    transform: KclObjectFields,
    source_ranges: Vec<SourceRange>,
) -> Result<Transform, KclError> {
    // Apply defaults to the transform.
    let replicate = match transform.get("replicate") {
        Some(KclValue::Bool { value: true, .. }) => true,
        Some(KclValue::Bool { value: false, .. }) => false,
        Some(_) => {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "The 'replicate' key must be a bool".to_string(),
                source_ranges: source_ranges.clone(),
            }));
        }
        None => true,
    };

    let scale = match transform.get("scale") {
        Some(x) => T::array_to_point3d(x, source_ranges.clone())?,
        None => Point3d { x: 1.0, y: 1.0, z: 1.0 },
    };

    let translate = match transform.get("translate") {
        Some(x) => T::array_to_point3d(x, source_ranges.clone())?,
        None => Point3d { x: 0.0, y: 0.0, z: 0.0 },
    };

    let mut rotation = Rotation::default();
    if let Some(rot) = transform.get("rotation") {
        let KclValue::Object { value: rot, meta: _ } = rot else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "The 'rotation' key must be an object (with optional fields 'angle', 'axis' and 'origin')"
                    .to_string(),
                source_ranges: source_ranges.clone(),
            }));
        };
        if let Some(axis) = rot.get("axis") {
            rotation.axis = T::array_to_point3d(axis, source_ranges.clone())?.into();
        }
        if let Some(angle) = rot.get("angle") {
            match angle {
                KclValue::Number { value: number, meta: _ } => {
                    rotation.angle = Angle::from_degrees(*number);
                }
                _ => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: "The 'rotation.angle' key must be a number (of degrees)".to_string(),
                        source_ranges: source_ranges.clone(),
                    }));
                }
            }
        }
        if let Some(origin) = rot.get("origin") {
            rotation.origin = match origin {
                KclValue::String { value: s, meta: _ } if s == "local" => OriginType::Local,
                KclValue::String { value: s, meta: _ } if s == "global" => OriginType::Global,
                other => {
                    let origin = T::array_to_point3d(other, source_ranges.clone())?.into();
                    OriginType::Custom { origin }
                }
            };
        }
    }

    Ok(Transform {
        replicate,
        scale: scale.into(),
        translate: translate.into(),
        rotation,
    })
}

fn array_to_point3d(val: &KclValue, source_ranges: Vec<SourceRange>) -> Result<Point3d, KclError> {
    let KclValue::Array { value: arr, meta } = val else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected an array of 3 numbers (i.e. a 3D point)".to_string(),
            source_ranges,
        }));
    };
    let len = arr.len();
    if len != 3 {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("Expected an array of 3 numbers (i.e. a 3D point) but found {len} items"),
            source_ranges,
        }));
    };
    // Gets an f64 from a KCL value.
    let f = |k: &KclValue, component: char| {
        use super::args::FromKclValue;
        if let Some(value) = f64::from_kcl_val(k) {
            Ok(value)
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("{component} component of this point was not a number"),
                source_ranges: meta.iter().map(|m| m.source_range).collect(),
            }))
        }
    };
    let x = f(&arr[0], 'x')?;
    let y = f(&arr[1], 'y')?;
    let z = f(&arr[2], 'z')?;
    Ok(Point3d { x, y, z })
}

fn array_to_point2d(val: &KclValue, source_ranges: Vec<SourceRange>) -> Result<Point2d, KclError> {
    let KclValue::Array { value: arr, meta } = val else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected an array of 2 numbers (i.e. a 2D point)".to_string(),
            source_ranges,
        }));
    };
    let len = arr.len();
    if len != 2 {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("Expected an array of 2 numbers (i.e. a 2D point) but found {len} items"),
            source_ranges,
        }));
    };
    // Gets an f64 from a KCL value.
    let f = |k: &KclValue, component: char| {
        use super::args::FromKclValue;
        if let Some(value) = f64::from_kcl_val(k) {
            Ok(value)
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("{component} component of this point was not a number"),
                source_ranges: meta.iter().map(|m| m.source_range).collect(),
            }))
        }
    };
    let x = f(&arr[0], 'x')?;
    let y = f(&arr[1], 'y')?;
    Ok(Point2d { x, y })
}

trait GeometryTrait: Clone {
    type Set: Into<Vec<Self>> + Clone;
    fn id(&self) -> Uuid;
    fn set_id(&mut self, id: Uuid);
    fn array_to_point3d(val: &KclValue, source_ranges: Vec<SourceRange>) -> Result<Point3d, KclError>;
    async fn flush_batch(args: &Args, exec_state: &mut ExecState, set: Self::Set) -> Result<(), KclError>;
}

impl GeometryTrait for Box<Sketch> {
    type Set = SketchSet;
    fn set_id(&mut self, id: Uuid) {
        self.id = id;
    }
    fn id(&self) -> Uuid {
        self.id
    }
    fn array_to_point3d(val: &KclValue, source_ranges: Vec<SourceRange>) -> Result<Point3d, KclError> {
        let Point2d { x, y } = array_to_point2d(val, source_ranges)?;
        Ok(Point3d { x, y, z: 0.0 })
    }

    async fn flush_batch(_: &Args, _: &mut ExecState, _: Self::Set) -> Result<(), KclError> {
        Ok(())
    }
}

impl GeometryTrait for Box<Solid> {
    type Set = SolidSet;
    fn set_id(&mut self, id: Uuid) {
        self.id = id;
    }

    fn id(&self) -> Uuid {
        self.id
    }
    fn array_to_point3d(val: &KclValue, source_ranges: Vec<SourceRange>) -> Result<Point3d, KclError> {
        array_to_point3d(val, source_ranges)
    }

    async fn flush_batch(args: &Args, exec_state: &mut ExecState, solid_set: Self::Set) -> Result<(), KclError> {
        args.flush_batch_for_solid_set(exec_state, solid_set.into()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_array_to_point3d() {
        let input = KclValue::Array {
            value: vec![
                KclValue::Number {
                    value: 1.1,
                    meta: Default::default(),
                },
                KclValue::Number {
                    value: 2.2,
                    meta: Default::default(),
                },
                KclValue::Number {
                    value: 3.3,
                    meta: Default::default(),
                },
            ],
            meta: Default::default(),
        };
        let expected = Point3d { x: 1.1, y: 2.2, z: 3.3 };
        let actual = array_to_point3d(&input, Vec::new());
        assert_eq!(actual.unwrap(), expected);
    }
}

/// A linear pattern on a 2D sketch.
pub async fn pattern_linear_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_set): (LinearPattern2dData, SketchSet) = args.get_data_and_sketch_set()?;

    if data.axis == [0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let sketches = inner_pattern_linear_2d(data, sketch_set, exec_state, args).await?;
    Ok(sketches.into())
}

/// Repeat a 2-dimensional sketch along some dimension, with a dynamic amount
/// of distance between each repetition, some specified number of times.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> circle({ center = [0, 0], radius = 1 }, %)
///   |> patternLinear2d({
///        axis = [1, 0],
///        instances = 7,
///        distance = 4
///      }, %)
///
/// example = extrude(exampleSketch, length = 1)
/// ```
#[stdlib {
    name = "patternLinear2d",
}]
async fn inner_pattern_linear_2d(
    data: LinearPattern2dData,
    sketch_set: SketchSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Sketch>>, KclError> {
    let axis = data.axis;
    let [x, y] = axis;
    let axis_len = f64::sqrt(x * x + y * y);
    let normalized_axis = kcmc::shared::Point2d::from([x / axis_len, y / axis_len]);
    let transforms: Vec<_> = (1..data.instances)
        .map(|i| {
            let d = data.distance * (i as f64);
            let translate = (normalized_axis * d).with_z(0.0).map(LengthUnit);
            vec![Transform {
                translate,
                ..Default::default()
            }]
        })
        .collect();
    execute_pattern_transform(transforms, sketch_set, exec_state, &args).await
}

/// A linear pattern on a 3D model.
pub async fn pattern_linear_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid_set): (LinearPattern3dData, SolidSet) = args.get_data_and_solid_set()?;

    if data.axis == [0.0, 0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids = inner_pattern_linear_3d(data, solid_set, exec_state, args).await?;
    Ok(solids.into())
}

/// Repeat a 3-dimensional solid along a linear path, with a dynamic amount
/// of distance between each repetition, some specified number of times.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 2])
///   |> line(end = [3, 1])
///   |> line(end = [0, -4])
///   |> close()
///
/// example = extrude(exampleSketch, length = 1)
///   |> patternLinear3d({
///       axis = [1, 0, 1],
///       instances = 7,
///       distance = 6
///     }, %)
/// ```
#[stdlib {
    name = "patternLinear3d",
    feature_tree_operation = true,
}]
async fn inner_pattern_linear_3d(
    data: LinearPattern3dData,
    solid_set: SolidSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Solid>>, KclError> {
    let axis = data.axis;
    let [x, y, z] = axis;
    let axis_len = f64::sqrt(x * x + y * y + z * z);
    let normalized_axis = kcmc::shared::Point3d::from([x / axis_len, y / axis_len, z / axis_len]);
    let transforms: Vec<_> = (1..data.instances)
        .map(|i| {
            let d = data.distance * (i as f64);
            let translate = (normalized_axis * d).map(LengthUnit);
            vec![Transform {
                translate,
                ..Default::default()
            }]
        })
        .collect();
    execute_pattern_transform(transforms, solid_set, exec_state, &args).await
}

/// Data for a circular pattern on a 2D sketch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CircularPattern2dData {
    /// The number of total instances. Must be greater than or equal to 1.
    /// This includes the original entity. For example, if instances is 2,
    /// there will be two copies -- the original, and one new copy.
    /// If instances is 1, this has no effect.
    pub instances: u32,
    /// The center about which to make the pattern. This is a 2D vector.
    pub center: [f64; 2],
    /// The arc angle (in degrees) to place the repetitions. Must be greater than 0.
    pub arc_degrees: f64,
    /// Whether or not to rotate the duplicates as they are copied.
    pub rotate_duplicates: bool,
}

/// Data for a circular pattern on a 3D model.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CircularPattern3dData {
    /// The number of total instances. Must be greater than or equal to 1.
    /// This includes the original entity. For example, if instances is 2,
    /// there will be two copies -- the original, and one new copy.
    /// If instances is 1, this has no effect.
    pub instances: u32,
    /// The axis around which to make the pattern. This is a 3D vector.
    pub axis: [f64; 3],
    /// The center about which to make the pattern. This is a 3D vector.
    pub center: [f64; 3],
    /// The arc angle (in degrees) to place the repetitions. Must be greater than 0.
    pub arc_degrees: f64,
    /// Whether or not to rotate the duplicates as they are copied.
    pub rotate_duplicates: bool,
}

pub enum CircularPattern {
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
            CircularPattern::ThreeD(lp) => lp.axis,
        }
    }

    pub fn center(&self) -> [f64; 3] {
        match self {
            CircularPattern::TwoD(lp) => [lp.center[0], lp.center[1], 0.0],
            CircularPattern::ThreeD(lp) => lp.center,
        }
    }

    fn repetitions(&self) -> RepetitionsNeeded {
        let n = match self {
            CircularPattern::TwoD(lp) => lp.instances,
            CircularPattern::ThreeD(lp) => lp.instances,
        };
        RepetitionsNeeded::from(n)
    }

    pub fn arc_degrees(&self) -> f64 {
        match self {
            CircularPattern::TwoD(lp) => lp.arc_degrees,
            CircularPattern::ThreeD(lp) => lp.arc_degrees,
        }
    }

    pub fn rotate_duplicates(&self) -> bool {
        match self {
            CircularPattern::TwoD(lp) => lp.rotate_duplicates,
            CircularPattern::ThreeD(lp) => lp.rotate_duplicates,
        }
    }
}

/// A circular pattern on a 2D sketch.
pub async fn pattern_circular_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_set): (CircularPattern2dData, SketchSet) = args.get_data_and_sketch_set()?;

    let sketches = inner_pattern_circular_2d(data, sketch_set, exec_state, args).await?;
    Ok(sketches.into())
}

/// Repeat a 2-dimensional sketch some number of times along a partial or
/// complete circle some specified number of times. Each object may
/// additionally be rotated along the circle, ensuring orentation of the
/// solid with respect to the center of the circle is maintained.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([.5, 25], %)
///   |> line(end = [0, 5])
///   |> line(end = [-1, 0])
///   |> line(end = [0, -5])
///   |> close()
///   |> patternCircular2d({
///        center = [0, 0],
///        instances = 13,
///        arcDegrees = 360,
///        rotateDuplicates = true
///      }, %)
///
/// example = extrude(exampleSketch, length = 1)
/// ```
#[stdlib {
    name = "patternCircular2d",
}]
async fn inner_pattern_circular_2d(
    data: CircularPattern2dData,
    sketch_set: SketchSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Sketch>>, KclError> {
    let starting_sketches: Vec<Box<Sketch>> = sketch_set.into();

    if args.ctx.context_type == crate::execution::ContextType::Mock {
        return Ok(starting_sketches);
    }

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
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of sketches".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        sketches.extend(new_sketches);
    }

    Ok(sketches)
}

/// A circular pattern on a 3D model.
pub async fn pattern_circular_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid_set): (CircularPattern3dData, SolidSet) = args.get_data_and_solid_set()?;

    let solids = inner_pattern_circular_3d(data, solid_set, exec_state, args).await?;
    Ok(solids.into())
}

/// Repeat a 3-dimensional solid some number of times along a partial or
/// complete circle some specified number of times. Each object may
/// additionally be rotated along the circle, ensuring orentation of the
/// solid with respect to the center of the circle is maintained.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> circle({ center = [0, 0], radius = 1 }, %)
///
/// example = extrude(exampleSketch, length = -5)
///   |> patternCircular3d({
///        axis = [1, -1, 0],
///        center = [10, -20, 0],
///        instances = 11,
///        arcDegrees = 360,
///        rotateDuplicates = true
///      }, %)
/// ```
#[stdlib {
    name = "patternCircular3d",
    feature_tree_operation = true,
}]
async fn inner_pattern_circular_3d(
    data: CircularPattern3dData,
    solid_set: SolidSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Solid>>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these solids.
    args.flush_batch_for_solid_set(exec_state, solid_set.clone().into())
        .await?;

    let starting_solids: Vec<Box<Solid>> = solid_set.into();

    if args.ctx.context_type == crate::execution::ContextType::Mock {
        return Ok(starting_solids);
    }

    let mut solids = Vec::new();
    for solid in starting_solids.iter() {
        let geometries = pattern_circular(
            CircularPattern::ThreeD(data.clone()),
            Geometry::Solid(solid.clone()),
            exec_state,
            args.clone(),
        )
        .await?;

        let Geometries::Solids(new_solids) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of solids".to_string(),
                source_ranges: vec![args.source_range],
            }));
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
    let id = exec_state.next_uuid();
    let num_repetitions = match data.repetitions() {
        RepetitionsNeeded::More(n) => n,
        RepetitionsNeeded::None => {
            return Ok(Geometries::from(geometry));
        }
        RepetitionsNeeded::Invalid => {
            return Err(KclError::Semantic(KclErrorDetails {
                source_ranges: vec![args.source_range],
                message: MUST_HAVE_ONE_INSTANCE.to_owned(),
            }));
        }
    };

    let center = data.center();
    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::EntityCircularPattern {
                axis: kcmc::shared::Point3d::from(data.axis()),
                entity_id: geometry.id(),
                center: kcmc::shared::Point3d {
                    x: LengthUnit(center[0]),
                    y: LengthUnit(center[1]),
                    z: LengthUnit(center[2]),
                },
                num_repetitions,
                arc_degrees: data.arc_degrees(),
                rotate_duplicates: data.rotate_duplicates(),
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityCircularPattern(pattern_info),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityCircularPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::Sketch(sketch) => {
            let mut geometries = vec![sketch.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch = sketch.clone();
                new_sketch.id = *id;
                geometries.push(new_sketch);
            }
            Geometries::Sketches(geometries)
        }
        Geometry::Solid(solid) => {
            let mut geometries = vec![solid.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_solid = solid.clone();
                new_solid.id = *id;
                geometries.push(new_solid);
            }
            Geometries::Solids(geometries)
        }
    };

    Ok(geometries)
}
