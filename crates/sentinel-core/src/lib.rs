pub mod domain;
mod export;
pub mod parsers;
pub mod rules;

use chrono::{DateTime, Duration, Utc};
use domain::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
pub struct Store {
    conn: Connection,
}

fn storage_error(_: rusqlite::Error) -> String {
    "案例存储操作失败，请检查可用空间与应用数据目录权限。".into()
}
fn encode<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| "数据编码失败。".into())
}
fn decode<T: serde::de::DeserializeOwned>(text: &str) -> Result<T> {
    serde_json::from_str(text).map_err(|_| "保存的数据格式不受支持。".into())
}
fn validate_id(id: &str) -> Result<()> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "案例 ID 无效。".into())
}
fn validate_request(r: &CreateCase) -> Result<()> {
    if r.symptom.trim().is_empty() || r.symptom.chars().count() > 1000 {
        return Err("请填写 1–1000 字的问题描述。".into());
    }
    if !["personal", "workplace", "unknown"].contains(&r.environment.as_str()) {
        return Err("使用环境无效。".into());
    }
    if !["Asia/Hong_Kong", "Asia/Shanghai", "UTC"].contains(&r.display_timezone.as_str()) {
        return Err("时区不受支持。".into());
    }
    let a = DateTime::parse_from_rfc3339(&r.incident_start_utc).map_err(|_| "开始时间无效。")?;
    let b = DateTime::parse_from_rfc3339(&r.incident_end_utc).map_err(|_| "结束时间无效。")?;
    if b < a || b - a > Duration::hours(24) {
        return Err("时间窗口必须有序，且不超过 24 小时。".into());
    }
    Ok(())
}

pub fn authorize_window(label: &str) -> Result<()> {
    if label == "main" {
        Ok(())
    } else {
        Err("此窗口没有诊断接口权限。".into())
    }
}

pub fn plan_hash(plan: &Plan) -> Result<String> {
    let mut unsigned = plan.clone();
    unsigned.hash.clear();
    Ok(format!(
        "{:x}",
        Sha256::digest(encode(&unsigned)?.as_bytes())
    ))
}

fn valid_plan(record: &CaseRecord, id: &str, hash: &str) -> Result<Plan> {
    let p = record.plan.as_ref().ok_or("请先生成检查计划。")?;
    if p.id != id
        || p.hash != hash
        || plan_hash(p)? != hash
        || p.action_ids != ["demo.analyze_fixture"]
        || p.policy_version != "preview-0.1.0"
        || p.scenario_id != record.scenario_id
        || p.incident_start_utc != record.incident_start_utc
        || p.incident_end_utc != record.incident_end_utc
        || p.case_id != record.id
    {
        return Err("计划已变化或动作未获允许，请重新预览。".into());
    }
    Ok(p.clone())
}

impl Store {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        Self::initialize(Connection::open(path).map_err(storage_error)?)
    }
    pub fn memory() -> Result<Self> {
        Self::initialize(Connection::open_in_memory().map_err(storage_error)?)
    }
    fn initialize(conn: Connection) -> Result<Self> {
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(storage_error)?;
        if version > 1 {
            return Err("数据库来自更新版本，停止打开以免覆盖；请使用兼容应用。".into());
        }
        conn.busy_timeout(std::time::Duration::from_secs(3))
            .map_err(storage_error)?;
        conn.execute_batch("PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS consents(token TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, plan_hash TEXT NOT NULL, expires_at TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, plan_hash TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(case_id,plan_hash));
          PRAGMA user_version=1;
          DELETE FROM consents WHERE consumed=0;") .map_err(storage_error)?;
        let store = Self { conn };
        // Completed reports remain; stale approvals never survive an application restart.
        for mut c in store.list()? {
            if c.status == "collecting" || c.status == "awaiting_consent" {
                c.status = "interrupted".into();
                store.save(&c)?;
            }
        }
        store
            .conn
            .execute(
                "UPDATE runs SET status='interrupted' WHERE status='collecting'",
                [],
            )
            .map_err(storage_error)?;
        Ok(store)
    }
    fn save(&self, record: &CaseRecord) -> Result<()> {
        self.conn.execute("INSERT INTO cases(id,body) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body", params![record.id, encode(record)?]).map_err(storage_error)?;
        Ok(())
    }
    pub fn create(&self, r: CreateCase) -> Result<CaseRecord> {
        validate_request(&r)?;
        let sample = catalog()
            .scenarios
            .into_iter()
            .find(|s| s.id == r.scenario_id)
            .ok_or("只允许内置合成样本；本轮不读取本机日志。")?;
        let c = CaseRecord {
            id: Uuid::new_v4().to_string(),
            title: sample.title,
            symptom: r.symptom.trim().into(),
            scenario_id: r.scenario_id,
            incident_start_utc: r.incident_start_utc,
            incident_end_utc: r.incident_end_utc,
            display_timezone: r.display_timezone,
            environment: r.environment,
            created_at_utc: Utc::now().to_rfc3339(),
            status: "draft".into(),
            plan: None,
            report: None,
        };
        self.save(&c)?;
        Ok(c)
    }
    pub fn get(&self, id: &str) -> Result<CaseRecord> {
        validate_id(id)?;
        let text: Option<String> = self
            .conn
            .query_row("SELECT body FROM cases WHERE id=?1", [id], |row| row.get(0))
            .optional()
            .map_err(storage_error)?;
        decode(&text.ok_or("案例不存在或已删除。")?)
    }
    pub fn list(&self) -> Result<Vec<CaseRecord>> {
        let mut stmt = self
            .conn
            .prepare("SELECT body FROM cases ORDER BY rowid DESC")
            .map_err(storage_error)?;
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map_err(storage_error)?
            .map(|r| decode(&r.map_err(storage_error)?))
            .collect()
    }
    pub fn build_plan(&self, id: &str) -> Result<CaseRecord> {
        let mut c = self.get(id)?;
        if c.report.is_some() {
            return Err("已完成案例不能覆盖；请新建一轮。".into());
        }
        let mut p = Plan {
            id: Uuid::new_v4().to_string(),
            case_id: c.id.clone(),
            revision: c.plan.as_ref().map_or(1, |p| p.revision + 1),
            hash: String::new(),
            action_ids: vec!["demo.analyze_fixture".into()],
            data_scopes: vec!["仅内置合成样本；不采集本机数据；不联网".into()],
            policy_version: "preview-0.1.0".into(),
            adapter_version: "synthetic-0.1.0".into(),
            scenario_id: c.scenario_id.clone(),
            incident_start_utc: c.incident_start_utc.clone(),
            incident_end_utc: c.incident_end_utc.clone(),
        };
        p.hash = plan_hash(&p)?;
        c.plan = Some(p);
        c.status = "awaiting_consent".into();
        self.save(&c)?;
        Ok(c)
    }
    pub fn approve(&self, r: ApproveRequest) -> Result<Consent> {
        let c = self.get(&r.case_id)?;
        valid_plan(&c, &r.plan_id, &r.plan_hash)?;
        if c.status != "awaiting_consent" {
            return Err("案例当前不能批准；请重新建立计划。".into());
        }
        let consent = Consent {
            token: Uuid::new_v4().to_string(),
            expires_at_utc: (Utc::now() + Duration::minutes(10)).to_rfc3339(),
        };
        self.conn
            .execute(
                "INSERT INTO consents(token,case_id,plan_hash,expires_at) VALUES(?1,?2,?3,?4)",
                params![consent.token, c.id, r.plan_hash, consent.expires_at_utc],
            )
            .map_err(storage_error)?;
        Ok(consent)
    }
    pub fn start(&mut self, r: StartRequest) -> Result<CaseRecord> {
        let c = self.get(&r.case_id)?;
        valid_plan(&c, &r.plan_id, &r.plan_hash)?;
        let tx = self.conn.transaction().map_err(storage_error)?;
        let consent: Option<(String, String, String, i32)> = tx
            .query_row(
                "SELECT case_id,plan_hash,expires_at,consumed FROM consents WHERE token=?1",
                [&r.consent_token],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(storage_error)?;
        let (case_id, hash, expires, consumed) = consent.ok_or("同意不存在或重启后已失效。")?;
        let expiry = DateTime::parse_from_rfc3339(&expires).map_err(|_| "同意时间无效。")?;
        if case_id != c.id || hash != r.plan_hash || expiry < Utc::now() {
            return Err("同意范围不符或已过期，请重新预览。".into());
        }
        if consumed == 1 {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM runs WHERE case_id=?1 AND plan_hash=?2)",
                    params![c.id, hash],
                    |row| row.get(0),
                )
                .map_err(storage_error)?;
            if exists && c.report.is_some() {
                return Ok(c);
            }
            return Err("该同意已使用；不自动重跑。".into());
        }
        if c.status != "awaiting_consent" {
            return Err("当前状态不能启动。".into());
        }
        tx.execute(
            "UPDATE consents SET consumed=1 WHERE token=?1 AND consumed=0",
            [&r.consent_token],
        )
        .map_err(storage_error)?;
        tx.execute(
            "INSERT INTO runs(id,case_id,plan_hash,status) VALUES(?1,?2,?3,'collecting')",
            params![Uuid::new_v4().to_string(), c.id, hash],
        )
        .map_err(storage_error)?;
        let mut next = c;
        next.status = "collecting".into();
        tx.execute(
            "UPDATE cases SET body=?2 WHERE id=?1",
            params![next.id, encode(&next)?],
        )
        .map_err(storage_error)?;
        tx.commit().map_err(storage_error)?;
        let sample = catalog()
            .scenarios
            .into_iter()
            .find(|s| s.id == next.scenario_id)
            .ok_or("样本不存在。")?;
        next.report = Some(rules::analyze(
            &sample,
            &next.incident_start_utc,
            &next.incident_end_utc,
        ));
        next.status = "completed_partial".into(); // Every preview lacks real-machine coverage.
        let tx = self.conn.transaction().map_err(storage_error)?;
        tx.execute(
            "UPDATE cases SET body=?2 WHERE id=?1",
            params![next.id, encode(&next)?],
        )
        .map_err(storage_error)?;
        tx.execute(
            "UPDATE runs SET status='completed_partial' WHERE case_id=?1 AND plan_hash=?2",
            params![next.id, r.plan_hash],
        )
        .map_err(storage_error)?;
        tx.commit().map_err(storage_error)?;
        Ok(next)
    }
    pub fn delete(&self, id: &str) -> Result<()> {
        validate_id(id)?;
        self.conn
            .execute("DELETE FROM cases WHERE id=?1", [id])
            .map_err(storage_error)?;
        Ok(())
    }
    pub fn export(&self, r: ExportRequest) -> Result<ExportResult> {
        export::render(&self.get(&r.case_id)?, &r.format)
    }
}
