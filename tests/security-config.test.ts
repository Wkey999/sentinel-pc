import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../src-tauri/tauri.conf.json";
import capability from "../src-tauri/capabilities/main.json";
describe("最小权限工程配置", () => {
  it("只有本地主窗口有显式 capability，无 remote/shell/fs 权限", () => {
    expect(capability.windows).toEqual(["main"]);
    expect(capability.local).toBe(true);
    expect(capability.permissions).toEqual(["allow-diagnostics"]);
    expect(config.app.security.capabilities).toEqual(["main-diagnostics"]);
    expect(JSON.stringify(capability)).not.toMatch(/shell:|fs:|remote/);
  });
  it("生产 CSP 不允许远程脚本/网络/对象/框架", () => {
    const csp = config.app.security.csp;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/https:|\*|unsafe-eval/);
  });
  it("应用命令纳入 AppManifest，并在后端复核窗口身份", () => {
    const build = readFileSync("src-tauri/build.rs", "utf8"),
      backend = readFileSync("src-tauri/src/lib.rs", "utf8");
    const names = [...backend.matchAll(/#\[tauri::command\]\s*fn (\w+)/g)].map(
      (m) => m[1]!,
    );
    expect(names).toHaveLength(9);
    for (const name of names) expect(build).toContain(`"${name}"`);
    expect((backend.match(/access\(&window\)\?/g) ?? []).length).toBe(
      names.length,
    );
    expect(backend).not.toMatch(
      /std::process|Command::new|plugin_shell|plugin_fs/,
    );
  });
});
