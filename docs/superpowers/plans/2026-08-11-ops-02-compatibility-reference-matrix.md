# OPS-02 Compatibility Device Accessibility and Performance Reference Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本轮执行模式（用户指令）**：不派 Agent / Reviewer / SDD workflow。由当前 Claude 主会话直接实施（fast inline implementation）。仅调用一次 superpowers:writing-plans（本计划）；禁止其他 Superpowers skill。

**Goal:** 落实 OPS-02 兼容/设备/可访问性/性能参考验证——建立可重复验证的 SDK reference fixture、Vue/React 参考集成、Console reference target、browser compatibility matrix、代表 device/viewport matrix、accessibility validation、performance reference harness，并接入 GitHub CI 矩阵与证据。

**本计划关闭 1 个叶子：OPS-02。**
**本计划不关闭 OPS-01（已完成）、G15、G16、OPS-05。**

**预期状态（OPS-02 特例）：**
- 本地实施 + 核心 Chromium smoke PASS 后：`OPS-02 implementation = completed`、`OPS-02 acceptance = remote-pending`、`G14 = release-pending`，**计数保持 62 / 16**。
- 真实 GitHub Actions 完整兼容矩阵（nightly/release）成功证据获得后：`OPS-02 = completed`、`G14 = completed`、`completed 62 → 63 / remaining 16 → 15`，随后才解锁 G15。
- **本地实现通过 ≠ OPS-02 最终关闭**；OPS-02 的叶子验收目标本身是 CI 兼容矩阵。

## Global Constraints

- **不创建新 ADR**：GitHub Actions 已在 approved testing/deployment design（OPS-01 spec §11）；browser 矩阵数值由兼容文档维护（testing/deploy §16.2 #7），不是 ADR。
- **不新增产品功能**、不修改 SDK 公共行为、不修改 wire protocol、不重做 G07/Console、不创建生产监控能力、不实现 G15 发布工程、不实现 G16 基础设施。
- Reference fixture 只用于兼容验证，不得演变成新的产品应用；不新增假数据（fixture 只使用合成数据与 stub transport）。
- **本地测试预算**（§11）：只允许 A) reference fixture unit/config 测试；B) 1 条 Chromium SDK core smoke；C) 1 条 Chromium Vue smoke；D) 1 条 Chromium React smoke；E) 1 条 Chromium Console accessibility/reference smoke。
- **本地禁止**：Firefox/WebKit、完整 device matrix、完整 performance benchmark、root `pnpm test`、root `pnpm test:coverage`、PostgreSQL/Redis、Platform API 全套。
- **完整兼容矩阵**（Chromium/Firefox/WebKit + 代表 device/viewport + accessibility + performance）只放 nightly / release CI；PR 只保留核心 Chromium compatibility smoke。
- 优先扩展现有 OPS-01 workflow，**不创建第二套平行 CI**；避免 3 browsers × 全部页面 × 全部 device 的机械笛卡尔积，使用最小代表性交叉矩阵。
- 不删除、跳过或弱化现有 PR/main gates；不降低质量门槛；不用 flaky timing 作硬断言（性能用固定环境 + p95 稳健采样 + 仅 release 运行）。
- 不派 Agent/Reviewer；不自动 skill chaining。

## 固定回读与权威边界

| Module | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --- | --- | --- | --- | --- |
| OPS-02 | [测试规范](../../Aurora%20测试规范.md) | §4.4 TEST-004 真实浏览器、§4.5、§4.8 TEST-007 覆盖率、§4.9 TEST-008 CI 阻断 | 浏览器兼容范围由 SDK 专项规范定义，测试只验证已声明范围；PR 至少核心真实浏览器测试；发布前完整支持矩阵 | 无（范围已批准） |
| OPS-02 | [测试策略](../../testing/test-strategy.md) | §4 兼容矩阵、§5 性能预算、§6 SLO | 桌面 Chrome/Edge/Firefox 最近两个稳定主版本、Safari 最近两个主版本；移动 iOS Safari 最近两个主版本、Android Chrome 当前+前一稳定主版本；WCAG 2.2 AA；预算为发布门槛非已测结果 | 精确版本表/真实设备 `requires-benchmark`（TDR-GAP-06，非本轮） |
| OPS-02 | [测试/部署/发布设计](../../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) | §8 兼容性/可访问性/量化性能预算、§7 CI 分级 | 正式浏览器承诺；WCAG 2.2 AA；SDK 体积/运行开销/SPA 预算；nightly=更重浏览器证据、release=完整支持矩阵 | 真实 Safari/移动设备证据（TDR-GAP-06，非本轮） |
| OPS-02 | [视觉语言](../../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md) | §8 可访问性基线、§9 组件与质量门禁 | WCAG 2.2 AA 对比度目标；Playwright/axe 覆盖键盘、焦点、缩放、Drawer、RouteTarget；有限截图回归 | 无 |
| OPS-02 | [SDK 架构](../../architecture/sdk-architecture.md) | §7 兼容与性能预算、§8 验证门禁 | SDK 宿主安全与隐私默认；初始化/宿主开销预算；Vue/React 示例 | 精确框架版本/参考工程 `requires-benchmark` |
| OPS-02 | [OPS-01 CI 规格](../../architecture/ci-quality-workflows.md) | §4 工作流分层、§6 浏览器验证 | PR/main/nightly/release 分层；完整矩阵属 OPS-02；禁止 arbitrary retry | 无 |
| OPS-02 | [批次基线](../../architecture/aurora-v1-remaining-module-batches.md) | §5.7 OPS-02 行、§6 G14、§10 覆盖矩阵 | reference app 不演变成产品；OPS-02 不关闭 OPS-01 | 无 |
| OPS-02 | [FORM](../../architecture/formalization-readiness.md) | §10 兼容/性能门禁快照 | 预算为设计预算非已测结果；不扩大公开支持承诺 | 无 |

**本计划依据的 approved 数值（唯一来源，不自行发明）：**

| 维度 | approved 来源 | 数值 |
| --- | --- | --- |
| 桌面浏览器 | test-strategy §4 / testing-deploy §8.1 | Chrome、Edge、Firefox 最近两个稳定主版本；Safari 最近两个主版本；不支持 IE |
| 移动浏览器 | test-strategy §4 / testing-deploy §8.1 | iOS Safari 最近两个主版本；Android Chrome 当前+前一稳定主版本 |
| 自动化引擎 | test-strategy §4 | Playwright Chromium/Firefox/WebKit |
| 可访问性 | test-strategy §4 / testing-deploy §8.2 / 视觉语言 §8 | WCAG 2.2 AA；axe + 人工键盘/焦点/缩放/屏幕阅读器 |
| SDK 初始化 | test-strategy §5 / testing-deploy §8.4 | 桌面 p95 ≤ 20 ms；中档移动 p95 ≤ 50 ms |
| SDK 宿主开销 | test-strategy §5 / testing-deploy §8.4 | 无单次 SDK 归因 >50 ms Long Task；稳态附加 Heap ≤ 5 MiB；包装 p95 ≤ 1 ms |
| SDK 包体积 | test-strategy §5 / testing-deploy §8.3 | Core ≤10 KiB、Browser+Core ≤30 KiB、插件增量 ≤8 KiB、框架增量 ≤5 KiB gzip（本轮不强制，报告式，最终 tree-shaken 属 G15） |

**deferred（本计划不实施，记录于 spec）：** 真实 Safari/移动设备提供方证据（TDR-GAP-06）、精确版本表、完整 Lighthouse CI、真实用户 INP、包体积最终 tree-shaken 门禁（G15）。

## 命令真值表（本轮新增/修改，本地只跑被允许子集）

| 命令 | 用途 | 本地 | CI 位置 |
| --- | --- | --- | --- |
| `pnpm --filter @aurora/sdk-reference test` | reference matrix 契约单元测试 | ✅（A） | PR/nightly/release |
| `pnpm --filter @aurora/sdk-reference test:browser` | SDK reference Chromium core smoke | ✅（B） | PR/nightly/release |
| `pnpm --filter @aurora/plugin-vue test:browser` | Vue reference Chromium smoke | ✅（C） | nightly/release |
| `pnpm --filter @aurora/plugin-react test:browser` | React reference Chromium smoke | ✅（D） | nightly/release |
| `pnpm --filter @aurora/console test:browser` | Console Chromium a11y/reference smoke | ✅（E） | nightly/release |
| `pnpm --filter @aurora/sdk-reference test:matrix` | SDK reference 全引擎 + 设备矩阵 | ❌ | nightly/release |
| `pnpm --filter @aurora/plugin-vue test:matrix` | Vue 全引擎矩阵 | ❌ | nightly/release |
| `pnpm --filter @aurora/plugin-react test:matrix` | React 全引擎矩阵 | ❌ | nightly/release |
| `pnpm --filter @aurora/console test:matrix` | Console 全引擎 + 设备 + axe 矩阵 | ❌ | nightly/release |
| `pnpm --filter @aurora/sdk-reference test:performance` | 固定性能参考 harness | ❌ | release |

## 文件结构映射

```text
examples/
└── sdk-reference/                      # 新增：SDK reference fixture（`@aurora/sdk-reference`）
    ├── package.json                    # aurora.layer: sdk-reference
    ├── README.md
    ├── tsconfig.json
    ├── tsconfig.build.json
    ├── vitest.config.ts
    ├── playwright.config.ts            # 5 projects：chromium/firefox/webkit desktop + pixel5/iphone14
    ├── playwright.performance.config.ts
    ├── src/
    │   ├── matrix.ts                   # 可执行 matrix 契约（approved 类/阈值/CI 位置）
    │   └── fixture-server.ts           # 参考页面（importmap → 各包 dist）
    ├── test/
    │   └── matrix-contract.test.ts     # 契约单元测试
    └── test-browser/
        ├── sdk-reference.spec.ts       # 完整组合跨引擎兼容 smoke
        └── performance.spec.ts         # 固定性能 harness

apps/console/
    └── playwright.matrix.config.ts     # 新增：console 全引擎+设备+axe 代表矩阵

packages/plugin-vue/playwright.config.ts  # 修改：加 firefox/webkit projects
packages/plugin-react/playwright.config.ts # 修改：加 firefox/webkit projects

tooling/workspace-policy/src/graph.ts       # 修改：加 sdk-reference 层
tooling/workspace-policy/test/dependency-policy.test.ts # 修改：加 sdk-reference 层测试

.github/workflows/pr.yml      # 修改：加核心 Chromium smoke job
.github/workflows/nightly.yml # 修改：加 browser-matrix job
.github/workflows/release.yml # 修改：加 browser-matrix + performance jobs

docs/architecture/compatibility-reference-matrix.md  # 新增：OPS-02 正式规格
docs/superpowers/plans/2026-08-11-ops-02-compatibility-reference-matrix.md  # 本计划
```

## Tasks

### Task 1：reference fixtures + matrix contract

**Inputs:** test-strategy §4—5、testing-deploy §8、OPS-02 固定回读；仓库既有 `examples/*` workspace glob。

**Actions:**
- 新建 `examples/sdk-reference/` 包（`@aurora/sdk-reference`，`aurora.layer: sdk-reference`，private）：
  - `package.json`：满足 workspace-policy 必填字段（private/type/exports/files/engines/scripts/aurora）；依赖 `@aurora/browser`/`@aurora/sdk`/`@aurora/core`/`@aurora/event-schema`/`@aurora/plugin-error`/`@aurora/plugin-request`/`@aurora/plugin-performance`（workspace:*）；devDeps `@playwright/test`、`vitest`、`@vitest/coverage-v8`（沿用仓库版本）；scripts：`build`/`typecheck`/`test`/`test:coverage`/`test:package`/`test:browser`（chromium-desktop 单 project）/`test:matrix`（全 projects）/`test:performance`；
  - `src/matrix.ts`：可执行 matrix 契约——`REFERENCE_MATRIX`（browsers `['chromium','firefox','webkit']`、deviceViewports `desktop/mobileAndroid(Pixel5)/mobileIos(iPhone14)`、performanceBudget `initDesktopMs:20/initMobileMs:50/longTaskMs:50/heapMiB:5`、accessibility `standard:'WCAG 2.2 AA', violations:0`、ciPlacement `pr:'chromium-core', nightly:'engines+devices+a11y', release:'+performance'`）；只冻结 approved 数值，不自行发明；
  - `src/fixture-server.ts`：仿 `packages/plugin-vue/test-browser/fixture-server.ts` 模式，serving 参考页面 HTML（importmap → browser/core/sdk/event-schema/plugin-*/dist），页面内组合 `createAuroraSdk({ config, plugins: [error, request, performance], transport: stub })`，暴露 `window.__auroraReference` harness（init/destroy/triggerError/triggerRequest/measureInit）；
  - `playwright.config.ts`：5 projects（chromium-desktop、firefox-desktop、webkit-desktop、chromium-android(Pixel5)、webkit-ios(iPhone14)）；`test:browser` 用 `--project=chromium-desktop`；
  - `vitest.config.ts` + `test/matrix-contract.test.ts`：断言 `REFERENCE_MATRIX` 与 approved 来源逐项一致（浏览器类/设备类/阈值/可访问性/CI 位置）；
  - `tsconfig.json`/`tsconfig.build.json`（沿用 plugin-vue 风格，含 test-browser）。
- workspace-policy：`graph.ts` 新增 `['sdk-reference', new Set(['sdk-core','sdk-browser','sdk-plugin','protocol'])]`；`environment.ts` 不列入宿主限制集合（reference 是消费方）；`dependency-policy.test.ts` 增加 `sdk-reference` 允许/拒绝层测试。
- 新增正式规格 `docs/architecture/compatibility-reference-matrix.md`（OPS-02，approved + implemented）：固定回读表、范围/非目标、approved matrix（browser/device/a11y/performance）、CI 位置、完成定义（含真实 GitHub Actions 全矩阵 PASS）、deferred 清单。
- 根 `package.json`：`format:check`/`lint` 增加 examples/sdk-reference 路径。

**Expected result:** `examples/sdk-reference` 真实存在并可构建；matrix 契约与 approved 数值一致；`sdk-reference` 层生效；OPS-02 正式规格落档。

**Verification:**
- `pnpm --filter @aurora/sdk-reference test`（matrix 契约单元测试，本地 A）✅
- `pnpm --filter @aurora/sdk-reference build` ✅
- `pnpm check:boundaries` ✅
- `pnpm --filter @aurora/workspace-policy test` ✅

### Task 2：SDK / Vue / React reference validation

**Inputs:** plugin-vue/plugin-react 已批准适配规格（§11 完整矩阵留给 OPS-02）、现有 test-browser fixture。

**Actions:**
- `examples/sdk-reference/test-browser/sdk-reference.spec.ts`：完整组合（error+request+performance 插件 + stub transport）——load 参考页 → triggerError/triggerRequest → 标准事件经统一管道到达 transport；宿主不破坏；destroy 后 harness 幂等。
- `packages/plugin-vue/playwright.config.ts`：projects 扩为 `chromium-desktop`/`firefox-desktop`/`webkit-desktop`；`package.json` 的 `test:browser` 改为 `playwright test --config playwright.config.ts --project=chromium-desktop`，新增 `test:matrix`（全 projects）。
- `packages/plugin-react/playwright.config.ts` + `package.json`：同上。
- 不改 adapter 任何 src 逻辑（不重做 G07）；只做矩阵接线。

**Expected result:** SDK/Vue/React 参考验证在 chromium 本地绿；矩阵项目在 CI 可跨引擎重跑。

**Verification（本地只跑 Chromium，禁 Firefox/WebKit）：**
- `pnpm --filter @aurora/sdk-reference test:browser`（B）✅
- `pnpm --filter @aurora/plugin-vue test:browser`（C）✅
- `pnpm --filter @aurora/plugin-react test:browser`（D）✅
- `pnpm --filter @aurora/plugin-vue typecheck`、`pnpm --filter @aurora/plugin-react typecheck` ✅

### Task 3：Console + accessibility reference validation

**Inputs:** 视觉语言 §8—9、console 现有 axe/reachability/focus 测试、testing-deploy §8.2。

**Actions:**
- `apps/console/playwright.matrix.config.ts`：5 projects（chromium/firefox/webkit desktop + Pixel5 + iPhone14），`testMatch` 只选代表参考 spec（`axe`/`reachability`/`focus`/`license`），避免 3 浏览器 × 全部页面机械爆炸。
- `apps/console/package.json`：新增 `test:matrix` = `pnpm build:test && playwright test --config playwright.matrix.config.ts`；`test:browser` 保持 chromium-only 不变。
- **复用现有 axe 基础设施**，不重建 accessibility 系统：确认 console axe spec 已断言 `violations` 为 0（WCAG 2.2 AA 自动门槛）；matrix 只验证参考页面，不扫描整个网站。
- 若 `axe.spec.ts` 需要覆盖代表参考路由（C1/C2/C7），只做最小扩展；不新增业务逻辑。

**Expected result:** Console reference target 在 chromium 本地绿（含 axe）；矩阵项目在 CI 跨引擎 + 设备跑代表参考/a11y spec。

**Verification（本地）：**
- `pnpm --filter @aurora/console test:browser`（E，chromium axe/reference）✅
- `pnpm --filter @aurora/console typecheck` ✅

### Task 4：performance reference harness

**Inputs:** test-strategy §5、testing-deploy §8.4、visual §8。

**Actions:**
- `examples/sdk-reference/playwright.performance.config.ts`：固定环境 chromium-desktop（桌面档）+ Pixel5（中档移动档），较长 timeout。
- `examples/sdk-reference/test-browser/performance.spec.ts`：固定场景 + 固定采样——
  - 场景：加载参考页 → `createAuroraSdk` 完整初始化（含 `await start()`）→ 触发一个 error 事件 → flush → destroy；
  - 采样：每档 N=30 次，计算 p95（稳健，不做 flaky 硬断言）；
  - 指标：SDK 初始化 p95（桌面 ≤ 20 ms / 中档移动 ≤ 50 ms）；SDK 归因 >50 ms Long Task 计数（应为 0）；稳态附加 Heap ≤ 5 MiB（近似）；
  - 输出可重复 JSON 到 `.artifacts/reference/performance.json`（gitignored）；
  - **不得为了过 benchmark 修改 SDK 产品逻辑**；预算来自 approved 数值。
- 包体积 gzip 预算（Core/插件/框架增量）本轮**只记录为 deferred（G15 tree-shaken 门禁）**，不在本 harness 强制。

**Expected result:** 固定环境 + 固定场景 + 固定采样方法 + approved threshold + 可重复输出真实存在；release CI 可执行。

**Verification（本地不跑完整 benchmark）：**
- `pnpm --filter @aurora/sdk-reference test`（budget 常量契约测试，A 已覆盖）✅
- fixture-server 可启动 smoke（build + 启动一次）✅
- 完整测量留给 release CI（本地禁止）。

### Task 5：GitHub CI matrix wiring + docs/status

**Inputs:** OPS-01 workflow（pr/nightly/release）、ci-quality-workflows spec §4、本轮新增矩阵命令。

**Actions:**
- `.github/workflows/pr.yml`：新增 `browser` job——核心 Chromium compatibility smoke（`pnpm --filter @aurora/sdk-reference test:browser`，chromium-desktop）；不引入 Firefox/WebKit；保持 permissions 最小化。
- `.github/workflows/nightly.yml`：新增 `browser-matrix` job——`playwright install --with-deps chromium firefox webkit` 后跑 `sdk-reference test:matrix`、`plugin-vue test:matrix`、`plugin-react test:matrix`、`console test:matrix`；保留现有 browser job。
- `.github/workflows/release.yml`：新增 `browser-matrix` job（同 nightly）+ `performance` job（`sdk-reference test:performance`）。
- 避免并行重复系统；复用现有 job 结构与 action pinning；artifact retention 有界。
- 状态同步（**计数保持 62 / 16，不改为 63/15**；`OPS-02 implementation = completed / acceptance = remote-pending / G14 = release-pending`）：
  - `docs/architecture/formalization-readiness.md`：OPS-02 blocked → implemented-in-feature-branch / remote-pending；§10 快照加"参考矩阵已建立"证据行；
  - `docs/architecture/aurora-v1-remaining-module-batches.md`：§5.7 OPS-02 行 + §6 G14 状态 + §10 覆盖矩阵更新；
  - `AGENTS.md` / `AURORA_RULES.md`：新增 G14 OPS-02 状态条目（remote-pending）；
  - `docs/README.md`：新增 OPS-02 spec 映射。

**Expected result:** PR=核心 Chromium smoke；nightly/release=完整引擎+设备+a11y 矩阵 + release 性能；文档状态与计数一致。

**Verification（本地）：**
- workflow YAML 解析校验 ✅
- `pnpm format:check` ✅
- `pnpm lint` ✅
- `git diff --check` ✅

## 本地精简验收（§17）

1. `pnpm format:check` ✅
2. affected lint（`pnpm lint`）✅
3. affected typecheck（sdk-reference/plugin-vue/plugin-react/console/workspace-policy）✅
4. reference fixture/package-entry/build（`pnpm --filter @aurora/sdk-reference test` + `build`）✅
5. 核心 Chromium reference smoke（B/C/D/E 四条，Chromium-only）✅
6. affected CI config validation（workflow YAML 解析）✅
7. `git diff --check` ✅

**不跑：** root `pnpm test`、root `pnpm test:coverage`、Firefox/WebKit、完整 device matrix、完整 performance benchmark。

## 冲突自检（§18，实施前逐项确认）

- [ ] 不改变 SDK 业务行为（只加 reference fixture + CI 矩阵）
- [ ] 不修改 event-schema / wire protocol
- [ ] 不重复 G07（不碰 adapter src 逻辑）
- [ ] reference app 不做成产品（无业务能力、无真实数据、stub transport）
- [ ] 不降低现有 CI 门槛（保留全部现有 job；新增为增量）
- [ ] 不删除原有 PR/main gates
- [ ] 不创建平行 CI（扩展现有 OPS-01 workflow）
- [ ] 不把 browser/device matrix 扩大到无意义规模（最小代表交叉矩阵）
- [ ] 不自行发明 performance threshold（全部来自 approved 来源）
- [ ] 不让 flaky timing 成为硬断言（p95 稳健采样 + 固定环境 + 仅 release）
- [ ] 不越界进入 G15/G16

## 验收停点（OPS-02 Independent Acceptance）

OPS-02 关闭条件（本 spec §完成定义）：

- [ ] 正式规格 `docs/architecture/compatibility-reference-matrix.md` 存在（approved + implemented）
- [ ] 实施计划存在（本文件）
- [ ] `examples/sdk-reference` reference fixture 真实存在（matrix 契约 + 完整组合 fixture + 单测）
- [ ] Vue/React/Console 参考集成矩阵项目真实存在（chromium/firefox/webkit + 代表 device/viewport）
- [ ] accessibility 验证复用现有 axe infra（参考页 violations = 0）
- [ ] performance reference harness 真实存在（固定环境/场景/采样/approved threshold/JSON 输出）
- [ ] PR = 核心 Chromium smoke；nightly/release = 完整矩阵 + performance（release）
- [ ] **真实 GitHub Actions 完整兼容矩阵成功证据**（OPS-02 的叶子验收目标本身是 CI matrix）
- [ ] 无 secret 泄漏、无无关 diff、未降低既有门禁
- [ ] 文档/状态同步（remote-pending；计数保持 62/16，remote PASS 后 63/15）

**OPS-02 只在真实 GitHub Actions 完整矩阵 PASS 后正式关闭；本地实现通过 ≠ OPS-02 最终关闭。** remote PASS 前：`OPS-02 implementation = completed`、`OPS-02 acceptance = remote-pending`、`G14 = release-pending`、`completed/remaining = 62/16`。
