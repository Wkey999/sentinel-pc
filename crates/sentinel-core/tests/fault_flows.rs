mod support {
    pub mod fault_lab;
}
use support::fault_lab::*;

#[test]
fn seventeen_fault_replays_cover_four_categories_and_negative_controls() {
    let trials = trials();
    assert_eq!(trials.len(), 17);
    for trial in trials {
        replay(trial);
    }
}

#[test]
fn duplicate_evidence_never_produces_a_report() {
    let e = event("same", "Display", "System", 4101);
    assert!(
        sentinel_core::rules::analyze_evidence(vec![e.clone(), e], vec![], START, END, vec![])
            .is_err()
    );
}
