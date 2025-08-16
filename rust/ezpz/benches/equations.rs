use divan::black_box;
use kcl_ezpz::id::Id;

fn main() {
    // Run registered benchmarks.
    divan::main();
}

#[divan::bench(args = [0, 1, 8])]
fn id_generation(point_id: usize) -> Id {
    let entity_id = black_box(Id::for_entity('a'));
    let p0_id = black_box(entity_id.for_point(point_id));
    black_box(p0_id.for_x_component())
}
