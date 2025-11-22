use serde::Serialize;

/// An auto-incrementing integer ID generator.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IncIdGenerator<T> {
    next_id: T,
}

impl<T> Default for IncIdGenerator<T>
where
    T: Default,
{
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T> IncIdGenerator<T> {
    pub fn new(next_id: T) -> Self {
        Self { next_id }
    }
}

impl<T> IncIdGenerator<T>
where
    T: Copy + std::ops::AddAssign + From<bool>,
{
    /// Get the next ID and increment the internal counter.
    pub fn next_id(&mut self) -> T {
        let next_id = self.next_id;

        // All built-in numeric types convert true to 1.
        self.next_id += T::from(true);

        next_id
    }

    /// Get the next ID without incrementing.
    pub fn peek_id(&self) -> T {
        self.next_id
    }
}
