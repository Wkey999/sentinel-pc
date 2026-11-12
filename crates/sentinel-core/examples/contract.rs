use sentinel_core::{Store, domain::*};

fn main() {
    let mut store = Store::memory().expect("in-memory store");
    let mut cases = Vec::new();
    for sample in catalog().scenarios {
        let c = store
            .create(CreateCase {
                scenario_id: sample.id,
                symptom: "合成契约样例".into(),
                incident_start_utc: "2026-11-12T01:53:00Z".into(),
                incident_end_utc: "2026-11-12T02:13:00Z".into(),
                display_timezone: "Asia/Hong_Kong".into(),
                environment: "personal".into(),
            })
            .unwrap();
        let c = store.build_plan(&c.id).unwrap();
        let p = c.plan.unwrap();
        let consent = store
            .approve(ApproveRequest {
                case_id: c.id.clone(),
                plan_id: p.id.clone(),
                plan_hash: p.hash.clone(),
            })
            .unwrap();
        cases.push(
            store
                .start(StartRequest {
                    case_id: c.id,
                    plan_id: p.id,
                    plan_hash: p.hash,
                    consent_token: consent.token,
                })
                .unwrap(),
        );
    }
    println!("{}", serde_json::to_string_pretty(&cases).unwrap());
}
