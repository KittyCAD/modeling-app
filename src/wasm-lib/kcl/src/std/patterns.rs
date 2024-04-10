//! Standard library patterns.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, Geometries, Geometry, MemoryItem, SketchGroup},
    std::Args,
};

/// Data for a linear pattern on a 2D sketch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinearPattern2dData {
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: u32,
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
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: u32,
    /// The distance between each repetition. This can also be referred to as spacing.
    pub distance: f64,
    /// The axis of the pattern.
    pub axis: [f64; 3],
}

pub enum LinearPattern {
    ThreeD(LinearPattern3dData),
    TwoD(LinearPattern2dData),
}

impl LinearPattern {
    pub fn axis(&self) -> [f64; 3] {
        match self {
            LinearPattern::TwoD(lp) => [lp.axis[0], lp.axis[1], 0.0],
            LinearPattern::ThreeD(lp) => lp.axis,
        }
    }

    pub fn repetitions(&self) -> u32 {
        match self {
            LinearPattern::TwoD(lp) => lp.repetitions,
            LinearPattern::ThreeD(lp) => lp.repetitions,
        }
    }

    pub fn distance(&self) -> f64 {
        match self {
            LinearPattern::TwoD(lp) => lp.distance,
            LinearPattern::ThreeD(lp) => lp.distance,
        }
    }
}

/// A linear pattern on a 2D sketch.
pub async fn pattern_linear_2d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (LinearPattern2dData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    if data.axis == [0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let sketch_groups = inner_pattern_linear_2d(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroups { value: sketch_groups })
}

/// A linear pattern on a 2D sketch.
///
/// ```no_run
/// const part =  startSketchOn('XY')
///     |> circle([0,0], 2, %)
///     |> patternLinear2d({axis: [0,1], repetitions: 12, distance: 2}, %)
/// ```
#[stdlib {
    name = "patternLinear2d",
}]
async fn inner_pattern_linear_2d(
    data: LinearPattern2dData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Vec<Box<SketchGroup>>, KclError> {
    let geometries = pattern_linear(
        LinearPattern::TwoD(data),
        Geometry::SketchGroup(sketch_group),
        args.clone(),
    )
    .await?;

    let Geometries::SketchGroups(sketch_groups) = geometries else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected a vec of sketch groups".to_string(),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(sketch_groups)
}

/// A linear pattern on a 3D model.
pub async fn pattern_linear_3d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group): (LinearPattern3dData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    if data.axis == [0.0, 0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let extrude_groups = inner_pattern_linear_3d(data, extrude_group, args).await?;
    Ok(MemoryItem::ExtrudeGroups { value: extrude_groups })
}

/// A linear pattern on a 3D model.
///
/// ```no_run
/// const part = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0,1], %)
///     |> line([1, 0], %)
///     |> line([0, -1], %)
///     |> close(%)
///     |> extrude(1, %)
///     |> patternLinear3d({axis: [1, 0, 1], repetitions: 3, distance: 6}, %)       
/// ```
#[stdlib {
    name = "patternLinear3d",
}]
async fn inner_pattern_linear_3d(
    data: LinearPattern3dData,
    extrude_group: Box<ExtrudeGroup>,
    args: Args,
) -> Result<Vec<Box<ExtrudeGroup>>, KclError> {
    let geometries = pattern_linear(
        LinearPattern::ThreeD(data),
        Geometry::ExtrudeGroup(extrude_group),
        args.clone(),
    )
    .await?;

    let Geometries::ExtrudeGroups(extrude_groups) = geometries else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected a vec of extrude groups".to_string(),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(extrude_groups)
}

async fn pattern_linear(data: LinearPattern, geometry: Geometry, args: Args) -> Result<Geometries, KclError> {
    let id = uuid::Uuid::new_v4();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::EntityLinearPattern {
                axis: kittycad::types::Point3D {
                    x: data.axis()[0],
                    y: data.axis()[1],
                    z: data.axis()[2],
                },
                entity_id: geometry.id(),
                num_repetitions: data.repetitions(),
                spacing: data.distance(),
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::EntityLinearPattern { data: pattern_info },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityLinearPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::SketchGroup(sketch_group) => {
            let mut geometries = vec![sketch_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch_group = sketch_group.clone();
                new_sketch_group.id = *id;
                geometries.push(new_sketch_group);
            }
            Geometries::SketchGroups(geometries)
        }
        Geometry::ExtrudeGroup(extrude_group) => {
            let mut geometries = vec![extrude_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_extrude_group = extrude_group.clone();
                new_extrude_group.id = *id;
                geometries.push(new_extrude_group);
            }
            Geometries::ExtrudeGroups(geometries)
        }
    };

    Ok(geometries)
}

/// Data for a circular pattern on a 2D sketch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CircularPattern2dData {
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: u32,
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
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: u32,
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

    pub fn repetitions(&self) -> u32 {
        match self {
            CircularPattern::TwoD(lp) => lp.repetitions,
            CircularPattern::ThreeD(lp) => lp.repetitions,
        }
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
pub async fn pattern_circular_2d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (CircularPattern2dData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let sketch_groups = inner_pattern_circular_2d(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroups { value: sketch_groups })
}

/// A circular pattern on a 2D sketch.
///
/// ```no_run
/// const part = startSketchOn('XY')
///     |> circle([0,0], 2, %)
///     |> patternCircular2d({center: [20, 20], repetitions: 12, arcDegrees: 210, rotateDuplicates: true}, %)
/// ```
#[stdlib {
    name = "patternCircular2d",
}]
async fn inner_pattern_circular_2d(
    data: CircularPattern2dData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Vec<Box<SketchGroup>>, KclError> {
    let geometries = pattern_circular(
        CircularPattern::TwoD(data),
        Geometry::SketchGroup(sketch_group),
        args.clone(),
    )
    .await?;

    let Geometries::SketchGroups(sketch_groups) = geometries else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected a vec of sketch groups".to_string(),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(sketch_groups)
}

/// A circular pattern on a 3D model.
pub async fn pattern_circular_3d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group): (CircularPattern3dData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let extrude_groups = inner_pattern_circular_3d(data, extrude_group, args).await?;
    Ok(MemoryItem::ExtrudeGroups { value: extrude_groups })
}

/// A circular pattern on a 3D model.
///
/// ```no_run
/// const part = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0,1], %)
///     |> line([1, 0], %)
///     |> line([0, -1], %)
///     |> close(%)
///     |> extrude(1, %)
///     |> patternCircular3d({axis: [1,1,0], center: [10, 0, 10], repetitions: 10, arcDegrees: 360, rotateDuplicates: true}, %)
/// ```
#[stdlib {
    name = "patternCircular3d",
}]
async fn inner_pattern_circular_3d(
    data: CircularPattern3dData,
    extrude_group: Box<ExtrudeGroup>,
    args: Args,
) -> Result<Vec<Box<ExtrudeGroup>>, KclError> {
    let geometries = pattern_circular(
        CircularPattern::ThreeD(data),
        Geometry::ExtrudeGroup(extrude_group),
        args.clone(),
    )
    .await?;

    let Geometries::ExtrudeGroups(extrude_groups) = geometries else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected a vec of extrude groups".to_string(),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(extrude_groups)
}

async fn pattern_circular(data: CircularPattern, geometry: Geometry, args: Args) -> Result<Geometries, KclError> {
    let id = uuid::Uuid::new_v4();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::EntityCircularPattern {
                axis: kittycad::types::Point3D {
                    x: data.axis()[0],
                    y: data.axis()[1],
                    z: data.axis()[2],
                },
                entity_id: geometry.id(),
                center: data.center().into(),
                num_repetitions: data.repetitions(),
                arc_degrees: data.arc_degrees(),
                rotate_duplicates: data.rotate_duplicates(),
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::EntityCircularPattern { data: pattern_info },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityCircularPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::SketchGroup(sketch_group) => {
            let mut geometries = vec![sketch_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch_group = sketch_group.clone();
                new_sketch_group.id = *id;
                geometries.push(new_sketch_group);
            }
            Geometries::SketchGroups(geometries)
        }
        Geometry::ExtrudeGroup(extrude_group) => {
            let mut geometries = vec![extrude_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_extrude_group = extrude_group.clone();
                new_extrude_group.id = *id;
                geometries.push(new_extrude_group);
            }
            Geometries::ExtrudeGroups(geometries)
        }
    };

    Ok(geometries)
}
