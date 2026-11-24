use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    rc::{Rc, Weak},
};

/// Shared application state that invalidates bindings that declare it as a dependency.
pub struct Signal<T> {
    state: Rc<SignalState<T>>,
}

struct SignalState<T> {
    value: RefCell<T>,
    changes: Rc<Notifier>,
}

impl<T> Clone for Signal<T> {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
        }
    }
}

impl<T> Signal<T> {
    pub fn new(value: T) -> Self {
        Self {
            state: Rc::new(SignalState {
                value: RefCell::new(value),
                changes: Rc::new(Notifier::default()),
            }),
        }
    }

    /// Read an owned copy of the current value.
    pub fn get(&self) -> T
    where
        T: Clone,
    {
        self.state.value.borrow().clone()
    }

    /// Store a value and invalidate dependent observations, even for equal values.
    pub fn set(&self, value: T) {
        drop(self.state.value.replace(value));
        self.state.changes.notify();
    }

    pub(crate) fn notifier(&self) -> &Rc<Notifier> {
        &self.state.changes
    }
}

/// Keeps a callback registered until the guard is dropped.
#[must_use = "dropping the subscription stops notifications"]
pub struct Subscription {
    notifier: Weak<Notifier>,
    id: usize,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(notifier) = self.notifier.upgrade() {
            let removed = notifier.listeners.borrow_mut().remove(&self.id);
            drop(removed);
        }
    }
}

type Listener = Rc<dyn Fn()>;

#[derive(Default)]
pub(crate) struct Notifier {
    listeners: RefCell<BTreeMap<usize, Listener>>,
    next_id: Cell<usize>,
}

impl Notifier {
    pub(crate) fn subscribe(self: &Rc<Self>, listener: impl Fn() + 'static) -> Subscription {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        self.listeners.borrow_mut().insert(id, Rc::new(listener));
        Subscription {
            notifier: Rc::downgrade(self),
            id,
        }
    }

    pub(crate) fn notify(&self) {
        let ids: Vec<_> = self.listeners.borrow().keys().copied().collect();
        for id in ids {
            let listener = self.listeners.borrow().get(&id).cloned();
            if let Some(listener) = listener {
                listener();
            }
        }
    }
}
