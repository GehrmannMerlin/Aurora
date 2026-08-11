---
title: Aurora 兼容/设备/可访问性/性能参考验证（OPS-02）
status: approved
implementation-status: implemented-in-feature-branch
owner: quality
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to:
  - examples/sdk-reference
  - packages/plugin-vue
  - packages/plugin-react
  - apps/console
  - .github/workflows
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 测试规范.md'
  - '../testing/test-strategy.md'
  - '../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md'
  - '../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md'
  - 'ci-quality-workflows.md'
  - 'aurora-v1-remaining-module-batches.md'
  - 'formalization-readiness.md'
  - '../adr/README.md'
  - '../sdk/sdk-architecture.md'
supersedes: none
review-cycle: compatibility-matrix-or-quality-policy-change
---

# Aurora 兼容/设备/可访问性/性能参考验证（OPS-02）

## 1. 定位与效力

本文正式化 Aurora 第一版兼容/设备/可访问性/性能参考验证（OPS-02）。它把 approved [测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) 第 8 节（兼容性、可访问性与量化性能预算）、[测试策略](../testing/test-strategy.md) 第 4—6 节（兼容矩阵、性能预算、SLO）和[视觉语言](../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md) 第 8—9 节（可访问性基线、质量门禁）落实为可重复验证的参考矩阵：SDK reference fixture、Vue/React 参考集成、Console reference target、browser compatibility matrix、代表 device/viewport matrix、accessibility validation、performance reference measurement 与 CI matrix wiring。

**OPS-02 不是性能优化项目**，不新增产品功能，不修改 SDK 公共行为，不修改 wire protocol。Reference fixture 只用于兼容验证，不演变成产品应用。

## 2. 目标与非目标

### 目标（A）

1. 建立可重复验证的 SDK reference fixture（完整组合：Core + Browser 环境 + 三个采集插件 + 可靠发送链 + stub transport）；
2. Vue / React 参考集成跨 Playwright 引擎可重复执行；
3. Console reference target 跨引擎 + 代表设备可重复执行，并复用现有 axe 基础设施做可访问性参考验证；
4. Browser compatibility matrix 与代表 device/viewport matrix 在 nightly/release CI 可重复运行，PR 只保留核心 Chromium smoke；
5. Performance reference harness 在固定环境、固定场景、固定采样方法下输出可重复结果并对照 approved threshold；
6. 复用现有 OPS-01 workflow，不创建平行 CI。

### 非目标（B）

- 不新增产品功能、不修改 SDK 公共行为、不修改 wire protocol、不重做 G07/Console；
- 不实现 G15 SDK 发布工程（包体积最终 tree-shaken 门禁属 G15）；
- 不实现 G16 基础设施、生产监控、CI/CD 部署；
- 真实 Safari / 移动设备证据（`TDR-GAP-06`）与精确版本表仍为 `requires-benchmark`，不由本地/CI 模拟矩阵替代；
- 不建立第二套 accessibility 系统，复用现有 `@axe-core/playwright`；只验证参考页面，不扫描整个网站；
- 完整性能基准（SLO/负载/积压）不属于 OPS-02，属于 release 阶段的后续证据。

## 3. 固定回读与权威边界

| Module ID | 完整回读文件                                                                                      | 重点章节                    | 本规格不得改变的业务逻辑                                                         |
| --------- | ------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| OPS-02    | [测试规范](../../Aurora%20测试规范.md)                                                            | §4.4—4.8                    | 浏览器兼容范围由 SDK 专项规范定义；PR 至少核心真实浏览器测试；发布前完整支持矩阵 |
| OPS-02    | [测试策略](../testing/test-strategy.md)                                                           | §4—6                        | 桌面/移动浏览器承诺；WCAG 2.2 AA；性能预算为发布门槛非已测结果                   |
| OPS-02    | [测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) | §8                          | 正式浏览器承诺、可访问性目标、SDK 体积/运行开销预算                              |
| OPS-02    | [视觉语言](../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md)              | §8—9                        | WCAG 2.2 AA 对比度；Playwright/axe 覆盖键盘、焦点、缩放、Drawer、RouteTarget     |
| OPS-02    | [SDK 架构](../sdk/sdk-architecture.md)                                                            | §7—8                        | SDK 宿主安全与隐私默认；初始化/宿主开销预算                                      |
| OPS-02    | [OPS-01 CI 规格](ci-quality-workflows.md)                                                         | §4、§6                      | PR/main/nightly/release 分层；完整矩阵属 OPS-02；禁止 arbitrary retry            |
| OPS-02    | [批次基线](aurora-v1-remaining-module-batches.md)                                                 | §5.7 OPS-02 行、§6 G14、§10 | reference app 不演变成产品；OPS-02 不关闭 OPS-01                                 |
| OPS-02    | [FORM](formalization-readiness.md)                                                                | §10                         | 预算为设计预算非已测结果；不扩大公开支持承诺                                     |

## 4. Approved 矩阵（唯一来源，不自行发明）

| 维度         | approved 来源                                        | 数值                                                                       | 证据状态                                                                  |
| ------------ | ---------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 桌面浏览器   | test-strategy §4 / testing-deploy §8.1               | Chrome、Edge、Firefox 最近两个稳定主版本；Safari 最近两个主版本；不支持 IE | 设计已批准；真实 Safari/精确版本表 `requires-benchmark`                   |
| 移动浏览器   | test-strategy §4 / testing-deploy §8.1               | iOS Safari 最近两个主版本；Android Chrome 当前+前一稳定主版本              | 设计已批准；真实设备 `requires-benchmark`                                 |
| 自动化引擎   | test-strategy §4                                     | Playwright Chromium / Firefox / WebKit                                     | 本 OPS-02 建立 CI 矩阵                                                    |
| 可访问性     | test-strategy §4 / testing-deploy §8.2 / 视觉语言 §8 | WCAG 2.2 AA；axe + 人工键盘/焦点/缩放/屏幕阅读器                           | 自动 axe 门槛已建立（参考页 0 violations）；人工评审 `requires-benchmark` |
| SDK 初始化   | test-strategy §5 / testing-deploy §8.4               | 桌面 p95 ≤ 20 ms；中档移动 p95 ≤ 50 ms                                     | 本 OPS-02 建立固定测量 harness                                            |
| SDK 宿主开销 | test-strategy §5 / testing-deploy §8.4               | 无单次 SDK 归因 >50 ms Long Task；稳态附加 Heap ≤ 5 MiB                    | harness 报告；完整基准 release 阶段                                       |
| SDK 包体积   | test-strategy §5 / testing-deploy §8.3               | Core ≤10 KiB、Browser+Core ≤30 KiB、插件增量 ≤8 KiB、框架增量 ≤5 KiB gzip  | **deferred 到 G15**（最终 tree-shaken 门禁）                              |

## 5. 参考矩阵实现

### 5.1 SDK reference fixture（`examples/sdk-reference`）

- `@aurora/sdk-reference`（`aurora.layer: sdk-reference`，允许依赖 `sdk-core | sdk-browser | sdk-plugin | protocol`）：
  - `src/matrix.ts`：可执行 matrix 契约（browsers、deviceViewports、accessibility、performanceBudget、ciPlacement），逐项复制自 approved 来源；由 `test/matrix-contract.test.ts` 校验；
  - `src/fixture-server.ts`：参考页面（importmap → 各包 dist），组合 `createAuroraSdk` + 浏览器环境 + error/request/performance 插件 + stub transport，暴露 `window.auroraReferenceHarness`；
  - `playwright.config.ts`：5 projects（chromium/firefox/webkit desktop + Pixel5 + iPhone14）；
  - `playwright.performance.config.ts`：固定性能环境（Desktop Chrome + Pixel5），仅 release 运行；
  - `test-browser/sdk-reference.spec.ts`：完整组合跨引擎兼容 smoke（init → error → request → destroy，宿主安全）；
  - `test-browser/performance.spec.ts`：固定场景 30 次 init p95，输出 `.artifacts/reference/performance-*.json`；
- 脚本：`test`（matrix 契约）、`test:browser`（chromium-desktop 核心 smoke）、`test:matrix`（全引擎+设备）、`test:performance`（固定性能）。

### 5.2 Vue / React 参考集成

- `packages/plugin-vue/playwright.config.ts` 与 `packages/plugin-react/playwright.config.ts` 扩为 chromium/firefox/webkit desktop 三 project；
- `test:browser` 保持 chromium-desktop（本地/PR 预算），新增 `test:matrix`（全引擎，nightly/release）；
- 不修改 adapter 任何 src 逻辑（不重做 G07）。

### 5.3 Console reference target 与可访问性

- `apps/console/playwright.matrix.config.ts`：5 projects（三引擎 + Pixel5 + iPhone14），`testMatch` 只选代表参考/a11y spec（axe/focus/reachability/license），避免 3 引擎 × 全部页面 × 全部设备爆炸；
- `test:matrix` = `pnpm build:test && playwright test --config playwright.matrix.config.ts`；
- **复用现有 axe 基础设施**（`@axe-core/playwright`），`axe.spec.ts` 断言 `violations` 为空（WCAG 2.2 AA 自动门槛）；只验证参考页面，不扫描整个网站；人工键盘/焦点/缩放/屏幕阅读器评审仍为 `requires-benchmark`。

### 5.4 Performance reference

- 固定环境：Chromium Desktop Chrome（桌面档）+ Pixel 5（中档移动档）；
- 固定场景：`createAuroraSdk` 完整初始化（含 `await start()`）→ 触发一个错误事件 → flush → destroy；
- 固定采样：每档 30 次，计算 p95（稳健，非 flaky 硬断言；固定环境 + 仅 release 运行）；
- approved threshold：桌面 p95 ≤ 20 ms、中档移动 p95 ≤ 50 ms；
- 可重复输出：`.artifacts/reference/performance-<project>.json`（gitignored）；
- Long Task / Heap 预算由 harness 报告（观测证据），完整基准留 release 阶段；
- **不得为了过 benchmark 修改 SDK 产品逻辑**。

## 6. CI 位置

| 阶段    | 浏览器/兼容门禁                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| PR      | 核心 Chromium compatibility smoke（`sdk-reference test:browser`）                                                               |
| nightly | 完整矩阵：`sdk-reference` / `plugin-vue` / `plugin-react` / `console` `test:matrix`（chromium/firefox/webkit + 代表设备 + axe） |
| release | nightly 完整矩阵 + `sdk-reference test:performance`                                                                             |

复用 OPS-01 workflow（pr/nightly/release），不创建平行 CI；不删除、不弱化现有 PR/main gates；禁止 arbitrary retry 掩盖首失败；action version pinning；permissions 最小化。

## 7. 完成定义（completion）

OPS-02 完成当且仅当：

1. 本规格（approved）与实施计划存在；
2. `examples/sdk-reference` reference fixture 真实存在（matrix 契约 + 完整组合 fixture + 单测）；
3. Vue / React / Console 参考集成矩阵项目真实存在（chromium/firefox/webkit + 代表 device/viewport）；
4. accessibility 验证复用现有 axe infra（参考页 0 violations）；
5. performance reference harness 真实存在（固定环境/场景/采样/approved threshold/JSON 输出）；
6. PR = 核心 Chromium smoke；nightly/release = 完整矩阵 + performance（release）；
7. **真实 GitHub Actions 完整兼容矩阵成功证据**（OPS-02 的叶子验收目标本身是 CI matrix）；
8. 无 secret 泄漏、无无关 diff、未降低既有门禁；
9. 文档/状态同步（remote-pending；计数 62/16，remote PASS 后 63/15）。

**OPS-02 只在真实 GitHub Actions 完整矩阵 PASS 后正式关闭；本地实现通过 ≠ OPS-02 最终关闭。** remote PASS 前：`OPS-02 implementation = completed`、`OPS-02 acceptance = remote-pending`、`G14 = release-pending`、`completed/remaining = 62/16`。

## 8. ADR 判断

GitHub Actions 已在 approved testing/deployment design 与 OPS-01 spec 中存在；browser 矩阵数值由兼容文档维护（testing/deploy §16.2 #7），不是 ADR。**无需新 ADR。**

## 9. 明确 deferred

- 真实 Safari / 移动设备提供方证据与精确版本表（`TDR-GAP-06`）；
- 人工键盘/焦点/缩放/屏幕阅读器可访问性评审；
- 完整性能基准（SLO/负载/积压）、真实用户 INP；
- SDK 包体积最终 tree-shaken gzip 门禁（G15）；
- 生产监控、CI/CD 部署、G16 基础设施。
