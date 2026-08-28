use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

mod convert;
mod only;
mod uniform;
mod zero;

/// A point in 2D space
#[repr(C)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename = "Point2d")]
#[serde(rename_all = "snake_case")]
#[derive(ts_rs::TS)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[ts(export_to = "ModelingCmd.ts")]
pub struct Point2d<T = f32> {
    #[allow(missing_docs)]
    pub x: T,
    #[allow(missing_docs)]
    pub y: T,
}

impl std::fmt::Display for Point2d<f64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

impl<T: PartialEq> PartialEq for Point2d<T> {
    fn eq(&self, other: &Self) -> bool {
        self.x == other.x && self.y == other.y
    }
}

impl<T> Point2d<T> {
    /// Add the given `z` component to a 2D point to produce a 3D point.
    pub fn with_z(self, z: T) -> Point3d<T> {
        let Self { x, y } = self;
        Point3d { x, y, z }
    }

    /// Takes some closure, and calls it on each component of this point.
    /// # Examples
    /// ```
    /// use kcl_api::point::Point2d;
    /// let p0 = Point2d { x: 1.0, y: 1.0 };
    /// assert_eq!(p0.map(|n| n * 2.0), Point2d { x: 2.0, y: 2.0 });
    /// ```
    pub fn map<U, F>(self, mut f: F) -> Point2d<U>
    where
        F: FnMut(T) -> U,
    {
        let Self { x, y } = self;
        Point2d { x: f(x), y: f(y) }
    }
}

/// A point in 3D space
#[repr(C)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Default, ts_rs::TS)]
#[serde(rename = "Point3d")]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[ts(export_to = "ModelingCmd.ts")]
pub struct Point3d<T = f32> {
    #[allow(missing_docs)]
    pub x: T,
    #[allow(missing_docs)]
    pub y: T,
    #[allow(missing_docs)]
    pub z: T,
}

impl std::fmt::Display for Point3d<f64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "({}, {}, {})", self.x, self.y, self.z)
    }
}

impl From<euler::Vec3> for Point3d<f32> {
    fn from(v: euler::Vec3) -> Self {
        Self { x: v.x, y: v.y, z: v.z }
    }
}

impl<T> Point3d<T> {
    /// Add the given `z` component to a 2D point to produce a 3D point.
    pub fn from_2d(Point2d { x, y }: Point2d<T>, z: T) -> Self {
        Self { x, y, z }
    }

    /// Add the given `w` component to a 3D point to produce a 4D point.
    pub fn with_w(self, w: T) -> Point4d<T> {
        let Self { x, y, z } = self;
        Point4d { x, y, z, w }
    }

    /// Takes some closure, and calls it on each component of this point.
    /// # Examples
    /// ```
    /// use kcl_api::point::Point3d;
    /// let p0 = Point3d {
    ///     x: 1.0,
    ///     y: 1.0,
    ///     z: 1.0,
    /// };
    /// assert_eq!(
    ///     p0.map(|n| n * 2.0),
    ///     Point3d {
    ///         x: 2.0,
    ///         y: 2.0,
    ///         z: 2.0
    ///     }
    /// );
    /// ```
    pub fn map<U, F>(self, mut f: F) -> Point3d<U>
    where
        F: FnMut(T) -> U,
    {
        let Self { x, y, z } = self;
        Point3d {
            x: f(x),
            y: f(y),
            z: f(z),
        }
    }
}

/// A point in homogeneous (4D) space
#[repr(C)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename = "Point4d")]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[cfg_attr(feature = "ts-rs", ts(export_to = "ModelingCmd.ts"))]
pub struct Point4d<T = f32> {
    #[allow(missing_docs)]
    pub x: T,
    #[allow(missing_docs)]
    pub y: T,
    #[allow(missing_docs)]
    pub z: T,
    #[allow(missing_docs)]
    pub w: T,
}

impl std::fmt::Display for Point4d<f64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "({}, {}, {}, {})", self.x, self.y, self.z, self.w)
    }
}
impl<T> Point4d<T> {
    /// Takes some closure, and calls it on each component of this point.
    /// # Examples
    /// ```
    /// use kcl_api::point::Point4d;
    /// let p0 = Point4d {
    ///     x: 1.0,
    ///     y: 1.0,
    ///     z: 1.0,
    ///     w: 1.0,
    /// };
    /// assert_eq!(
    ///     p0.map(|n| n * 2.0),
    ///     Point4d {
    ///         x: 2.0,
    ///         y: 2.0,
    ///         z: 2.0,
    ///         w: 2.0
    ///     }
    /// );
    /// ```
    pub fn map<U, F>(self, mut f: F) -> Point4d<U>
    where
        F: FnMut(T) -> U,
    {
        let Self { x, y, z, w } = self;
        Point4d {
            x: f(x),
            y: f(y),
            z: f(z),
            w: f(w),
        }
    }
}
impl<T> Point4d<T>
where
    T: Copy,
{
    /// Make a point where the X, Y and Z components have the same value,
    /// but the W component has a different one.
    pub const fn uniform_3d(xyz: T, w: T) -> Self {
        Self {
            x: xyz,
            y: xyz,
            z: xyz,
            w,
        }
    }
}

///A quaternion
pub type Quaternion = Point4d;

impl Default for Quaternion {
    /// (0, 0, 0, 1)
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            w: 1.0,
        }
    }
}

impl<T: PartialEq> PartialEq for Point4d<T> {
    fn eq(&self, other: &Self) -> bool {
        self.x == other.x && self.y == other.y && self.z == other.z && self.w == other.w
    }
}

macro_rules! impl_arithmetic {
    ($typ:ident, $op:ident, $op_assign:ident, $method:ident, $method_assign:ident, $($i:ident),*) => {
        /// Arithmetic between two points happens component-wise, e.g. p + q == (p.x + q.x, p.y + q.y)
        impl<T> std::ops::$op<$typ<T>> for $typ<T>
        where
            T: std::ops::$op<Output = T>,
        {
            type Output = $typ<T>;

            fn $method(self, rhs: $typ<T>) -> Self::Output {
                Self {
                    $(
                        $i: self.$i.$method(rhs.$i),
                    )*
                }
            }
        }
        /// Arithmetic between two points happens component-wise, e.g. p + q == (p.x + q.x, p.y + q.y)
        impl<T> std::ops::$op_assign for $typ<T>
        where
            T: std::ops::$op_assign<T>,
        {

            fn $method_assign(&mut self, other: Self) {
                $(
                    self.$i.$method_assign(other.$i);
                )*
            }
        }
    };
}

macro_rules! impl_scalar_arithmetic {
    ($typ:ident, $op:ident, $op_assign:ident, $method:ident, $method_assign:ident, $($i:ident),*) => {
        /// Applies an arithmetic operation to each component, e.g. p * 3 = (p.x * 3, p.y * 3)
        impl<T> std::ops::$op<T> for $typ<T>
        where
            T: std::ops::$op<Output = T> + Copy,
        {
            type Output = $typ<T>;

            fn $method(self, rhs: T) -> Self::Output {
                Self {
                    $(
                        $i: self.$i.$method(rhs),
                    )*
                }
            }
        }
        /// Applies an arithmetic operation to each component, e.g. p * 3 = (p.x * 3, p.y * 3)
        impl<T> std::ops::$op_assign<T> for $typ<T>
        where
            T: std::ops::$op_assign<T> + Copy,
        {

            fn $method_assign(&mut self, other: T) {
                $(
                    self.$i.$method_assign(other);
                )*
            }
        }
    };
}

impl_arithmetic!(Point2d, Add, AddAssign, add, add_assign, x, y);
impl_arithmetic!(Point3d, Add, AddAssign, add, add_assign, x, y, z);
impl_arithmetic!(Point2d, Sub, SubAssign, sub, sub_assign, x, y);
impl_arithmetic!(Point3d, Sub, SubAssign, sub, sub_assign, x, y, z);
impl_arithmetic!(Point2d, Mul, MulAssign, mul, mul_assign, x, y);
impl_arithmetic!(Point3d, Mul, MulAssign, mul, mul_assign, x, y, z);
impl_arithmetic!(Point2d, Div, DivAssign, div, div_assign, x, y);
impl_arithmetic!(Point3d, Div, DivAssign, div, div_assign, x, y, z);
impl_scalar_arithmetic!(Point2d, Mul, MulAssign, mul, mul_assign, x, y);
impl_scalar_arithmetic!(Point3d, Mul, MulAssign, mul, mul_assign, x, y, z);
impl_scalar_arithmetic!(Point2d, Div, DivAssign, div, div_assign, x, y);
impl_scalar_arithmetic!(Point3d, Div, DivAssign, div, div_assign, x, y, z);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_math() {
        let actual = Point2d { x: 1.0, y: 2.0 } + Point2d { x: 10.0, y: 20.0 };
        let expected = Point2d { x: 11.0, y: 22.0 };
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_math_assign() {
        let mut p = Point2d { x: 1.0, y: 2.0 };
        p += Point2d { x: 10.0, y: 20.0 };
        let expected = Point2d { x: 11.0, y: 22.0 };
        assert_eq!(p, expected);
    }

    #[test]
    fn test_scaling() {
        let actual = Point2d { x: 1.0, y: 2.0 } * 3.0;
        let expected = Point2d { x: 3.0, y: 6.0 };
        assert_eq!(actual, expected);
    }
    #[test]
    fn test_scaling_assign() {
        let mut actual = Point2d { x: 1.0, y: 2.0 };
        actual *= 3.0;
        let expected = Point2d { x: 3.0, y: 6.0 };
        assert_eq!(actual, expected);
    }
}
