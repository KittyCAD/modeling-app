use kittycad_modeling_cmds::shared::{Point2d, Point3d};
use uuid::Uuid;

/// A sketch group is a collection of paths.
pub struct SketchGroup {
    /// The id of the sketch group.
    pub id: Uuid,
    /// The base path.
    pub path_first: BasePath,
    /// Paths after the first path, if any.
    pub path_rest: Vec<Path>,
    /// What the sketch is on (can be a plane or a face).
    pub on: SketchSurface,
    /// The position of the sketch group.
    pub position: Position,
    /// The rotation of the sketch group base plane.
    pub rotation: Rotation,
    /// The X, Y and Z axes of this sketch's base plane, in 3D space.
    pub axes: Axes,
    /// The plane id or face id of the sketch group.
    pub entity_id: Option<Uuid>,
}

/// The X, Y and Z axes.
pub struct Axes {
    pub x: Point3d,
    pub y: Point3d,
    pub z: Point3d,
}

pub struct BasePath {
    pub from: Point2d<f64>,
    pub to: Point2d<f64>,
    pub name: String,
}

/// A path.
pub enum Path {
    /// A path that goes to a point.
    ToPoint { base: BasePath },
    /// A arc that is tangential to the last path segment that goes to a point
    TangentialArcTo {
        base: BasePath,
        /// the arc's center
        center: [f64; 2],
        /// arc's direction
        ccw: bool,
    },
    /// A path that is horizontal.
    Horizontal {
        base: BasePath,
        /// The x coordinate.
        x: f64,
    },
    /// An angled line to.
    AngledLineTo {
        base: BasePath,
        /// The x coordinate.
        x: Option<f64>,
        /// The y coordinate.
        y: Option<f64>,
    },
    /// A base path.
    Base { base: BasePath },
}

pub enum SketchSurface {
    Plane(Plane),
}

/// A plane.
pub struct Plane {
    /// The id of the plane.
    pub id: Uuid,
    // The code for the plane either a string or custom.
    pub value: PlaneType,
    /// Origin of the plane.
    pub origin: Point3d,
    pub axes: Axes,
}

/// Type for a plane.
pub enum PlaneType {
    XY,
    XZ,
    YZ,
    Custom,
}

pub struct Rotation(pub [f64; 4]);
pub struct Position(pub [f64; 3]);
