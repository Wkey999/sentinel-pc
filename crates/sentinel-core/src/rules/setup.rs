use crate::{
    collectors::DisplayMode,
    diagnostics::{AUDIT_ACTION_IDS, AuditCheckResult},
    domain::*,
};
use serde::Deserialize;
pub(super) struct Analysis {
    pub checks: Vec<AuditCheckResult>,
    pub findings: Vec<Finding>,
    pub unknowns: Vec<String>,
}
fn result(
    id: &str,
    metric: &str,
    object: Option<String>,
    assessment: &str,
    evidence: Vec<String>,
    summary: String,
    limitations: &[&str],
) -> AuditCheckResult {
    AuditCheckResult {
        check_id: id.into(),
        metric: metric.into(),
        object_id: object,
        assessment: assessment.into(),
        evidence_ids: evidence,
        summary,
        limitations: limitations.iter().map(|s| (*s).into()).collect(),
    }
}
fn field<'a>(e: &'a Evidence, key: &str) -> &'a str {
    e.fields.get(key).map(String::as_str).unwrap_or("")
}
fn positive(e: &Evidence, key: &str) -> Option<f64> {
    field(e, key)
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v > 0.0 && *v < 100000.0)
}
fn integer(e: &Evidence, key: &str) -> Option<u64> {
    field(e, key).parse().ok()
}
fn native(e: &&Evidence) -> bool {
    e.source == "windows:local" && field(e, "measurementOrigin") == "native_collected"
}
fn ids(e: &Evidence) -> Vec<String> {
    vec![e.id.clone()]
}
pub(super) fn analyze(evidence: &[Evidence], coverage: &[Coverage]) -> Analysis {
    let mut a = Analysis {
        checks: vec![],
        findings: vec![],
        unknowns: vec![],
    };
    if !coverage.iter().any(|c| c.source.starts_with("audit."))
        && !evidence.iter().any(|e| e.kind.starts_with("setup."))
    {
        return a;
    }
    let displays: Vec<_> = evidence
        .iter()
        .filter(native)
        .filter(|e| e.kind == "setup.display")
        .collect();
    for e in &displays {
        let object = Some(field(e, "monitorKey").to_string());
        let (state, text) = if field(e, "sessionKind") != "local"
            || ["6", "11", "16", "17", "18", "-2147483648"].contains(&field(e, "outputTechnology"))
        {
            (
                "unknown",
                "内置屏、混合/间接路由或远程会话不能用于直接判断台式机物理插线。",
            )
        } else {
            match (field(e, "adapterRole"), field(e, "hasDiscreteAdapter")) {
                ("integrated", "true") => (
                    "opportunity",
                    "检测到独显，但此屏当前由核显输出；若为台式机，请核对是否使用独显上的 DP/HDMI 接口。",
                ),
                ("discrete", _) => (
                    "no_issue_observed",
                    "此屏当前由独显输出；本次未观察到核显输出这条配置线索。",
                ),
                ("integrated", "false") => (
                    "not_applicable",
                    "本次未枚举到独显，不适用“已有独显却接核显”的比较。",
                ),
                _ => ("unknown", "没有足够的适配器分类或显示路径依据。"),
            }
        };
        a.checks.push(result(
            AUDIT_ACTION_IDS[0],
            "output_adapter",
            object,
            state,
            ids(e),
            text.into(),
            &[
                "核显输出不证明接错主板接口；笔记本与扩展坞路由可能由设计决定。",
                "没有物理端口实证，不承诺改接后帧率或 VRR 一定改善。",
            ],
        ));
        if state == "opportunity" {
            a.findings.push(super::finding(
                "SETUP-DISPLAY-001",
                "显示输出归属值得核对",
                text,
                ids(e),
                &["当前路由不等于物理插线错误，也不证明显卡性能异常。"],
                "台式机先核对机箱背部独显接口；笔记本按厂家路由/MUX 说明核对，每次只改一项后复测。",
            ));
        }
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Mode {
        width: u32,
        height: u32,
        numerator: u32,
        denominator: u32,
        interlaced: bool,
    }
    for display in &displays {
        let object = Some(field(display, "monitorKey").to_string());
        let mut references = ids(display);
        let modes = evidence.iter().filter(native).find(|e| {
            e.kind == "setup.monitor_modes"
                && !field(display, "monitorKey").is_empty()
                && field(e, "monitorKey") == field(display, "monitorKey")
        });
        let mut max_same = 0.0f64;
        let mut max_edid = 0.0f64;
        let current = positive(display, "currentRefreshHz").filter(|v| (1.0..=1000.0).contains(v));
        let width = integer(display, "width");
        let height = integer(display, "height");
        if let Some(e) = modes {
            references.push(e.id.clone());
            if let Ok(modes) = serde_json::from_str::<Vec<DisplayMode>>(field(e, "edidModesJson")) {
                for m in modes
                    .into_iter()
                    .take(128)
                    .filter(|m| m.hz.is_finite() && (1.0..=1000.0).contains(&m.hz))
                {
                    max_edid = max_edid.max(m.hz);
                    if Some(m.width as u64) == width && Some(m.height as u64) == height {
                        max_same = max_same.max(m.hz);
                    }
                }
            }
            if let Ok(modes) = serde_json::from_str::<Vec<Mode>>(field(e, "sourceModesJson")) {
                for m in modes
                    .into_iter()
                    .take(256)
                    .filter(|m| m.denominator > 0 && !m.interlaced)
                {
                    let hz = m.numerator as f64 / m.denominator as f64;
                    if (1.0..=1000.0).contains(&hz)
                        && Some(m.width as u64) == width
                        && Some(m.height as u64) == height
                    {
                        max_same = max_same.max(hz);
                    }
                }
            }
        }
        let (state, text) = match current {
            Some(hz)
                if max_same > hz + 1.0f64.max(hz * 0.01)
                    && field(display, "sessionKind") == "local" =>
            {
                (
                    "opportunity",
                    format!(
                        "当前约 {hz:.2}Hz，低于同分辨率可识别模式的 {max_same:.2}Hz；可识别 EDID 时序最高约 {max_edid:.2}Hz（0 表示未取得）。"
                    ),
                )
            }
            Some(hz) if max_same > 0.0 && field(display, "sessionKind") == "local" => (
                "no_issue_observed",
                format!("当前约 {hz:.2}Hz，本次已识别的同分辨率模式中未见明显更高值。"),
            ),
            Some(hz) => (
                "unknown",
                format!(
                    "当前约 {hz:.2}Hz，但缺少可比较的同分辨率模式/本地会话依据；已识别 EDID 最高约 {max_edid:.2}Hz。"
                ),
            ),
            None => ("unknown", "当前刷新率无法确认。".into()),
        };
        a.checks.push(result(AUDIT_ACTION_IDS[1],"refresh_rate",object,state,references.clone(),text.clone(),&["EDID 仅解析基础/CTA 详细时序，未声称完整解析所有扩展；系统模式也可能由驱动生成。","同分辨率的描述模式不保证当前线材/接口、HDR、复制显示或动态刷新配置可用，不自动切换。"]));
        if state == "opportunity" {
            a.findings.push(super::finding("SETUP-REFRESH-001","当前刷新率低于可识别模式",&text,references,&["跨分辨率、接口带宽和 HDR/动态刷新差异仍需核对；不是必定可开启的保证。"],"打开设置 → 系统 → 显示 → 高级显示，选择对应显示器核对可用刷新率；由用户手动修改并复测。"));
        }
    }
    let memory: Vec<_> = evidence
        .iter()
        .filter(native)
        .filter(|e| e.kind == "setup.memory")
        .collect();
    for e in &memory {
        let configured = integer(e, "configuredClockSpeed").filter(|v| *v > 0 && *v <= 32000);
        let reported = integer(e, "reportedSpeed").filter(|v| *v > 0 && *v <= 32000);
        let (state, text) = match (configured, reported) {
            (Some(c), Some(s)) if c < s => (
                "opportunity",
                format!(
                    "配置速率字段为 {c}，模块所报 Speed 为 {s}；值得核对 CPU/主板支持与内存配置，不能据此确认未开 XMP/EXPO。"
                ),
            ),
            (Some(c), Some(s))
                if ["26", "34"].contains(&field(e, "memoryType"))
                    && ((field(e, "memoryType") == "26" && [2133, 2400].contains(&c))
                        || (field(e, "memoryType") == "34" && c == 4800)) =>
            {
                (
                    "unknown",
                    format!(
                        "配置字段为 {c}，模块 Speed 为 {s}；仅凭这个速率不能判断是否存在未释放的性能。"
                    ),
                )
            }
            (Some(c), Some(s)) => (
                "no_issue_observed",
                format!("配置字段 {c} 未低于本次模块所报 Speed {s}；不表示 XMP/EXPO 已开启。"),
            ),
            _ => (
                "unknown",
                "配置速率为 0、缺失或无效；没有将未知当作正常或按 MHz/MT/s 擅自翻倍。".into(),
            ),
        };
        a.checks.push(result(
            AUDIT_ACTION_IDS[2],
            "memory_speed",
            e.entity.clone(),
            state,
            ids(e),
            text.clone(),
            &["数字沿用 SMBIOS/WMI 原字段语义；Speed 不是已验证的 XMP/EXPO 目标档位。"],
        ));
        if state == "opportunity" {
            a.findings.push(super::finding("SETUP-MEMORY-001","内存配置速率值得核对",&text,ids(e),&["CPU/主板限制或合法 JEDEC 配置也可能产生差异，不自动开启超频。"],"对照主板、CPU 与内存规格核对 BIOS 中的配置；不熟悉时先保留现状或咨询装机人员，手动改动后再复测。"));
        }
    }
    let memory_ids = memory.iter().map(|e| e.id.clone()).collect();
    a.checks.push(result(AUDIT_ACTION_IDS[2],"memory_channels",None,"unknown",memory_ids,format!("读到 {} 条模块记录；Windows 此来源没有核实实际通道数，不能按条数、相邻插槽、Rank 或 DDR5 子通道判断。",memory.len()),&["通道与主板插槽拓扑需另外的可靠来源。"]));
    a.checks.push(result(
        AUDIT_ACTION_IDS[2],
        "xmp_expo_profile",
        None,
        "unknown",
        memory.iter().map(|e| e.id.clone()).collect(),
        "当前只读来源未提供可核实的 XMP/EXPO 开关状态。".into(),
        &["不从低速率推断未开启，不从高速率推断已开启。"],
    ));
    for e in evidence
        .iter()
        .filter(native)
        .filter(|e| e.kind == "setup.power")
    {
        let (state, label) = match field(e, "schemeGuid") {
            "a1841308-3541-4fab-bc81-f71556f20b4a" => ("opportunity", "节能"),
            "381b4222-f694-41f0-9685-ff5bb260df2e" => ("no_issue_observed", "平衡"),
            "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" => ("no_issue_observed", "高性能"),
            _ => ("unknown", "自定义或无法分类"),
        };
        let text = format!(
            "当前活动电源计划：{label}；GUID={}。当前选择不证明被策略锁定，平衡也不等于性能异常。",
            field(e, "schemeGuid")
        );
        a.checks.push(result(
            AUDIT_ACTION_IDS[3],
            "power_scheme",
            e.entity.clone(),
            state,
            ids(e),
            text.clone(),
            &["计划不等于所有电源模式/实际性能，不自动切换计划。"],
        ));
        if state == "opportunity" {
            a.findings.push(super::finding(
                "SETUP-POWER-001",
                "当前选择节能计划",
                &text,
                ids(e),
                &["节能可能符合用户用途，不保证改为高性能就提升帧率。"],
                "若在接通电源时关注游戏性能，可手动核对电源设置；先记录现状，每次改一项后复测。",
            ));
        }
        for (metric, key) in [
            ("game_mode", "gameModeConfigured"),
            ("hags", "hagsConfigured"),
        ] {
            a.checks.push(result(
                AUDIT_ACTION_IDS[3],
                metric,
                e.entity.clone(),
                "unknown",
                ids(e),
                format!(
                    "配置声明：{}；是否受支持、已生效以及是否有性能收益均未由此核实。",
                    field(e, key)
                ),
                &["缺值不当成关闭，不统一建议开启 HAGS。"],
            ));
        }
    }
    for e in evidence
        .iter()
        .filter(native)
        .filter(|e| e.kind == "setup.disk_capacity" && field(e, "volumeRole") == "system")
    {
        let (state, text) = match (integer(e, "totalBytes"), integer(e, "freeBytes")) {
            (Some(total), Some(free)) if total > 0 && free <= total => {
                let low = free as u128 * 10 < total as u128;
                (
                    if low {
                        "opportunity"
                    } else {
                        "no_issue_observed"
                    },
                    format!(
                        "系统卷可用 {free} / {total} 字节，约 {:.2}%；10% 仅为本项目空间提醒阈值。",
                        free as f64 / total as f64 * 100.0
                    ),
                )
            }
            _ => ("unknown", "系统卷容量缺失、为 0 或数值无效。".into()),
        };
        a.checks.push(result(
            AUDIT_ACTION_IDS[4],
            "system_disk_free",
            e.entity.clone(),
            state,
            ids(e),
            text.clone(),
            &["空间余量不直接证明 SSD 掉速、健康或卡顿根因；不自动删除文件。"],
        ));
        if state == "opportunity" {
            a.findings.push(super::finding(
                "SETUP-DISK-001",
                "系统卷可用空间低于 10%",
                &text,
                ids(e),
                &["不是性能或故障的独立诊断。"],
                "先备份资料，再由用户核对存储设置中可清理的内容；不自动删除文件，释放空间后复测。",
            ));
        }
    }
    a.checks.push(result(
        AUDIT_ACTION_IDS[4],
        "pcie_link",
        None,
        "unknown",
        vec![],
        "本轮没有实现可核验的 PCIe 平台上限与链路采样。".into(),
        &["空闲低链路速度不证明瓶颈；未主动加负载。"],
    ));
    let sensors: Vec<_> = evidence
        .iter()
        .filter(|e| {
            e.kind == "setup.sensor_log"
                && field(e, "measurementOrigin") == "imported_report_declared"
        })
        .collect();
    for e in &sensors {
        let is_flag = field(e, "sensorKind").ends_with("flag");
        let yes = integer(e, "yesCount").unwrap_or(0);
        let count = integer(e, "sampleCount").unwrap_or(0);
        let state = if is_flag && yes > 0 {
            "opportunity"
        } else {
            "unknown"
        };
        let summary = if is_flag {
            format!(
                "导入日志声明 {}：{count} 个有效样本中 {yes} 次为 Yes。即使全为 No，也不能排除未记录时段/未覆盖传感器的问题。",
                field(e, "sensorLabel")
            )
        } else {
            format!(
                "导入日志声明 {}：末次 {} {}，记录最大 {} {}，{count} 个有效样本；数值本身不证明过热或供电不足。",
                field(e, "sensorLabel"),
                field(e, "last"),
                field(e, "unit"),
                field(e, "maximum"),
                field(e, "unit")
            )
        };
        a.checks.push(result(
            AUDIT_ACTION_IDS[5],
            "thermal_power_limits",
            e.entity.clone(),
            state,
            ids(e),
            summary.clone(),
            &["来自用户导入日志，不是当前实时采样；时间/时区、设备、负载与文件真实性须另行核对。"],
        ));
        if is_flag && yes > 0 {
            a.findings.push(super::finding(
                "SENSOR-LIMIT-001",
                "传感器日志记录限制标志",
                &summary,
                ids(e),
                &["限制标志不直接证明散热器故障、电源额定功率不足或当前持续降频。"],
                "对照日志时段核对当时负载、温度和设备；一次只改变一个变量后重新记录，不自动烤机。",
            ));
        }
    }
    if sensors.is_empty() {
        a.checks.push(result(
        AUDIT_ACTION_IDS[5],
        "thermal_power_limits",
        None,
        "unknown",
        vec![],
        "没有已验证的 CPU/GPU 节流传感器数据，不据 WHEA、磁盘温度或空闲低时钟确诊过热/供电不足。"
            .into(),
        &["缺少传感器来源，不是已确认权限不足。可在「工具与来源」导入支持的 HWiNFO 英文 CSV；不自动安装驱动或启动烤机。"],
    ));
    }
    for id in AUDIT_ACTION_IDS {
        if !a.checks.iter().any(|c| c.check_id == id) {
            a.checks.push(result(
                id,
                "collection",
                None,
                "unknown",
                vec![],
                "未取得该组可用证据；请查看采集覆盖与权限状态。".into(),
                &["未采集不等于检查通过。"],
            ));
        }
    }
    for c in &a.checks {
        if c.assessment == "unknown" {
            a.unknowns
                .push(format!("{} / {}：{}", c.check_id, c.metric, c.summary));
        }
    }
    a
}
