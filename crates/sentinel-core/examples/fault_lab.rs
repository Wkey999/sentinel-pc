//! Developer-only: `cargo run -p sentinel-core --example fault_lab -- OUTPUT.json`
#[path = "../tests/support/fault_lab.rs"]
mod lab;
fn main() {
    let output = std::env::args().nth(1).expect("output JSON path required");
    let results: Vec<_> = lab::trials().into_iter().map(lab::replay).collect();
    std::fs::write(output, serde_json::to_vec_pretty(&results).unwrap()).unwrap();
    println!(
        "{} synthetic fault replays passed; no collectors/model/production database used.",
        results.len()
    );
}
