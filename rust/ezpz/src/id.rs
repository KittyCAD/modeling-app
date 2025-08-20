/// For performance reasons, this should not require heap allocations, this should be
/// quick to copy and to compute.
///
/// Integers have these properties, in the future we should just use integers.
/// But for now, lets use strings because they're easy to debug. To get better performance
/// than true strings, let's just use 10 chars. This is very limiting, and the current
/// impl can only support single-char entities, and only 10 child points per entity.
/// But it's enough to establish a performance baseline and to help debug as we develop the
/// solver.
///
/// Soon we can use a numeric ID and have a Map<Id, String> to look up numeric IDs and find
/// their human-friendly ids for debugging. No runtime cost, conditionally compiled
/// only for test mode.
///
/// IDs can relate to each other, for example, a rectangle has 4 points, and the ID of each
/// point should be easy to calculate from the ID of the rectangle. This means we can avoid
/// keeping a lookup table of IDs that must be queried. Instead, we just derive the child ID.
#[derive(Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct Id {
    tag: [char; 10],
    len: usize,
    id_type: IdType,
}

/// What type of thing is this ID for?
#[derive(Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub enum IdType {
    Entity,
    Point,
    Component,
}

impl std::fmt::Display for IdType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                IdType::Entity => "Entity",
                IdType::Point => "Point",
                IdType::Component => "Component",
            }
        )
    }
}

impl std::fmt::Debug for IdType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                IdType::Entity => "Entity",
                IdType::Point => "Point",
                IdType::Component => "Component",
            }
        )
    }
}

impl Id {
    /// Get the ID of the child point number i.
    pub fn child_point(self, i: usize) -> Self {
        assert_eq!(
            self.id_type,
            IdType::Entity,
            "Only entities can have a child points, but this is type {}",
            self.id_type
        );
        let mut out = self;
        out.tag[out.len] = '.';
        out.tag[out.len + 1] = 'p';
        out.tag[out.len + 2] = match i {
            0 => '0',
            1 => '1',
            2 => '2',
            3 => '3',
            4 => '4',
            5 => '5',
            6 => '6',
            7 => '7',
            8 => '8',
            9 => '9',
            _ => panic!("too many points in this entity"),
        };
        out.len += 3;
        out.id_type = IdType::Point;
        out
    }

    /// Get the ID of the child X component.
    pub fn child_x_component(self) -> Self {
        assert_eq!(
            self.id_type,
            IdType::Point,
            "Only points can have a child x component, but this is type {}",
            self.id_type
        );
        let mut out = self;
        out.tag[out.len] = '.';
        out.tag[out.len + 1] = 'x';
        out.len += 2;
        out.id_type = IdType::Component;
        out
    }

    /// Get the ID of the child Y component.
    pub fn child_y_component(self) -> Self {
        assert_eq!(
            self.id_type,
            IdType::Point,
            "Only points can have a child y component, but this is type {}",
            self.id_type
        );
        let mut out = self;
        out.tag[out.len] = '.';
        out.tag[out.len + 1] = 'y';
        out.len += 2;
        out.id_type = IdType::Component;
        out
    }

    /// Make a new entity, with a single-character ID.
    pub fn new_entity(ch: char) -> Self {
        let mut tag = [' '; 10];
        tag[0] = ch;
        Self {
            tag,
            len: 1,
            id_type: IdType::Entity,
        }
    }

    pub fn new_point(ch: char) -> Self {
        let mut tag = [' '; 10];
        tag[0] = ch;
        Self {
            tag,
            len: 1,
            id_type: IdType::Point,
        }
    }
}

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for ch in self.tag.iter().take(self.len) {
            write!(f, "{ch}")?;
        }
        Ok(())
    }
}

impl std::fmt::Debug for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for ch in self.tag.iter().take(self.len) {
            write!(f, "{ch}")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_of_children() {
        let entity_id = Id::new_entity('a');
        assert_eq!(entity_id.to_string(), "a");
        assert_eq!(entity_id.id_type, IdType::Entity);
        let p0_id = entity_id.child_point(0);
        assert_eq!(p0_id.to_string(), "a.p0");
        assert_eq!(p0_id.id_type, IdType::Point);
        let x_id = p0_id.child_x_component();
        assert_eq!(x_id.to_string(), "a.p0.x");
        assert_eq!(x_id.id_type, IdType::Component);
        let y_id = p0_id.child_y_component();
        assert_eq!(y_id.to_string(), "a.p0.y");
        assert_eq!(y_id.id_type, IdType::Component);
    }
}
