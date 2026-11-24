use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    ops::Deref,
    rc::{Rc, Weak},
};

/// Shared application state that invalidates bindings that declare it as a dependency.
pub struct Signal<T> {
    read: ReadSignal<T>,
}

/// Shared access to a Signal's current value and dependency identity.
pub struct ReadSignal<T> {
    state: Rc<SignalState<T>>,
}

struct SignalState<T> {
    value: RefCell<T>,
    changes: Rc<Notifier>,
}

impl<T> Clone for Signal<T> {
    fn clone(&self) -> Self {
        Self {
            read: self.read.clone(),
        }
    }
}

impl<T> Clone for ReadSignal<T> {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
        }
    }
}

impl<T> Deref for Signal<T> {
    type Target = ReadSignal<T>;

    fn deref(&self) -> &Self::Target {
        &self.read
    }
}

impl<T> Signal<T> {
    pub fn new(value: T) -> Self {
        Self {
            read: ReadSignal {
                state: Rc::new(SignalState {
                    value: RefCell::new(value),
                    changes: Rc::new(Notifier::default()),
                }),
            },
        }
    }

    /// Share the current value without granting permission to write to it.
    ///
    /// ```compile_fail
    /// use plankton_rust::Signal;
    ///
    /// let view = Signal::new(1).read_only();
    /// view.set(2);
    /// ```
    pub fn read_only(&self) -> ReadSignal<T> {
        self.read.clone()
    }

    /// Store a value and invalidate dependent observations, even for equal values.
    pub fn set(&self, value: T) {
        drop(self.read.state.value.replace(value));
        self.read.state.changes.notify();
    }
}

impl<T> ReadSignal<T> {
    /// Read an owned copy of the current value.
    pub fn get(&self) -> T
    where
        T: Clone,
    {
        self.state.value.borrow().clone()
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
