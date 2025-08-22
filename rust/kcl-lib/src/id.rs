/// An auto-incrementing integer ID generator.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IncIdGenerator<T> {
    next_id: T,
}

impl<T> IncIdGenerator<T>
where
    T: Copy + std::ops::AddAssign + From<u8> + Default,
{
    pub fn new() -> Self {
        Self { next_id: T::default() }
    }

    pub fn next_id(&mut self) -> T {
        let next_id = self.next_id;

        self.next_id += T::from(1_u8);

        next_id
    }
}
