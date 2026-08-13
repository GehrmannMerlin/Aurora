# OPS-03 SDK Package Versioning and Release Engineering Implementation Plan

> **For agentic workers:** This plan is executed **inline by the current main Claude session** per the user's G15 directive (no subagents, no reviewer, no SDD workflow; only `superpowers:writing-plans` was authorized once). Steps use checkbox (`- [ ]`) syntax for tracking. Commit boundaries are logical and explicit in the Git section; do not commit after every micro-step.

**Goal:** Establish a real SDK package versioning, artifact, compatibility, size-gate and release/rollback engineering chain for the 9 public `@aurora/*` SDK/protocol packages, closing leaf OPS-03 (implementation = completed; formal leaf count remains `62/16` until G14 final integration closes, then `63/15 → 64/14`).

**User-approved decisions for G15 (from the Approval Package, 2026-08-11):**
- 决策 B — 独立包版本（independent package versions），各 public package 可独立升级；version bump / changelog / 依赖更新由 Changesets 或仓库现有等价机制管理（本计划采用仓库自建的 `tooling/release-tool` 等价机制）；协议版本由协议自身语义控制，不得因 npm package version 自动改变 wire protocol。
- 决策 F — registry 为公开 npm，scope `@aurora`；正式 public packages = 9 个（event-schema、core、sdk、browser、plugin-error、plugin-request、plugin-performance、plugin-vue、plugin-react）；其余 platform-*/ingestion-*/processing-store/internal tooling/apps 保持 private，不得发布。
- 决策 E — SemVer prerelease `alpha.N`/`beta.N` 使用 dist-tag `next`；稳定正式发布使用 `latest`；预发布不得覆盖 `latest`。
- 决策 G — `latest` 仅指向稳定版本；`next` 用于 alpha/beta/canary；坏版本 `npm deprecate` + 发布 corrected patch + 恢复/保持 `latest` 到最后已知稳定版本；禁止覆盖已发布 immutable version。

**Architecture:** A private `tooling/release-tool` package (`@aurora/release-tool`, modeled after existing `tooling/platform-contract-drift`, private, native TS CLI) provides the release contract engine: `validate`（public/private 契约与元数据一致）、`version`（独立版本 bump + `workspace:*` → 真实 semver range 改写 + CHANGELOG 生成）、`pack`（可复现 tarball 检查）、`compat`（SemVer/协议解耦门禁）、`size`（tree-shaken/gzip 体积门禁，esbuild）。版本/changelog 采用仓库自建的最小等价机制：`.changeset/*.md` 描述每个 public 包按 major/minor/patch 的变更。发布链扩展现有 `.github/workflows/release.yml`（OPS-01 预发布质量门禁），不建立第二套平行 CI。

**Tech Stack:** TypeScript strict（workspace 配置）、tsx（CLI 运行）、esbuild `^0.28.2`（新 root devDependency，tree-shaking 测量）、pnpm 11.17.0、Vitest 4.1.10、现有 `@aurora/event-schema` 协议常量（`CURRENT_PROTOCOL_VERSION`）与 9 个 public 包。

---

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
|---|---|---|---|---|
| OPS-03 | `AGENTS.md`；`AURORA_RULES.md`；`docs/architecture/aurora-v1-remaining-module-batches.md`（G15 定义）；`docs/releases/release-migration-and-rollback.md`（§1—6）；`docs/superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md`（§10.4、§14）；`docs/adr/ADR-001-use-monorepo.md`；`docs/adr/ADR-005-event-schema-source-of-truth.md`；`docs/adr/ADR-007-workspace-package-and-task-tooling.md`；`docs/architecture/monorepo-and-build.md`；`docs/architecture/sdk-architecture.md`；`docs/protocol/protocol-compatibility-boundary.md`（PRO-06）；`docs/testing/test-strategy.md`（§5 性能预算）；`docs/api/ingestion.openapi.yaml`（不动） | Release §5（SDK 发布）、§6（发布证据）；设计 §10.4（受保护 npm Environment/Trusted Publishing/provenance/坏版本 deprecated+补丁）、§14（发布职责与检查门禁）；ADR-001（统一/独立版本需另行决策——本计划按用户 G15 决策落实）；ADR-005（协议单一来源、版本兼容）；ADR-007（monorepo 工具链，发布属其他模块）；PRO-06（协议版本 `1`、破坏性变化需新 ADR）；test-strategy §5（approved 体积预算） | SDK runtime 行为；wire protocol；queue/transport/retry/flush；Vue/React adapter 行为；event wire schema；ingestion/platform backend；Console 产品功能；G16 基础设施 | 版本策略 ADR（本计划按用户 G15 批准的独立版本决策落实，不新增 ADR；版本决策记录在 release spec，后续如需长期冻结由用户决定是否升格 ADR） |

## Global Constraints

以下约束从用户 G15 指令与 approved 权威文档逐条复制，每个 Task 都隐含遵守：

- 只实现发布工程，不修改 SDK runtime 行为、queue、transport、Vue/React adapter、event wire schema、ingestion/platform backend、Console 产品功能、G16 基础设施。
- 9 个 public 包的真实 `package.json` 为准；不得擅自扩大公开包集合。
- private 包（platform-*/ingestion-*/processing-store/internal tooling/apps）不得发布。
- 协议版本（`CURRENT_PROTOCOL_VERSION = 1`）不得因 npm package version 改变；破坏性协议变化需新 ADR（PRO-06）。
- 已发布包不可覆盖；坏版本 `npm deprecate` + corrected patch + 恢复 dist-tag；禁止修改历史 tag 或伪造删除。
- prerelease（alpha/beta）→ dist-tag `next`；stable → `latest`；预发布不得覆盖 `latest`。
- npm/registry credential 当前不存在 → 记录 `LIVE_PUBLISH_CREDENTIAL_PENDING`；允许 workflow/dry-run/artifact evidence 完成，禁止伪造 publish success。
- 体积门禁使用 test-strategy §5 approved 预算：Core ≤ 10 KiB、Browser＋Core 最小接入 ≤ 30 KiB、插件增量 ≤ 8 KiB、Vue/React 适配增量 ≤ 5 KiB；不得自行修改阈值、删除功能或作弊 exclude。
- 发布安全：least privilege、protected environment、no secret echo、exact SHA/tag identity、immutable artifact identity、pinned/approved actions；禁止 `pull_request_target` 发布。
- 本地测试预算硬限制：仅 release-tool targeted tests、受影响 public 包 typecheck/build、package-entry、pack/tarball、consumer typecheck/build、SemVer/version 检查、size 检查、workflow YAML 静态校验、`git diff --check`；禁止 root `check`/test/coverage、PostgreSQL/Redis、platform/ingestion 测试、Console E2E、Chromium/Firefox/WebKit、G14 matrix、benchmark。
- Coverage 默认不跑；release-tool 若已有正式 threshold 且新增 executable TS 才跑一次该包 coverage。
- 机械 CI 错误（format/prettier/lint/简单 typecheck/workflow syntax）若由本轮 diff 引起允许一次最小 hotfix；明显既有 baseline 记为 `KNOWN_BASELINE_DEBT` 不阻塞。
- 代码规范：strict TS、外部输入 `unknown`、无 `any`/`Function`/`Object`/非空断言/静默 catch；文件 kebab-case、类型 PascalCase、函数/变量 camelCase、布尔 `is/has/can/should`；不创建 `utils/helpers/common/misc`；公共 API 最小。

---

## Task 1 — Release contract + package/version metadata

**Goal:** 建立 9 个 public 包的独立版本发布契约与元数据一致性；private 包强制执行不发布。

**Steps:**

- [ ] 1.1 新建私有工具包 `tooling/release-tool`（`@aurora/release-tool`，`private: true`，modeled after `tooling/platform-contract-drift`）：`package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`src/`、`test/`。脚本：`typecheck`、`build`、`test`、`cli`（tsx）。
- [ ] 1.2 定义公共契约常量与类型：`PUBLIC_PACKAGES`（9 个真实包名清单）、`PublicPackageContract`（name/version/private/exports/files/types/deps/peerDeps/publishConfig 校验规则）。
- [ ] 1.3 实现 `release-tool validate`（CLI 命令）：对每个 public 包校验
  - `name` 在 `@aurora/*` scope 且属于 PUBLIC_PACKAGES；
  - `private` 必须为 false 或缺失（可发布）；
  - `publishConfig.access === 'public'`；
  - `version` 为合法 SemVer（`0.0.0` 允许，首版未定版本）；
  - `exports["."]` 含 `types` 与 `import`（ESM-only 是既有 approved 架构）；
  - `types` 指向 `exports["."].types` 且文件存在；
  - `files` 包含 `dist`；若包根存在 `README.md` 则必须包含；若存在 `LICENSE*` 则必须包含；
  - `dependencies`/`peerDependencies` 值只允许 `workspace:` 或合法 semver range（禁止 `file:`/绝对路径/git URL）；`peerDependencies` 按 G07 批准（vue ^3.4.0；react ^18.3.0 + react-dom ^18.3.0）；
  - 依赖顺序合法：`dependencies` 指向的 `@aurora/*` 包必须在 public 集合（或 private 但允许——本集合全部 public）。
- [ ] 1.4 实现 `release-tool validate` 的 private 包强制执行：扫描 `packages/*`、`tooling/*`、`apps/*`，断言任何不在 PUBLIC_PACKAGES 中的 `@aurora/*` 包 `private === true` 且 `publishConfig` 未设 `access: public`。
- [ ] 1.5 修正 9 个 public 包元数据：
  - `private: true` → 移除 `private` 或置 false；新增 `"publishConfig": { "access": "public" }`；
  - `files` 补齐 `README.md`（event-schema、browser 当前缺失）；
  - `license` 字段暂不硬性要求（仓库无 LICENSE 决策，记为 `LICENSE_PENDING`，validate 对已存在的 license 仅做 SPDX 合法校验）；
  - 其余 `exports`/`types`/deps 结构不动（真实契约为准）。
- [ ] 1.6 实现 `release-tool version`（独立版本机制，仓库等价 Changesets）：
  - 读取 `.changeset/*.md`（frontmatter `{ "@aurora/xxx": "major|minor|patch" }`）；
  - 按依赖拓扑顺序对 public 包做 SemVer bump（纯函数，单元测试）；
  - 将 `workspace:*` 依赖改写为 `^<new-version>`（对已发布的 public 依赖）；
  - 生成/追加每包 `CHANGELOG.md`（格式：`## <version>` + changeset 描述）。
- [ ] 1.7 编写正式 release spec `docs/releases/sdk-package-versioning-and-release.md`：独立版本策略、public/private 边界、SemVer/prerelease/dist-tag、协议解耦、制品规则、发布与回滚流程、`LIVE_PUBLISH_CREDENTIAL_PENDING`、`LICENSE_PENDING` 记录。
- [ ] 1.8 更新 `docs/README.md`（文档索引）与 `AGENTS.md`/`AURORA_RULES.md` 状态（G15 实施完成，OPS-03 implementation = completed）。

**Targeted tests (Task 1):** release-tool 单测（validate 通过/失败、private 包拒绝、version bump 拓扑顺序、workspace:* 改写、CHANGELOG 生成）；`release-tool validate` 实际运行通过 9 个 public 包；`git diff --check`。

**Git:** logical commit `feat(release-tool): add package/version release contract (OPS-03 Task 1)`。

---

## Task 2 — Reproducible package artifacts + public package validation

**Goal:** 可复现 pack 制品 + tarball 内容检查 + 打包后消费者安装/类型/构建验证。

**Steps:**

- [ ] 2.1 实现 `release-tool pack`：对每个 public 包执行 `pnpm pack --pack-destination <tmp>`（或 `npm pack --dry-run` 等价），解析生成的 tarball 清单。
- [ ] 2.2 tarball 检查：必须包含 `dist/**`、`dist/**/*.d.ts`、`package.json`；若 `files` 声明则必须包含 README.md/LICENSE*；**不得包含** `src/`、`test/`、`test-browser/`、`coverage/`、`.env`、`*.map`（若未声明）、开发 fixture、临时文件；发布清单与源码目录一致。
- [ ] 2.3 消费者验证：因 G14 sdk-reference 未进 main，记录 `G14_CONSUMER_FIXTURE_PENDING`；在 `tooling/release-tool/test-fixtures/`（不进入产品代码，gitignored 或独立临时目录）创建最小 consumer fixture：临时目录安装打包后的 tarball（至少 event-schema、core、sdk、browser、4 个插件与 2 个 adapter 的代表集），`import` 每个 public entry → `tsc --noEmit` → `tsc -p tsconfig.build.json` 构建通过。
- [ ] 2.4 在 release-tool 增加 `test:package`-风格验证：对 9 个 public 包执行仓库既有 `test:package`（build + package-entry 运行时导出校验），并补齐 plugin-vue/plugin-react 的 package-entry 覆盖（当前 release.yml 只列了 6 个）。
- [ ] 2.5 验证内部 workspace 包不会被误发布：`release-tool pack` 明确排除非 public 包（不生成其 tarball）；`validate` 已保证 private 包无 `access: public`。

**Targeted tests (Task 2):** pack 单测（tarball 包含/排除断言）；consumer fixture typecheck+build 通过；9 包 `test:package` 通过（新增 plugin-vue/react）；`git diff --check`。

**Git:** logical commit `feat(release-tool): pack inspection + packed-consumer validation (OPS-03 Task 2)`。

---

## Task 3 — Compatibility + tree-shaken/gzip size gate

**Goal:** SemVer/协议兼容门禁与 approved 体积门禁真实可执行。

**Steps:**

- [ ] 3.1 实现 `release-tool compat`（SemVer/协议解耦门禁）：
  - 对每个 public 包，校验 `exports` 子路径不悬挂（声明路径在 `files` 内、目标文件存在）、`types` 文件存在；
  - 协议解耦：加载 `@aurora/event-schema` 构建产物，断言 `CURRENT_PROTOCOL_VERSION === 1` 且 `SUPPORTED_PROTOCOL_VERSIONS` 未变（npm version bump 不得改变 wire protocol；PRO-06）；
  - 依赖一致性：`workspace:*` 改写的 `^` range 与依赖包新版本兼容（patch/minor 不强制下游 major 断裂）。
- [ ] 3.2 实现 `release-tool size`（tree-shaken/gzip，esbuild）：
  - 测量定义（写入 release spec）：`core` = bundle `packages/core/dist/index.js`（`--external:@aurora/*`）gzip；`browser 最小接入` = bundle browser entry（`--external:@aurora/event-schema`，bundles core+sdk+browser）gzip；插件 = bundle plugin entry（`--external:@aurora/*`）gzip；adapter = bundle adapter entry（`--external:@aurora/* --external:vue|react|react-dom`）gzip；
  - approved 阈值：core ≤ 10 KiB；browser 最小接入 ≤ 30 KiB；插件增量 ≤ 8 KiB；Vue/React 适配增量 ≤ 5 KiB（test-strategy §5）；
  - 超限时报真实原因（bundler 意外打包、意外依赖），只允许对真实意外打包依赖做最小修复；禁止改阈值/删功能/作弊 exclude。
- [ ] 3.3 运行 size 门禁，记录真实 gzip 数值到 release spec 的证据表（机器测量，非伪造）。

**Targeted tests (Task 3):** compat 单测（exports/types 悬挂、协议常量变化检测、dep range 一致性）；size 单测（阈值判定逻辑）；实际运行 `release-tool compat` + `size` 全绿并记录数值；`git diff --check`。

**Git:** logical commit `feat(release-tool): compatibility + tree-shaken size gates (OPS-03 Task 3)`。

---

## Task 4 — Release workflow + prerelease + rollback/deprecate

**Goal:** 扩展现有 release 链为真实发布 workflow（prerelease `next` / stable `latest`）并提供可操作回滚/deprecate 路径与发布证据。

**Steps:**

- [ ] 4.1 扩展现有 `.github/workflows/release.yml`：新增 `sdk-publish` 阶段（workflow_dispatch 带 `release_type: stable|prerelease` 与版本输入），仅接受已打 tag 的 exact SHA：
  - checkout exact tag → install frozen lockfile → build → `release-tool validate` → `release-tool pack` → `release-tool compat` → `release-tool size`；
  - provenance/signing：`npm publish --provenance --access public`（需 protected environment + OIDC；当前无 credential 记 `LIVE_PUBLISH_CREDENTIAL_PENDING`，该 step 静态存在但不执行）；
  - dist-tag：prerelease → `--tag next`；stable → `--tag latest`；
  - 发布证据：记录 exact tag、tarball sha、size 表、compat/size 门禁结果到 release note。
- [ ] 4.2 安全约束：`permissions` least privilege（`contents: read`，publish job 用 protected environment + 最小 secret）；所有 actions pinned（`actions/checkout@v4`、`pnpm/action-setup@v4`、`actions/setup-node@v4` 等现有 pin）；禁止 `pull_request_target`；禁止 secret echo；artifact identity = exact tag/tarball hash。
- [ ] 4.3 实现 `release-tool deprecate`（rollback/deprecate 辅助）：`npm deprecate <pkg>@<version> <message>` 包装；`release-tool latest --pkg <pkg> --version <known-good>`（恢复 dist-tag 到已知稳定版本）；corrected patch 发布指引（bump patch → 重新走 stable 链）。写入 release spec §回滚。
- [ ] 4.4 YAML/静态校验：用仓库现有 `yaml`（root devDep）或 actionslint 等价做 workflow 语法静态校验（本地允许）。
- [ ] 4.5 同步 `docs/releases/release-migration-and-rollback.md`（SDK 专用回滚程序）与 `docs/releases/sdk-package-versioning-and-release.md`（prerelease/stable 路径、dist-tag、证据、`LIVE_PUBLISH_CREDENTIAL_PENDING`）。

**Targeted tests (Task 4):** deprecate/latest 命令单测（CLI 参数、dry-run）；workflow YAML 静态校验通过；回滚证据（release spec 步骤可执行、无覆盖 immutable version、dist-tag 恢复逻辑单测）；`git diff --check`。

**Git:** logical commit `feat(release): sdk publish/prerelease/rollback workflow (OPS-03 Task 4)`。

---

## 精简最终验收（只补未覆盖 gate，一次）

1. public package metadata PASS（`release-tool validate`）
2. pack artifact PASS（`release-tool pack`）
3. package-entry PASS（9 包 `test:package`）
4. packed consumer build PASS（fixture typecheck+build）
5. SemVer/协议门禁 PASS（`release-tool compat`）
6. size 门禁 PASS（`release-tool size`，真实数值记录）
7. release workflow 静态校验 PASS
8. rollback evidence PASS（release spec 回滚步骤 + deprecate 单测）
9. `git diff --check` PASS

不再重复已成功的测试。

## Git / PR

- 少量逻辑 commit（Task 1—4 各一个，另加 release spec/入口同步在 Task 1/4 内）。
- push `feature/g15-sdk-release-engineering`（用户授权 commit+push）。
- 由于 G14 PR #18 未 merge：**不创建 stacked G15→G14 PR**；创建 Draft PR → main，明确标记 `blocked only on G14 integration, implementation completed`；或仅 push 分支。先查询一次 PR/CI，若 queued/in_progress 输出 `G15_REMOTE_CI_IN_PROGRESS` 后停止。
- 不 force push；不 bypass branch protection。

## 计数与状态

- 正式计数保持 `completed = 62 / remaining = 16`，记录 `G15_IMPLEMENTATION_COMPLETED`、`G14_INTEGRATION_PENDING`。
- G14 正式关闭后：`62/16 → 63/15`（OPS-02），随后 OPS-03 关闭 `63/15 → 64/14`。
- G14 未 merge 时允许 G15 development 完成，不得重复实现。
