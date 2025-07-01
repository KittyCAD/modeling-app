//! This module contains the wasm-specific `AsyncTasks` struct, which is used to manage a set of asynchronous
//! tasks.

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use tokio::sync::{Notify, mpsc};

use crate::errors::KclError;

#[derive(Debug, Clone)]
pub struct AsyncTasks {
    // Results arrive here      (unbounded = never blocks the producer)
    tx: mpsc::UnboundedSender<Result<(), KclError>>,
    rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<Result<(), KclError>>>>,

    // How many tasks we started since last clear()
    spawned: Arc<AtomicUsize>,

    // Used to wake `join_all()` as soon as a task finishes.
    notifier: Arc<Notify>,
}

// Safety: single-threaded wasm ⇒ these are sound.
unsafe impl Send for AsyncTasks {}
unsafe impl Sync for AsyncTasks {}

impl Default for AsyncTasks {
    fn default() -> Self {
        Self::new()
    }
}

impl AsyncTasks {
    pub fn new() -> Self {
        console_error_panic_hook::set_once();

        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            tx,
            rx: Arc::new(tokio::sync::Mutex::new(rx)),
            spawned: Arc::new(AtomicUsize::new(0)),
            notifier: Arc::new(Notify::new()),
        }
    }

    pub async fn spawn<F>(&mut self, fut: F)
    where
        F: std::future::Future<Output = anyhow::Result<(), KclError>> + Send + 'static,
    {
        self.spawned.fetch_add(1, Ordering::Relaxed);
        let tx = self.tx.clone();
        let notify = self.notifier.clone();

        wasm_bindgen_futures::spawn_local(async move {
            console_error_panic_hook::set_once();
            let _ = tx.send(fut.await); // ignore if receiver disappeared
            notify.notify_one(); // wake any join_all waiter
        });
    }

    // Wait for all tasks to finish.
    // Return an error if any of them failed.
    pub async fn join_all(&mut self) -> anyhow::Result<(), KclError> {
        let total = self.spawned.load(Ordering::Acquire);
        if total == 0 {
            return Ok(());
        }

        let mut done = 0;
        while done < total {
            // 1) Drain whatever is already in the channel
            {
                let mut rx = self.rx.lock().await;
                while let Ok(res) = rx.try_recv() {
                    done += 1;
                    res?; // propagate first Err
                }
            }
            if done >= total {
                break;
            }
            // Yield to the event loop so that we don't block the UI thread.
            // No seriously WE DO NOT WANT TO PAUSE THE WHOLE APP ON THE JS SIDE.
            futures_lite::future::yield_now().await;
            // Check again before waiting to avoid missing notifications
            {
                let mut rx = self.rx.lock().await;
                while let Ok(res) = rx.try_recv() {
                    done += 1;
                    res?; // propagate first Err
                    if done >= total {
                        break;
                    }
                }
            }
            // Only wait for notification if we still need more tasks to complete
            if done < total {
                // 2) Nothing ready yet → wait for a notifier poke
                self.notifier.notified().await;
            }
        }

        Ok(())
    }

    pub async fn clear(&mut self) {
        self.spawned.store(0, Ordering::Release);

        // Drain channel so old results don’t confuse the next join_all.
        let mut rx = self.rx.lock().await;
        while rx.try_recv().is_ok() {}
    }
}
