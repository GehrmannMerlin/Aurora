---
title: Aurora CI 质量工作流（OPS-01）
status: approved
owner: quality
created: 2026-08-08
last-reviewed: 2026-08-08
applies-to: Aurora Monorepo 的 GitHub Actions CI——PR、main、nightly、release 质量门禁，PostgreSQL 隔离，浏览器验证与证据保留
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 测试规范.md'
  - '../testing/test-strategy.md'
  - '../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md'
  - '../releases/release-migration-and-rollback.md'
  - '../architecture/deployment.md'
  - '../architecture/formalization-readiness.md'
  - '../adr/README.md'
supersedes: none
review-cycle: ci-policy-or-tooling-change
---

# Aurora CI 质量工作流（OPS-01）

## 1. 定位与效力

本文正式化 Aurora 第一版 CI 质量工作流（OPS-01）。它把 approved [测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) 第 7 节（CI 阶段、阻断与例外）和 [测试策略](../testing/test-strategy.md) 第 3 节（CI 分级门禁）落实为可执行的 GitHub Actions 工作流，并形成 PostgreSQL 隔离与浏览器验证的正式规则。

**GitHub Actions 是 approved CI 载体**（testing/deployment design §7 明确"使用 GitHub Actions"），因此本规格不创建新 ADR；该选择属于"正式文档而不是 ADR"类别（设计 §19）。

**本规格不实现**：Preview 部署、生产部署、Docker 发布、OPS-05 release pipeline、AWS 部署、G15 SDK 包发布。这些是后续叶子/依赖的职责，OPS-01 只保证质量门禁与制品证据。

## 2. 目标与非目标

### 目标（A）

1. 为 PR、main、nightly、release 提供可信、可重复、有边界的质量门禁；
2. 本地质量命令与 CI 等价的正式映射（local-vs-CI equivalence）；
3. 不同 PostgreSQL integration suite 不因数据库遗留状态互相污染；
4. 真实浏览器（Chromium）验证作为 approved 门禁的一部分；
5. 失败可见、证据保留、安全最小化。

### 非目标（B）

- 不部署 Preview/生产，不发布 Docker/npm 制品；
- 不创建 AWS OIDC、不配置 Alibaba/AWS deployment secret；
- 不实现 OPS-05 release pipeline、G15 SDK 发布；
- 不引入新的长期 CI provider 或高迁移成本外部平台；
- 不解决 Windows libuv 本地环境问题（分类见 §7）。

## 3. 本地命令事实（local-vs-CI equivalence）

以下根命令是 CI 的唯一命令来源；CI 不发明新命令，只在环境层（Node/pnpm/PostgreSQL/Browser）对齐。

| 根命令 | 实际执行 | CI 映射 |
|---|---|---|
| `pnpm format:check` | Prettier 全仓 | PR/main |
| `pnpm openapi:check` | redocly lint + ingestion-openapi-contract drift | PR/main |
| `pnpm lint` | ESLint 全仓（含 processing-store/benchmark） | PR/main |
| `pnpm typecheck` | `pnpm -r typecheck`（14 工程） | PR/main |
| `pnpm test` | `pnpm -r test`（各包单元，排除 integration） | PR/main |
| `pnpm test:coverage` | 6 包 coverage（Browser 系 85/80/85/85） | main/nightly |
| `pnpm check:boundaries` | workspace-policy boundary CLI | PR/main |
| `pnpm build` | `pnpm -r build`（14 工程） | PR/main |
| `<pkg> test:package` | 包根 package-entry 验证 | PR/main |
| `<pkg> test:browser` | Playwright Chromium headless（4 包） | PR/main 或 nightly |
| `<pkg> test:integration` | vitest integration + `--no-file-parallelism`（6 包） | main/nightly（真实 PostgreSQL） |

## 4. 工作流分层

### 4.1 PR workflow

- 触发：`pull_request`（非 `pull_request_target`），作用于 `main` 相关变更；
- 门禁：install（frozen lockfile）→ format → openapi → lint → typecheck → workspace-policy → boundaries → unit → contract → build → package-entry → documentation；
- PostgreSQL integration：**不含于 PR**（按 approved 测试策略 §3，PR 为快速可信门禁；真实 PostgreSQL 证据在 main）；涉及 Migration/共享工具的变更触发更广矩阵；
- 不暴露 production secret；`permissions: contents: read` 最小化。

### 4.2 main workflow

- 触发：push 到 `main`；
- 门禁：PR 全部门禁 **+ 真实 PostgreSQL integration（全部 6 个 suite）** + 覆盖率 + browser（Chromium）；
- PostgreSQL：通过 GitHub Actions service container（PostgreSQL 17.10），为全部 integration suite 提供隔离数据库；
- main 通过是后续 Preview CD 与 release 的信任前置。

### 4.3 nightly workflow

- 触发：schedule（每日）或 workflow_dispatch；
- 门禁：main 全部门禁 + 完整 integration + 更重浏览器/兼容/稳定性证据（随 OPS-02 就绪后扩展）；
- 当前实际内容以已存在命令为准，不为不存在的模块编造。

### 4.4 release workflow

- 触发：workflow_dispatch（带版本标签）；
- 门禁：完整质量链 + Migration 验证 + 制品证据；
- **本轮不发布制品**；release workflow 先建立 gate 骨架，为 OPS-05/G15 提供可信晋级前置。

## 5. PostgreSQL 隔离策略

### 5.1 现状

6 个 integration suite（`ingestion-inbox`、`ingestion-credentials`、`processing-store`、`ingestion-api`、`ingestion-worker`、`ingestion-benchmark`）共享 `AURORA_TEST_DATABASE_URL`，数据库路径必须为 `/aurora_inbox_test`（`assertIsTestDatabase` 强制）。每个 suite 的 `migrateUp()` 先 DROP 已知表 + `pgmigrations`，再重新 apply Migration（fresh-up 语义）。benchmark 额外使用 per-run 隔离 schema（`schemaNameForRunId`）。

### 5.2 规则（正式）

1. **每 job 独立 PostgreSQL service**：CI 每个 integration job 启动自己的 PostgreSQL 17.10 service 容器，分配唯一端口，避免跨 job 共享；
2. **每 suite 独立 database**：integration job 内为每个 suite 创建独立 database（如 `aurora_inbox_test` 由该 job 专用），`AURORA_TEST_DATABASE_URL` 指向该 job 自己的 database；
3. **确定性 migrateUp/migrateDown**：保留现有 DROP 已知表 + 重 migrate 模式（已验证幂等）；
4. **无跨 suite 顺序依赖**：不依赖"某 suite 必须先跑"；任何 suite 都能在空 DB 上独立绿；
5. **benchmark 保持 per-run schema 隔离**：不共享 public schema；
6. CI 不要求 AURORA_TEST_DATABASE_URL 指向持久化外部 DB；全部由 CI service 动态提供。

## 6. 浏览器验证

- Browser test 使用仓库现有 Playwright Chromium（headless，`@playwright/test 1.62.0`，4 包：browser/plugin-error/plugin-request/plugin-performance）；
- CI 显式安装浏览器依赖（Playwright `install --with-deps chromium` 或等价 approved 步骤）；
- 禁止 arbitrary retry 掩盖 flake；首次失败必须采集并报告；
- 真实 Safari/移动设备矩阵属于 OPS-02（当前 deferred），不在 OPS-01。

## 7. 历史 flake 分类

| 问题 | 分类 | 处置 |
|---|---|---|
| PostgreSQL suite Migration/顺序冲突 | 已由 §5 隔离规则处理；不依赖执行顺序 | CI 每 job 独立 DB |
| Windows libuv `UV_HANDLE_CLOSING` | **local Windows tooling/environment issue**（仓库源码无 libuv 引用） | CI 用 Linux runner；不称其因此消失；不影响 Linux CI 不阻塞 |
| Chromium 首次启动 flake | 环境层（浏览器二进制首次缓存/依赖缺失） | CI 显式安装浏览器依赖；首次失败采集证据 |

## 8. CI 安全

- `permissions` 最小化：PR 仅 `contents: read`；main/release 仅所需权限；
- **禁用 `pull_request_target`**（避免未信任代码 + secret 组合）；
- pull_request 不暴露 production secret；
- 不把 `.env` 上传 artifact；不打印 DB password；不写长期 cloud credential；
- action version pinning：使用 `actions/checkout@v4`、`actions/setup-node@v4`、`pnpm/action-setup@v4` 等固定 major 版本（按项目批准规范）；
- artifact retention 有界（默认 ≤ 7 天）；
- logs 不记录敏感数据；
- 本轮 OPS-01 **不配置** Alibaba/AWS deployment secret。

## 9. 失败可见与并发

- 每个 job 失败显式列出失败的 check 与原因；
- `concurrency`：按 workflow + ref 取消陈旧运行；
- 超时：每个 job 设合理 timeout-minutes；
- retry policy：不自动重试掩盖首失败；重跑仅采集证据。

## 10. 完成定义（completion）

OPS-01 完成当且仅当：

1. approved 规格（本文）；
2. 实施计划已执行；
3. PR/main/nightly/release 四个 workflow 文件存在且通过本地 YAML 校验；
4. 真实 GitHub Actions 运行通过（至少 PR + main）；
5. PostgreSQL 17.10 service 集成验证通过；
6. Chromium browser job 通过；
7. 无 secret 泄漏、无无关 diff；
8. verification-before-completion 通过；
9. 叶子计数完成：completed 37 → 38、remaining 41 → 40（若当前基线为 37/41）。

## 11. ADR 判断

GitHub Actions 已在 approved testing/deployment design 存在；本规格不引入新的长期 CI provider、高迁移成本外部平台或安全身份架构。**无需新 ADR**。

## 12. 明确 deferred

- Preview CD（后续轮次，接入 `pnpm deploy:preview`）；
- 生产部署、Docker/npm 发布、AWS OIDC；
- OPS-02 兼容/设备/性能参考验证（下一叶子，readiness 见 formalization-readiness）；
- 真实 Safari/移动设备矩阵。
