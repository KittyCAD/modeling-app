use super::{Point2d, Point3d, Point4d};

macro_rules! impl_convert {
    ($typ:ident, $n:literal, $($i:ident),*) => {
        impl<T> From<[T; $n]> for $typ<T> {
            fn from([$($i, )*]: [T; $n]) -> Self {
                Self { $($i, )* }
            }
        }

        impl<T> From<$typ<T>> for [T; $n]{
            fn from($typ{$($i, )*}: $typ<T>) -> Self {
                [ $($i, )* ]
            }
        }
    };
}

impl_convert!(Point2d, 2, x, y);
impl_convert!(Point3d, 3, x, y, z);
impl_convert!(Point4d, 4, x, y, z, w);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn array_to_point() {
        assert_eq!(Point2d { x: 1, y: 2 }, Point2d::from([1, 2]));
    }

    #[test]
    fn point_to_array() {
        let lhs: [u32; 2] = Point2d { x: 1, y: 2 }.into();
        let rhs = [1u32, 2];
        assert_eq!(lhs, rhs);
    }
}
