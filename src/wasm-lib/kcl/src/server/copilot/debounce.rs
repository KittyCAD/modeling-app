//! Debounce a function call.

use std::{
    sync::{RwLock},
};



#[derive(Debug)]
pub struct Runner {
    inc: CanIncrement,
    id: RwLock<i32>,
    delay: tokio::time::Duration,
}

impl Runner {
    pub fn new(delay: tokio::time::Duration) -> Self {
        Self {
            id: RwLock::new(0),
            inc: CanIncrement::new(),
            delay,
        }
    }
    fn set_id(&self, new_id: i32) -> i32 {
        let mut lock = self.id.write().unwrap();
        *lock = new_id;
        *lock
    }

    pub async fn increment_and_do_stuff(&self) -> bool {
        let id = self.inc.increment();
        self.foo(id).await
    }

    async fn foo(&self, id: i32) -> bool {
        tokio::time::sleep(self.delay).await;
        let current_id = self.inc.read();
        id == current_id
    }
}

#[derive(Debug)]
struct CanIncrement {
    mutex: RwLock<i32>,
}

impl CanIncrement {
    fn new() -> Self {
        Self { mutex: RwLock::new(0) }
    }
    // This function is not marked async.
    fn increment(&self) -> i32 {
        let mut lock = self.mutex.write().unwrap();
        *lock += 1;
        *lock
    }
    fn read(&self) -> i32 {
        let lock = self.mutex.read().unwrap();
        *lock
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use tokio::time::{self};

    use super::*;

    #[tokio::test]
    async fn test_increment_and_do_stuff() {
        let can_inc = CanIncrement::new();
        let runner = Runner {
            id: std::sync::RwLock::new(0),
            inc: can_inc,
            delay: time::Duration::from_millis(100),
        };
        let a = runner.increment_and_do_stuff();
        let b = runner.increment_and_do_stuff();
        let res = tokio::join!(a, b);

        assert_eq!(res, (true, true));
    }
}
