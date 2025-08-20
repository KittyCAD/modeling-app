pub type Id = u32;

#[derive(Default)]
pub struct IdGenerator {
    next: Id,
}

impl IdGenerator {
    pub fn next_id(&mut self) -> Id {
        let out = self.next;
        self.next += 1;
        out
    }
}
