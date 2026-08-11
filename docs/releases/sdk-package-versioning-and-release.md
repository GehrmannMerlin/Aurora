---
title: SDK 包版本与发布（OPS-03）
status: approved
owner: release
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: @aurora 9 个 public SDK/协议包的版本、制品、兼容、体积、发布与回滚
related:
  - ../../AURORA_RULES.md
  - ../../AGENTS.md
  - release-migration-and-rollback.md
  - ../architecture/aurora-v1-remaining-module-batches.md
  - ../adr/ADR-001-use-monorepo.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-007-workspace-package-and-task-tooling.md
  - ../protocol/protocol-compatibility-boundary.md
  - ../testing/test-strategy.md
  - ../superpowers/plans/2026-08-11-ops-03-sdk-package-versioning-and-release-engineering.md
  - ../../package.json
supersedes: none
review-cycle: release-policy-or-public-api-change
---

# Aurora SDK 包版本与发布（OPS-03）

## 1. 定位与批准来源

本文把 G15 叶子 OPS-03「Package versioning and SDK release engineering」正式化并实施为可执行的 SDK 发布工程链。批准来源：用户 G15 指令（2026-08-11）明确授权上一轮 `G15_APPROVAL_PACKAGE` 的 4 项推荐方案（决策 B/E/F/G），并批准采用 `tooling/release-tool`（`@aurora/release-tool`）作为仓库自有等价版本/发布机制。

本文只描述 SDK 发布工程；不改变 SDK runtime 行为、wire protocol、queue/transport/retry/flush、Vue/React adapter 行为、ingestion/platform backend、Console 产品功能或 G16 基础设施。

## 2. 已批准发布决策（G15 用户授权，不复述为候选）

| 决策 | 内容 |
|---|---|
| B 版本 | **独立包版本（independent package versions）**：9 个 public 包可独立升级；version bump / changelog / 依赖更新由 `@aurora/release-tool` version 机制管理（`.changeset/*.md` + SemVer bump + `workspace:*` → `^range` 改写 + CHANGELOG）；不强制统一版本 |
| F registry/scope | 目标 registry 为**公开 npm**，scope `@aurora`；public 包恰为 9 个（见 §3）；其余 platform-*/ingestion-*/processing-store/internal tooling/apps 保持 private，不得发布 |
| E prerelease | SemVer prerelease `alpha.N`/`beta.N`；预发布使用 dist-tag **`next`**；稳定版本使用 **`latest`**；预发布不得覆盖 `latest` |
| G dist-tag/回滚 | `latest` 仅指向稳定版本；`next` 用于 alpha/beta/canary；坏版本 `npm deprecate` + 发布 corrected patch + 恢复/保持 `latest` 到最后已知稳定版本；禁止覆盖已发布 immutable version、禁止修改历史 tag |

沿用既有 approved 依据（不重复批准）：SemVer 政策（Release 文档 §5 + 设计 §10.4）、协议兼容（PRO-06 + ADR-005）、发布授权（设计 §10.4 受保护 npm Environment/Trusted Publishing/2FA/最小权限 + §14 角色）、provenance/签名（设计 §10.4）、回滚/deprecate（Release 文档 §5）。

## 3. 公开包清单与边界

正式 public packages（`tooling/release-tool` 的 `PUBLIC_PACKAGES` 常量，与真实 `package.json` 一致）：

`@aurora/event-schema`、`@aurora/core`、`@aurora/sdk`、`@aurora/browser`、`@aurora/plugin-error`、`@aurora/plugin-request`、`@aurora/plugin-performance`、`@aurora/plugin-vue`、`@aurora/plugin-react`

规则：

- 上述包必须 `publishConfig.access === "public"`，`private` 不得为 `true`，`files` 必须包含 `dist`（存在 README/LICENSE 时必须一并包含），`exports["."]` 必须含 `types` 与 `import`；
- 其余所有 `@aurora/*` 包（platform-*、ingestion-*、processing-store、internal tooling、apps）必须保持 `private: true` 且不设 `publishConfig.access: "public"`；
- 校验由 `release-tool validate` 强制执行（9 public + 其余 private，任一违反即 FAIL）。

## 4. 版本与兼容

- 独立版本：每个 public 包按自身 SemVer 演进；`.changeset/*.md` 声明 `major|minor|patch`，`release-tool version` 按依赖拓扑顺序 bump、改写 `workspace:*` 为 `^<version>`、生成 CHANGELOG；
- SemVer：公共 API 破坏性变化必须 major；公共 API 新增/非破坏变化 minor；修复 patch（Release 文档 §5、设计 §10.4）；
- **协议解耦**：wire protocol 由 `@aurora/event-schema` 的 `CURRENT_PROTOCOL_VERSION`（当前为 `1`）与 `SUPPORTED_PROTOCOL_VERSIONS` 控制；npm package version bump 不得改变协议版本；协议破坏性变化必须先有 accepted ADR（PRO-06/ADR-005）。`release-tool compat` 断言协议常量不变；
- 依赖一致：`workspace:*` 依赖在发布计划中必须解析到具体版本（`release-tool compat`）。

## 5. 制品规则

- 每包制品 = `pnpm pack` 生成的 tarball；必须包含 `dist/**`（含 `.d.ts`）、`package.json`、README/LICENSE（如声明/存在）；不得包含 `src/`、`test/`、`test-browser/`、`coverage/`、`.env`、临时/开发 fixture（`release-tool pack` 检查）；
- `exports` 子路径不得悬挂（`release-tool compat`）；
- 已发布版本不可覆盖；制品身份 = 精确 git tag + tarball 内容 hash。

## 6. 体积门禁（approved，test-strategy §5）

测量定义（`release-tool size`，esbuild bundle+minify 后 gzip）：

| 对象 | 测量 | 阈值 |
|---|---|---|
| Core 基础包 | bundle `@aurora/core` 入口（`--external:@aurora/*`） | gzip ≤ 10 KiB |
| Browser＋Core 最小接入 | bundle `@aurora/browser` 入口（无 external） | gzip ≤ 30 KiB |
| 单个可选插件增量 | bundle 插件入口（`--external:@aurora/*`） | gzip ≤ 8 KiB |
| 单个 Vue/React 适配增量 | bundle 适配入口（`--external:@aurora/*` + `vue`/`react`/`react-dom`） | gzip ≤ 5 KiB |
| event-schema / sdk | 同口径 bundle | 记录为证据（无独立 approved 阈值） |

不得为过线降低阈值、删除功能或作弊 exclude；超限先判断意外依赖/打包问题，仅真实问题允许最小修复。测量值以本规格证据表与发布证据为准，不代表生产 SLO/成本。

## 7. 发布与回滚流程

发布链（`release.yml` 扩展，`release-tool` 各门禁）：

1. 校验版本 plan → `release-tool version`（bump + 依赖改写 + CHANGELOG）；
2. 打 release tag（exact SHA）→ `release-tool validate` → `release-tool pack` → `release-tool compat` → `release-tool size`；
3. provenance/签名：`npm publish --provenance --access public`（受保护 npm Environment + Trusted Publishing + OIDC；当前 registry credential 不存在 → **`LIVE_PUBLISH_CREDENTIAL_PENDING`**，该 step 静态存在但不执行，禁止伪造 publish success）；
4. dist-tag：prerelease（alpha/beta）→ `--tag next`；stable → `--tag latest`；
5. 发布证据：exact tag、tarball hash、体积表、compat/size 门禁结果、批准者与部署后验证。

回滚/deprecate（`release-tool deprecate`/`latest`/`rollback`）：

1. `npm deprecate <pkg>@<bad-version> "message"`（标记坏版本）；
2. `npm dist-tag add <pkg>@<known-good> latest`（恢复 `latest` 到已知稳定版本）；
3. 发布 corrected patch（bump patch 走稳定路径）；
4. 禁止覆盖已发布 immutable version、禁止修改历史 tag、禁止伪造删除。

## 8. 安全约束

- least privilege：publish job 使用 protected environment 与最小 secret；workflow `permissions` 最小化；
- 禁止 `pull_request_target` 发布；禁止 untrusted PR 直接 publish；
- 禁止 secret echo；actions 全部 pinned（checkout@v4、pnpm/action-setup@v4、setup-node@v4）；
- artifact identity = exact tag + tarball hash，可审计。

## 9. 当前实施状态与记录

- `release-tool` validate/version/pack/compat/size/deprecate/latest/rollback 已实施并通过测试；9 个 public 包元数据已修正（private 移除、`publishConfig.access: public`、event-schema/browser `files` 补 README）；
- `LICENSE_PENDING`：仓库暂无 LICENSE 决策；validate 仅对已存在 license 字段做 SPDX 合法校验，不硬性要求。待用户/法务决定许可证后再补 LICENSE 文件并纳入 `files`；
- `LIVE_PUBLISH_CREDENTIAL_PENDING`：npm registry credential / protected environment 尚不存在；发布 workflow 可静态验证，真实 publish 待 credential 就绪；
- `G14_CONSUMER_FIXTURE_PENDING`：G14 sdk-reference 未进 main，消费者验证使用最小临时 fixture；G14 集成后用 sdk-reference 补 1 次正式消费者验证；
- 计数：正式叶子保持 `completed = 62 / remaining = 16`；OPS-03 implementation = completed；G14 正式关闭后按 `62/16 → 63/15 → 64/14` 推进。
