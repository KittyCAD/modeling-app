//! Debounce a function call.

use std::sync::{PoisonError, RwLock};

use anyhow::Result;

#[derive(Debug)]
pub struct Runner {
    inc: CanIncrement,
    delay: tokio::time::Duration,
}

impl Runner {
    pub fn new(delay: tokio::time::Duration) -> Self {
        Self {
            inc: CanIncrement::new(),
            delay,
        }
    }

    pub async fn increment_and_do_stuff(&self) -> Result<bool, PoisonError<std::sync::RwLockReadGuard<'static, i32>>> {
        let inc = self.inc.increment().unwrap_or_else(|e| *e.into_inner());
        self.foo(inc).await
    }

    async fn foo(&self, inc: i32) -> Result<bool, PoisonError<std::sync::RwLockReadGuard<'static, i32>>> {
        tokio::time::sleep(self.delay).await;
        let current_inc = self.inc.read().unwrap_or_else(|e| *e.into_inner());
        Ok(inc == current_inc)
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
    fn increment(&self) -> Result<i32, PoisonError<std::sync::RwLockReadGuard<'static, i32>>> {
        let mut lock = self.mutex.write().unwrap_or_else(|e| e.into_inner());
        *lock += 1;
        Ok(*lock)
    }
    fn read(&self) -> Result<i32, PoisonError<std::sync::RwLockReadGuard<'static, i32>>> {
        let lock = self.mutex.read().unwrap_or_else(|e| e.into_inner());
        Ok(*lock)
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use tokio::time::{self};

    use super::*;

    #[tokio::test]
    async fn test_debounce_increment_and_do_stuff() {
        let can_inc = CanIncrement::new();
        let runner = Runner {
            inc: can_inc,
            delay: time::Duration::from_millis(100),
        };
        let a = runner.increment_and_do_stuff();
        let b = runner.increment_and_do_stuff();
        let (a, b) = tokio::join!(a, b);

        assert_eq!(a.unwrap(), false);
        assert_eq!(b.unwrap(), true);
    }
}
