<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { diagnostics } from "./services/diagnostics";
import { samples } from "./services/mock";
import type { AppStatus, CaseRecord, ExportResult } from "./domain/contracts";

type Page = "home" | "diagnose" | "history" | "tools" | "settings";
const page = ref<Page>("home");
const phase = ref<"interview" | "plan" | "result">("interview");
const status = ref<AppStatus>();
const cases = ref<CaseRecord[]>([]);
const active = ref<CaseRecord>();
const scenario = ref(samples[0]!.id);
const symptom = ref("游戏过程中电脑突然重启，想知道应该先检查什么。");
const incidentTime = ref("2026-11-12T10:03");
const timezone = ref<"Asia/Hong_Kong" | "UTC">("Asia/Hong_Kong");
const environment = ref<"personal" | "workplace" | "unknown">("personal");
const timeUnknown = ref(false);
const approved = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const exportData = ref<ExportResult>();
const exportText = ref("");
const pendingDelete = ref<string>();
const heading = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
watch(
  () => Boolean(exportData.value || pendingDelete.value),
  async (open) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      await nextTick();
      document.querySelector<HTMLElement>('[role="dialog"] button')?.focus();
    } else {
      await nextTick();
      previousFocus?.focus();
    }
  },
);
function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const root = event.currentTarget as HTMLElement;
  const targets = [
    ...root.querySelectorAll<HTMLElement>(
      "button:not(:disabled),textarea,a[href],input:not(:disabled)",
    ),
  ];
  const first = targets[0],
    last = targets.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
const selectedSample = computed(() =>
  samples.find((s) => s.id === scenario.value)!,
);
const nav = [
  { id: "home", label: "工作台", icon: "◫" },
  { id: "diagnose", label: "开始诊断", icon: "⌕" },
  { id: "history", label: "案例记录", icon: "◷" },
  { id: "tools", label: "工具与来源", icon: "▦" },
  { id: "settings", label: "设置与关于", icon: "⚙" },
] as const;
const titles: Record<Page, string> = {
  home: "工作台",
  diagnose: "离线诊断",
  history: "案例记录",
  tools: "工具与来源",
  settings: "设置与关于",
};
const coverageLabels: Record<string, string> = {
  available: "样本可用",
  empty: "结果为空",
  missing: "未提供",
  unsupported: "尚未支持",
  permission_denied: "权限不足（模拟）",
  truncated: "输出截断（模拟）",
};
const formatTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: active.value?.displayTimezone ?? "Asia/Hong_Kong",
      }).format(new Date(value))
    : "时间未知";
async function focusHeading() {
  await nextTick();
  heading.value?.focus();
}
async function go(target: Page) {
  page.value = target;
  error.value = "";
  notice.value = "";
  if (target === "history") await refresh();
  await focusHeading();
}
async function refresh() {
  cases.value = await diagnostics.list();
}
async function task(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await work();
  } catch (e) {
    error.value =
      e instanceof Error
        ? e.name === "ZodError"
          ? "输入或接口数据不符合约定，请检查时间范围与必填项。"
          : e.message
        : String(e);
  } finally {
    busy.value = false;
  }
}
async function begin(id = scenario.value) {
  scenario.value = id;
  phase.value = "interview";
  active.value = undefined;
  approved.value = false;
  const texts: Record<string, string> = {
    restart: "游戏过程中电脑突然重启，想知道应该先检查什么。",
    application: "游戏运行中退出到桌面，记录里提到 ntdll.dll。",
    storage: "已有一份磁盘健康告警报告，想先弄清楚报告能说明什么。",
    empty: "电脑短暂黑屏，但没有找到对应错误记录。",
    insufficient: "问题偶尔出现，部分日志读不到，也没有传感器报告。",
  };
  symptom.value = texts[id]!;
  await go("diagnose");
}
async function makePlan() {
  await task(async () => {
    const offset = timezone.value === "UTC" ? "Z" : "+08:00";
    const center = new Date(`${incidentTime.value}:00${offset}`);
    if (!Number.isFinite(center.getTime()))
      throw Error("请选择有效的发生时间。");
    const halfWindow = timeUnknown.value ? 12 * 3600000 : 10 * 60000;
    const c = await diagnostics.create({
      scenarioId: scenario.value,
      symptom: symptom.value,
      incidentStartUtc: new Date(center.getTime() - halfWindow).toISOString(),
      incidentEndUtc: new Date(center.getTime() + halfWindow).toISOString(),
      displayTimezone: timezone.value,
      environment: environment.value,
    });
    active.value = await diagnostics.build(c.id);
    approved.value = false;
    phase.value = "plan";
    await refresh();
    await focusHeading();
  });
}
async function run() {
  await task(async () => {
    if (!approved.value || !active.value?.plan)
      throw Error("请先确认本轮数据范围。");
    const plan = active.value.plan;
    const request = {
      caseId: active.value.id,
      planId: plan.id,
      planHash: plan.hash,
    };
    const consent = await diagnostics.approve(request);
    active.value = await diagnostics.start({
      ...request,
      consentToken: consent.token,
    });
    phase.value = "result";
    await refresh();
    await focusHeading();
  });
}
async function openCase(c: CaseRecord) {
  await task(async () => {
    active.value = await diagnostics.get(c.id);
    scenario.value = active.value.scenarioId;
    if (!active.value.report) {
      active.value = await diagnostics.build(c.id);
      phase.value = "plan";
      approved.value = false;
    } else phase.value = "result";
    page.value = "diagnose";
    await focusHeading();
  });
}
async function removeCase() {
  await task(async () => {
    if (!pendingDelete.value) return;
    const id = pendingDelete.value;
    await diagnostics.delete(id);
    pendingDelete.value = undefined;
    if (active.value?.id === id) {
      active.value = undefined;
      phase.value = "interview";
    }
    await refresh();
    notice.value = "案例已从当前存储中删除。";
  });
}
async function preview(format: "markdown" | "json") {
  await task(async () => {
    if (!active.value) return;
    exportData.value = await diagnostics.export({
      caseId: active.value.id,
      format,
    });
    exportText.value = exportData.value.content;
  });
}
function download() {
  if (!exportData.value) return;
  const url = URL.createObjectURL(
    new Blob([exportText.value], {
      type: `${exportData.value.mediaType};charset=utf-8`,
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = exportData.value.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice.value = "已发起文件下载；请检查浏览器或桌面下载目录。";
}
onMounted(() =>
  task(async () => {
    status.value = await diagnostics.status();
    await refresh();
  }),
);
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" :inert="Boolean(exportData || pendingDelete)">
      <a class="brand" href="#" @click.prevent="go('home')"
        ><span class="brand-mark">S</span
        ><span>Sentinel<span class="brand-small">PC DIAGNOSTICS</span></span></a
      >
      <div class="workspace-label">
        个人诊断工作区 <span class="version">预览版</span>
      </div>
      <nav aria-label="主导航">
        <button
          v-for="item in nav"
          :key="item.id"
          :class="['nav-item', { selected: page === item.id }]"
          :aria-current="page === item.id ? 'page' : undefined"
          @click="go(item.id)"
        >
          <span aria-hidden="true">{{ item.icon }}</span
          >{{ item.label
          }}<span v-if="item.id === 'history'" class="nav-count">{{
            cases.length
          }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="offline-dot">本地优先 · 模型关闭</div>
        <p>让每一个判断<br />都有可追溯的依据。</p>
        <small>Sentinel PC / v0.1.0</small>
      </div>
    </aside>

    <div class="main-shell" :inert="Boolean(exportData || pendingDelete)">
      <header class="topbar">
        <div>
          <span class="breadcrumb">哨兵</span><span class="separator">/</span
          >{{ titles[page] }}
        </div>
        <div class="header-status">
          <span class="small-dot"></span
          >{{
            status?.mode === "native-synthetic"
              ? "桌面端 · SQLite"
              : "浏览器 · Mock"
          }}<span class="avatar">本</span>
        </div>
      </header>
      <main>
        <div class="preview-banner">
          <span class="preview-label">合成样本演示</span
          ><span
            >当前结果来自内置样本，不是本机检测。真实采集与第三方报告导入尚未开放。</span
          >
        </div>
        <div v-if="error" class="alert error" role="alert">{{ error }}</div>
        <div v-if="notice" class="alert success" role="status">
          {{ notice }}
        </div>

        <template v-if="page === 'home'">
          <div class="page-heading">
            <div>
              <div class="eyebrow">YOUR DIAGNOSTIC WORKSPACE</div>
              <h1 ref="heading" tabindex="-1">先看证据，再找方向。</h1>
              <p>把难懂的电脑异常，整理成清楚、可验证的下一步。</p>
            </div>
            <span class="date-note">离线预览 / 01</span>
          </div>
          <section class="hero">
            <div class="hero-copy">
              <span class="hero-kicker">从一次问题描述开始</span>
              <h2>电脑出状况了，<br />不必急着猜哪个零件坏了。</h2>
              <p>
                描述症状，确认范围，查看证据。<br />哨兵会说清楚发现了什么，以及还不能判断什么。
              </p>
              <button class="button primary" @click="begin()">
                开始一次样本诊断 <span>↗</span>
              </button>
              <div class="hero-footnote">
                约 1 分钟体验 · 无需 API Key · 无真实采集
              </div>
            </div>
            <div class="hero-visual" aria-hidden="true">
              <div class="orbit orbit-one"></div>
              <div class="orbit orbit-two"></div>
              <div class="shield"><span>✓</span></div>
              <span class="visual-tag tag-one">EVIDENCE FIRST</span
              ><span class="visual-tag tag-two"><i></i> OFFLINE READY</span>
            </div>
          </section>
          <div class="section-heading">
            <h2>选择一个问题，试试诊断过程</h2>
            <span>全部为合成样本</span>
          </div>
          <div class="scenario-grid">
            <button
              v-for="(s, i) in samples"
              :key="s.id"
              class="scenario-card"
              @click="begin(s.id)"
            >
              <div class="scenario-top">
                <span class="scenario-symbol">{{
                  ["↻", "⌁", "▤", "○", "?"][i]
                }}</span
                ><span class="scenario-number">0{{ i + 1 }}</span>
              </div>
              <h3>{{ s.title }}</h3>
              <p>{{ s.description }}</p>
              <span class="card-link">查看样本 <span>→</span></span>
            </button>
          </div>
          <div class="principles">
            <div>
              <span>01</span><strong>证据可追溯</strong>
              <p>每个发现对应具体记录。</p>
            </div>
            <div>
              <span>02</span><strong>未知也说清楚</strong>
              <p>没查到不等于没有故障。</p>
            </div>
            <div>
              <span>03</span><strong>本地规则先行</strong>
              <p>关闭模型也能完成报告。</p>
            </div>
          </div>
        </template>

        <template v-else-if="page === 'diagnose'">
          <div class="page-heading compact">
            <div>
              <div class="eyebrow">GUIDED DIAGNOSIS</div>
              <h1 ref="heading" tabindex="-1">
                {{
                  phase === "interview"
                    ? "先说说，发生了什么？"
                    : phase === "plan"
                      ? "确认本轮检查范围"
                      : "把发现和未知放在一起看"
                }}
              </h1>
              <p>
                {{
                  phase === "interview"
                    ? "从合成案例开始，体验一次有边界的排查。"
                    : phase === "plan"
                      ? "只有你确认的计划，才会进入执行。"
                      : "以下是合成样本的规则结果，不能用于诊断当前电脑。"
                }}
              </p>
            </div>
            <button class="button secondary" @click="begin()">新建一轮</button>
          </div>
          <ol class="stepper" aria-label="诊断步骤">
            <li
              v-for="(label, i) in ['描述问题', '预览计划', '查看结果']"
              :key="label"
              :class="{
                current: i === ['interview', 'plan', 'result'].indexOf(phase),
                done: i < ['interview', 'plan', 'result'].indexOf(phase),
              }"
            >
              <span>{{ i + 1 }}</span
              >{{ label }}
            </li>
          </ol>
          <div v-if="phase === 'interview'" class="two-column">
            <form class="panel form-panel" @submit.prevent="makePlan">
              <div class="panel-title">
                <span class="section-number">01</span>
                <h2>问题与发生时间</h2>
              </div>
              <label for="scenario">体验场景</label
              ><select id="scenario" v-model="scenario">
                <option v-for="s in samples" :key="s.id" :value="s.id">
                  {{ s.title }}
                </option>
              </select>
              <label for="symptom"
                >用自己的话描述问题
                <span class="optional">仅保存在当前案例</span></label
              ><textarea
                id="symptom"
                v-model="symptom"
                required
                maxlength="1000"
                rows="4"
                placeholder="例如：游戏时屏幕黑了一下，声音还在，随后恢复。"
              ></textarea>
              <div class="input-caption">
                不要填密码、密钥或私人文档内容。{{ symptom.length }}/1000
              </div>
              <div class="form-row">
                <div>
                  <label for="incident-time">大约发生在</label
                  ><input
                    id="incident-time"
                    v-model="incidentTime"
                    type="datetime-local"
                    required
                  />
                </div>
                <div>
                  <label for="timezone">时间所在时区</label
                  ><select id="timezone" v-model="timezone">
                    <option value="Asia/Hong_Kong">北京时间 UTC+8</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>
              <label class="checkbox-label"
                ><input
                  v-model="timeUnknown"
                  type="checkbox"
                />时间不确定，查看前后各 12 小时的样本</label
              >
              <label for="environment">设备使用环境</label
              ><select id="environment" v-model="environment">
                <option value="personal">个人电脑</option>
                <option value="workplace">单位 / 办公电脑</option>
                <option value="unknown">暂不确定</option>
              </select>
              <div class="form-actions">
                <span>下一步会先显示计划</span
                ><button
                  class="button primary"
                  :disabled="busy || !status"
                  type="submit"
                >
                  {{ busy ? "正在建立计划…" : "生成检查计划 →" }}
                </button>
              </div>
            </form>
            <aside class="context-column">
              <section class="panel sample-note">
                <span class="pill">SYNTHETIC CASE</span>
                <h2>{{ selectedSample.title }}</h2>
                <p>{{ selectedSample.description }}</p>
                <div class="sample-time">
                  样本时间<br /><strong>2026 年 11 月 12 日 10:03</strong
                  ><br />北京时间；存储告警样本时间未知。
                </div>
                <p>
                  默认窗口为前后各 10
                  分钟。修改时间后，窗口外的事件不会用于结论。
                </p>
              </section>
              <section class="quiet-note">
                <h3>这一轮会做什么</h3>
                <p>
                  只读取已打包的合成数据，用本地规则生成说明。不读取你的系统日志，不连接模型服务。
                </p>
                <p>
                  {{
                    status?.mode === "native-synthetic"
                      ? "桌面版案例存入本机 SQLite。"
                      : "浏览器演示只保存在内存，刷新后清空。"
                  }}
                </p>
              </section>
            </aside>
          </div>
          <template v-else-if="phase === 'plan' && active?.plan">
            <div class="two-column">
              <section class="panel plan-panel">
                <div class="panel-title">
                  <span class="section-number">02</span>
                  <h2>本轮只分析内置样本</h2>
                </div>
                <div class="plan-action">
                  <span class="action-icon">⌕</span>
                  <div>
                    <h3>样本 → 证据 → 规则报告</h3>
                    <p>{{ active.title }} · 1 个固定动作</p>
                    <code>demo.analyze_fixture</code>
                  </div>
                  <span class="pill muted">R0 · 离线</span>
                </div>
                <dl class="plan-details">
                  <div>
                    <dt>数据来源</dt>
                    <dd>已打包的合成 JSON；不访问当前电脑日志</dd>
                  </div>
                  <div>
                    <dt>时间范围</dt>
                    <dd>
                      {{ formatTime(active.incidentStartUtc) }}<br />至
                      {{ formatTime(active.incidentEndUtc) }}
                    </dd>
                  </div>
                  <div>
                    <dt>网络与权限</dt>
                    <dd>不联网 · 不提权 · 不修改系统</dd>
                  </div>
                  <div>
                    <dt>版本</dt>
                    <dd>
                      {{ active.plan.policyVersion }} /
                      {{ active.plan.adapterVersion }}
                    </dd>
                  </div>
                  <div>
                    <dt>计划摘要</dt>
                    <dd class="hash">{{ active.plan.hash }}</dd>
                  </div>
                </dl>
                <label class="checkbox-label consent"
                  ><input
                    v-model="approved"
                    type="checkbox"
                  />我确认以上范围，允许分析这份合成样本。</label
                >
                <div class="form-actions">
                  <button
                    class="button secondary"
                    :disabled="busy"
                    @click="phase = 'interview'"
                  >
                    返回修改</button
                  ><button
                    class="button primary"
                    :disabled="!approved || busy"
                    @click="run"
                  >
                    {{ busy ? "正在生成报告…" : "确认并开始 →" }}
                  </button>
                </div>
              </section>
              <aside class="quiet-note">
                <h3>计划为什么要先确认？</h3>
                <p>
                  同意绑定计划 ID、版本、范围和摘要。计划变化后，需要重新确认。
                </p>
                <p>
                  此版本的动作只做样本分析；真实 Windows
                  采集、第三方报告和后台进程尚未接入。
                </p>
                <span class="offline-dot">模型关闭，规则独立完成</span>
              </aside>
            </div>
          </template>
          <template v-else-if="phase === 'result' && active?.report">
            <section class="result-summary">
              <div>
                <span class="eyebrow">SYNTHETIC REPORT / 资料部分覆盖</span>
                <h2>
                  {{
                    active.report.findings.length
                      ? active.report.findings[0]!.title
                      : "当前证据不足，暂时无法判断"
                  }}
                </h2>
                <p>
                  已识别 {{ active.report.evidence.length }} 项样本证据、{{
                    active.report.findings.length
                  }}
                  条规则发现。没有核实任何真实硬件故障。
                </p>
              </div>
              <div class="export-actions">
                <button
                  class="button secondary"
                  :disabled="busy"
                  @click="preview('markdown')"
                >
                  预览 Markdown</button
                ><button
                  class="text-button"
                  :disabled="busy"
                  @click="preview('json')"
                >
                  预览 JSON ↗
                </button>
              </div>
            </section>
            <div class="two-column results">
              <div>
                <section class="panel">
                  <div class="panel-title">
                    <span class="section-number">01</span>
                    <h2>发现什么</h2>
                  </div>
                  <div
                    v-if="!active.report.findings.length"
                    class="empty-state small"
                  >
                    <span>○</span>
                    <h3>没有足够的匹配证据</h3>
                    <p>这不代表电脑正常。请结合右侧缺失来源查看。</p>
                  </div>
                  <article
                    v-for="f in active.report.findings"
                    :key="f.id"
                    class="finding"
                  >
                    <div class="finding-rule">{{ f.ruleId }}</div>
                    <h3>{{ f.title }}</h3>
                    <p>{{ f.observation }}</p>
                    <div class="evidence-refs">
                      <a v-for="id in f.evidenceIds" :key="id" :href="`#${id}`"
                        >↳ {{ id }}</a
                      >
                    </div>
                    <div class="strength">证据强度：{{ f.strength }}</div>
                    <ul>
                      <li v-for="l in f.limitations" :key="l">{{ l }}</li>
                    </ul>
                    <div class="next-step">
                      <strong>下一步</strong>
                      <p>{{ f.nextStep }}</p>
                    </div>
                  </article>
                </section>
                <section class="panel timeline">
                  <div class="panel-title">
                    <span class="section-number">02</span>
                    <h2>证据与出处</h2>
                  </div>
                  <p v-if="!active.report.evidence.length" class="muted-text">
                    本样本没有可展开的事件；未生成虚构记录。
                  </p>
                  <details
                    v-for="e in active.report.evidence"
                    :id="e.id"
                    :key="e.id"
                  >
                    <summary>
                      <span class="timeline-dot"></span
                      ><span
                        ><strong
                          >{{ e.provider ?? "存储健康证据" }}
                          <span v-if="e.eventId"
                            >/ {{ e.eventId }}</span
                          ></strong
                        ><small
                          >{{ formatTime(e.observedAtUtc) }} · {{ e.id }}</small
                        ></span
                      ><span class="detail-caret">＋</span>
                    </summary>
                    <dl class="evidence-detail">
                      <div>
                        <dt>来源</dt>
                        <dd>{{ e.source }}（合成）</dd>
                      </div>
                      <div>
                        <dt>定位</dt>
                        <dd>
                          {{ e.channel ?? "统一证据" }} / RecordID
                          {{ e.recordId ?? "未知" }} / schema
                          {{ e.schemaVersion ?? "未知" }}
                        </dd>
                      </div>
                      <div>
                        <dt>实体</dt>
                        <dd>
                          {{ e.entity ?? "未知" }} /
                          {{ e.bootSession ?? "启动会话未知" }}
                        </dd>
                      </div>
                      <div v-for="(value, key) in e.fields" :key="key">
                        <dt>{{ key }}</dt>
                        <dd>
                          {{
                            /serial/i.test(key)
                              ? "REDACTED_1（本页隐藏）"
                              : value
                          }}
                        </dd>
                      </div>
                    </dl>
                  </details>
                </section>
              </div>
              <aside>
                <section class="panel coverage-panel">
                  <h2>本轮覆盖</h2>
                  <p>覆盖度不是诊断准确率。</p>
                  <div
                    v-for="c in active.report.coverage"
                    :key="c.source"
                    class="coverage-item"
                  >
                    <strong>{{ c.source }}</strong
                    ><span :class="['coverage-badge', c.status]">{{
                      coverageLabels[c.status]
                    }}</span>
                    <p>{{ c.detail }}</p>
                  </div>
                </section>
                <section class="unknown-panel">
                  <span class="eyebrow">KEEP THE UNKNOWNS</span>
                  <h2>目前还不能判断</h2>
                  <ul>
                    <li v-for="u in active.report.unknowns" :key="u">
                      {{ u }}
                    </li>
                  </ul>
                </section>
                <p class="report-meta">
                  规则 {{ active.report.ruleVersion }}<br />{{
                    formatTime(active.report.generatedAtUtc)
                  }}<br />模型关闭 · 无外部请求
                </p>
              </aside>
            </div>
          </template>
        </template>

        <template v-else-if="page === 'history'">
          <div class="page-heading">
            <div>
              <div class="eyebrow">CASE LIBRARY</div>
              <h1 ref="heading" tabindex="-1">每次排查，都留有来处。</h1>
              <p>
                {{
                  status?.mode === "native-synthetic"
                    ? "桌面案例存于本机 SQLite；本预览版暂不自动清理。"
                    : "浏览器案例仅保留在内存；刷新页面会清空。"
                }}
              </p>
            </div>
            <button class="button primary" @click="begin()">
              ＋ 新建样本诊断
            </button>
          </div>
          <div v-if="!cases.length" class="panel empty-state">
            <span>◷</span>
            <h2>还没有诊断案例</h2>
            <p>从一个合成场景开始，看看证据如何变成解释。</p>
            <button class="button secondary" @click="begin()">
              体验第一个案例 →
            </button>
          </div>
          <div v-else class="panel history-list">
            <article v-for="c in cases" :key="c.id">
              <div class="history-icon">⌕</div>
              <div>
                <h3>{{ c.title }} <span class="pill muted">合成样本</span></h3>
                <p>
                  {{
                    c.report
                      ? "规则报告已生成 · 真实数据未覆盖"
                      : c.status === "interrupted"
                        ? "上次计划已中断，请重新确认"
                        : "等待预览与确认计划"
                  }}
                </p>
                <small>{{ formatTime(c.createdAtUtc) }}</small>
              </div>
              <div class="history-actions">
                <button
                  class="button secondary"
                  :disabled="busy"
                  @click="openCase(c)"
                >
                  打开案例</button
                ><button
                  class="text-button danger-text"
                  :disabled="busy"
                  @click="pendingDelete = c.id"
                >
                  删除
                </button>
              </div>
            </article>
          </div>
        </template>

        <template v-else-if="page === 'tools'">
          <div class="page-heading">
            <div>
              <div class="eyebrow">TOOLS & PROVENANCE</div>
              <h1 ref="heading" tabindex="-1">能力有边界，来源要清楚。</h1>
              <p>首发规划以系统已有证据和报告导入为主，按动作逐项验收。</p>
            </div>
          </div>
          <div class="tool-grid">
            <section
              v-for="tool in [
                {
                  name: 'Windows 日志与系统概况',
                  mode: '固定只读采集',
                  state: '开发中 · 当前不执行',
                  desc: '规划 System / Application 时间窗口与系统概况，不采集 Security 日志。',
                  url: 'https://learn.microsoft.com/powershell/module/microsoft.powershell.diagnostics/get-winevent',
                },
                {
                  name: 'CrystalDiskInfo',
                  mode: '文本报告导入',
                  state: '待实现 / 真实格式未验收',
                  desc: '用户自行获取工具并生成报告。当前不下载、不安装、不打包程序。',
                  url: 'https://crystalmark.info/en/software/crystaldiskinfo/',
                },
                {
                  name: 'smartctl',
                  mode: 'JSON 报告导入',
                  state: '待实现 / 真实格式未验收',
                  desc: '规划区分 ATA / NVMe 字段与退出码位掩码，不把所有非零退出码当成启动失败。',
                  url: 'https://www.smartmontools.org/',
                },
              ]"
              :key="tool.name"
              class="panel tool-card"
            >
              <span class="pill muted">{{ tool.mode }}</span>
              <h2>{{ tool.name }}</h2>
              <div class="tool-state">{{ tool.state }}</div>
              <p>{{ tool.desc }}</p>
              <a :href="tool.url" target="_blank" rel="noopener noreferrer"
                >访问官方说明 ↗</a
              >
            </section>
          </div>
          <div class="quiet-note wide">
            <h3>复用策略</h3>
            <p>
              计划选择性参考 Pulse 的解释、关联、脱敏结构，以及 PC-AI
              的只读查询思路。当前未迁入上游代码；研究结论不代表已完成许可与实机验收。HWiNFO、压力测试、修复和管理员助手未开放。
            </p>
          </div>
        </template>

        <template v-else>
          <div class="page-heading">
            <div>
              <div class="eyebrow">PREFERENCES & ABOUT</div>
              <h1 ref="heading" tabindex="-1">先把默认值设得安心。</h1>
              <p>Sentinel PC · 离线预览 0.1.0</p>
            </div>
          </div>
          <section class="panel settings-panel">
            <div>
              <h2>模型服务</h2>
              <span class="pill muted">已关闭</span>
              <p>本版本未接入任何模型，不需要 API Key，也不会发送诊断资料。</p>
            </div>
            <div>
              <h2>案例存储</h2>
              <p>
                {{
                  status?.mode === "native-synthetic"
                    ? "本机应用数据目录中的 SQLite。可在案例记录页逐个删除；30 天自动保留策略尚未实现。"
                    : "当前浏览器内存。刷新或关闭页面后清空；不写入 localStorage。"
                }}
              </p>
            </div>
            <div>
              <h2>报告分享</h2>
              <p>
                先预览，再下载。默认省略问题描述和原始附件，替换合成序列号；完整自由文本脱敏尚待
                C10 验收。
              </p>
            </div>
            <div>
              <h2>当前版本边界</h2>
              <p>
                已接入合成样本与本地规则。真实 Windows 采集、第三方报告
                Parser、后台进程取消、独立安装与性能验收仍待完成。
              </p>
            </div>
          </section>
        </template>
        <footer class="page-footer">
          <span>Sentinel PC · 有依据，也有边界。</span
          ><span>PREVIEW 0.1 / 合成样本</span>
        </footer>
      </main>
    </div>

    <div
      v-if="exportData"
      class="modal-backdrop"
      @click.self="exportData = undefined"
    >
      <section
        class="modal export-modal"
        @keydown="trapFocus"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        @keydown.esc="exportData = undefined"
      >
        <div class="modal-header">
          <div>
            <span class="eyebrow">REVIEW BEFORE SHARING</span>
            <h2 id="export-title">导出预览</h2>
          </div>
          <button
            class="icon-button"
            aria-label="关闭导出预览"
            @click="exportData = undefined"
          >
            ×
          </button>
        </div>
        <p>
          已省略问题描述、同意令牌和原始附件。请检查内容，可在下方继续删除文字。
        </p>
        <label class="sr-only" for="export-text">可编辑的导出内容</label
        ><textarea
          id="export-text"
          v-model="exportText"
          spellcheck="false"
        ></textarea>
        <div class="modal-footer">
          <span>{{ exportData.filename }}</span
          ><button class="button primary" @click="download">下载文件 ↓</button>
        </div>
      </section>
    </div>
    <div v-if="pendingDelete" class="modal-backdrop">
      <section
        class="modal delete-modal"
        @keydown="trapFocus"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        @keydown.esc="pendingDelete = undefined"
      >
        <h2 id="delete-title">删除这条案例？</h2>
        <p>
          案例、报告和关联同意记录会从当前存储删除。此操作不能撤销；不承诺磁盘上的安全擦除。
        </p>
        <div class="modal-footer">
          <button class="button secondary" @click="pendingDelete = undefined">
            保留案例</button
          ><button class="button danger" :disabled="busy" @click="removeCase">
            确认删除
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
