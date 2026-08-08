# OPS-01 CI Quality Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 OPS-01 CI 质量工作流——创建 GitHub Actions PR/main/nightly/release 四个 workflow，用真实 PostgreSQL 17.10 service 隔离运行全部 integration suite，以 Linux runner + Chromium headless 完成浏览器验证，并保证本地命令与 CI 等价、安全最小化、失败可见。

**本计划关闭 1 个叶子：OPS-01。**
**本计划不关闭 OPS-05、OPS-02、G15、OPS-04。**

**预期完成后：completed 37 → 38，remaining 41 → 40**（若当前基线为 37/41）。

## Global Constraints

- **不创建新 ADR**（GitHub Actions 已在 approved testing/deployment design，属于"正式文档而不是 ADR"类别）；
- 不实现 Preview/生产部署、Docker/npm 发布、AWS OIDC、OPS-05 release pipeline、G15 SDK 发布；
- 不配置 Alibaba/AWS deployment secret；`permissions` 最小化；
- 禁用 `pull_request_target`；pull_request 不暴露 production secret；
- 不把 `.env` 上传 artifact；不打印 DB password；不写长期 cloud credential；
- CI 只运行仓库现有根命令（`pnpm format:check`/`openapi:check`/`lint`/`typecheck`/`test`/`test:coverage`/`check:boundaries`/`build` + 各包 `test:package`/`test:browser`/`test:integration`），不发明新命令；
- 不删除、跳过或弱化失败测试；不 arbitrary retry 掩盖首失败；
- action version pinning：`actions/checkout@v4`、`actions/setup-node@v4`、`pnpm/action-setup@v4`、`docker/build-push-action@v6`（如用）；
- workflow YAML 用仓库现有风格；新增 `.github/workflows/*.yml`；
- 本计划执行实际**不执行 `git add`/`commit`/`push`**；Commit 步骤只作为逻辑提交边界保留（本轮用户已单独授权 G14 提交）。

## 固定回读与权威边界

| 文件 | 重点章节 | 本计划依据 |
| --- | --- | --- |
| `docs/architecture/ci-quality-workflows.md`（本 OPS-01 spec） | 全文（§3 命令事实、§4 分层、§5 PostgreSQL 隔离、§6 浏览器、§8 安全、§10 完成定义） | 本计划唯一实现依据 |
| `docs/superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md` | §7 CI 阶段阻断与例外、§19 正式文档 vs ADR | GitHub Actions approved；CI 分级门禁 |
| `docs/testing/test-strategy.md` | §3 CI 分级门禁、§8 已实施模块门禁 | PR/main/nightly/release 分层 |
| `Aurora 测试规范.md` | 风险分层、fresh 验证、flaky 处置 | 不删除失败测试 |
| `Aurora 代码规范.md`、`Aurora 文档规范.md` | YAML/文档风格 | workflow 文件风格 |
| `docs/architecture/formalization-readiness.md` | 机器契约/实施就绪队列 | 状态同步 |
| `package.json`（根） | scripts | 命令来源 |
| `pnpm-workspace.yaml` | nodeVersion/engineStrict/frozen lockfile 语义 | CI 安装 |

## 命令真值表（CI 必须逐字使用）

| 根命令 | 用途 | 需要 PostgreSQL | 需要 Browser |
| --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 安装 | 否 | 否 |
| `pnpm format:check` | 格式 | 否 | 否 |
| `pnpm openapi:check` | OpenAPI 漂移 | 否 | 否 |
| `pnpm lint` | ESLint | 否 | 否 |
| `pnpm typecheck` | 类型 | 否 | 否 |
| `pnpm --filter @aurora/workspace-policy test` | 工作区契约 | 否 | 否 |
| `pnpm check:boundaries` | 边界 | 否 | 否 |
| `pnpm test` | 全仓单元（排除 integration） | 否 | 否 |
| `pnpm test:coverage` | 6 包覆盖率 | 否 | 否 |
| `pnpm build` | 全仓构建 | 否 | 否 |
| `pnpm --filter <pkg> test:package` | package-entry（6 SDK 包） | 否 | 否 |
| `pnpm --filter <pkg> test:browser` | Playwright Chromium（4 包） | 否 | 是 |
| `pnpm --filter <pkg> test:integration` | 真实 PostgreSQL integration（6 包） | **是** | 否 |

## 文件结构映射

```text
.github/
└── workflows/
    ├── pr.yml                  # Create：PR 快速门禁（无 PostgreSQL）
    ├── main.yml                # Create：main 完整门禁（含 PostgreSQL integration + coverage + browser）
    ├── nightly.yml             # Create：每日完整 integration + 更重浏览器证据
    └── release.yml             # Create：workflow_dispatch release gate（本轮不发制品）
```

## Tasks

### Task 1：pr.yml —— Pull Request 快速门禁

**Inputs:** approved OPS-01 spec §4.1；test-strategy §3（PR = 快速可信门禁）。

**Actions:**
- Create `.github/workflows/pr.yml`：
  - `name: PR Quality Gates`
  - `on: pull_request`（branches: main）；
  - `permissions: contents: read`；
  - `concurrency: group: pr-${{ github.ref }}, cancel-in-progress: true`；
  - job `quality`（`runs-on: ubuntu-latest`）：
    - checkout `actions/checkout@v4`；
    - `pnpm/action-setup@v4`（version: 11.17.0）；
    - `actions/setup-node@v4`（node-version: 24.18.0，cache: pnpm）；
    - `pnpm install --frozen-lockfile`；
    - `pnpm format:check`；
    - `pnpm openapi:check`；
    - `pnpm lint`；
    - `pnpm typecheck`；
    - `pnpm --filter @aurora/workspace-policy test`；
    - `pnpm check:boundaries`；
    - `pnpm test`；
    - `pnpm build`；
    - 6 SDK 包 `test:package`；
  - **不含 PostgreSQL integration**（按 spec §4.1：PR 为快速门禁，真实 PG 证据在 main）；
  - 每个 step 显式 `name`，失败即 `exit 1`。

**Expected result:** PR workflow YAML 合法；本地 YAML 校验通过；不含 secret、不含 pull_request_target。

**Verification:** `npx yaml` 或等价 YAML 解析校验；检查无 `secrets:` 引用。

### Task 2：main.yml —— main 完整门禁（含 PostgreSQL integration）

**Inputs:** approved OPS-01 spec §4.2、§5（PostgreSQL 隔离）；test-strategy §3（main = 真实 PG 证据）。

**Actions:**
- Create `.github/workflows/main.yml`：
  - `name: Main Quality Gates`；
  - `on: push`（branches: main）+ `workflow_dispatch`；
  - `permissions: contents: read`；
  - `concurrency: group: main, cancel-in-progress: true`；
  - job `quality`（PR 全部门禁 + coverage + build + package-entry）；
  - job `postgres-integration`：
    - `services: postgres: image: postgres:17.10-alpine, env: POSTGRES_USER/PASSWORD/DB, ports: 5432, options: --health-cmd pg_isready`；
    - 每 job 独立 PostgreSQL service（spec §5.2 规则 1）；
    - step 创建隔离 database：`createdb -h localhost -U aurora aurora_inbox_test`（或使 `AURORA_TEST_DATABASE_URL=postgresql://aurora:...@localhost:5432/aurora_inbox_test`）；
    - `AURORA_TEST_DATABASE_URL` 设置后依次运行 6 包 `test:integration`：
      - `pnpm --filter @aurora/ingestion-inbox test:integration`
      - `pnpm --filter @aurora/ingestion-credentials test:integration`
      - `pnpm --filter @aurora/processing-store test:integration`
      - `pnpm --filter @aurora/ingestion-api test:integration`
      - `pnpm --filter @aurora/ingestion-worker test:integration`
      - `pnpm --filter @aurora/ingestion-benchmark test:integration`
    - 不依赖执行顺序（每 suite 独立 migrateUp fresh-up）；
  - job `browser`：
    - `pnpm install`；
    - Playwright browser install：`pnpm --filter @aurora/browser exec playwright install --with-deps chromium`（或仓库等价 approved 步骤）；
    - 4 包 `test:browser`（browser/plugin-error/plugin-request/plugin-performance）；
  - **DB password 用 job 内随机或固定测试值**，不打印真实值；不写 artifact。

**Expected result:** main 含真实 PostgreSQL 17.10 integration + coverage + browser；job 隔离；无 secret 泄漏。

**Verification:** YAML 合法；检查 DB URL 指向 job 自身 service；检查 password 非真实 secret。

### Task 3：nightly.yml —— 每日完整证据

**Inputs:** approved OPS-01 spec §4.3；test-strategy §3（nightly = 更重证据）。

**Actions:**
- Create `.github/workflows/nightly.yml`：
  - `name: Nightly Quality Gates`；
  - `on: schedule`（cron，每日）+ `workflow_dispatch`；
  - `permissions: contents: read`；
  - 复用 main 的 quality + postgres-integration + browser 门禁；
  - 添加更重证据（当前以已存在命令为准，不为不存在模块编造）：完整 integration 重跑 + coverage 汇总；
  - artifact：coverage 报告上传（`actions/upload-artifact@v4`，retention 7 天）。

**Expected result:** nightly 每日运行；含完整 integration + coverage artifact。

**Verification:** YAML 合法；cron 语法有效；artifact retention 有界。

### Task 4：release.yml —— release gate（本轮不发制品）

**Inputs:** approved OPS-01 spec §4.4；release-migration-and-rollback §2（晋级序列）。

**Actions:**
- Create `.github/workflows/release.yml`：
  - `name: Release Quality Gate`；
  - `on: workflow_dispatch`（`inputs: version: description: 'Release version tag', required: true`）；
  - `permissions: contents: read`；
  - `concurrency: group: release, cancel-in-progress: false`；
  - job `release-gate`：完整质量链（format/openapi/lint/typecheck/boundaries/unit/build/package）+ PostgreSQL integration；
  - **本轮不发布制品**：无 publish step、无 OIDC、无 Docker push、无 npm publish；
  - 输出"gate passed, no artifact published"作为占位（spec §4.4：先建 gate 骨架）。

**Expected result:** release workflow 存在且可 dispatch；不发布任何制品。

**Verification:** YAML 合法；确认无 publish/push/OIDC step。

### Task 5：本地 Workflow 校验与安全扫描

**Inputs:** 全部四个 workflow 文件。

**Actions:**
- YAML 解析校验（`npx yaml` 或仓库等价）；
- secret 扫描：四个文件无 `secrets.AWS_*`、无 Alibaba/AWS key、无 `.env` 上传、无 `pull_request_target`；
- action version pinning 检查（固定 major 版本）；
- `permissions` 最小化检查；
- 确认 `pnpm install --frozen-lockfile` 在所有 job 使用（frozen lockfile）；
- 确认 PostgreSQL service 的 DB password 用 job 内固定测试值（非真实 secret）。

**Expected result:** 四个 workflow YAML 合法；无 secret 泄漏；无 pull_request_target；permissions 最小。

**Verification:** 逐文件 `yaml.parse` 成功；grep 扫描无敏感项。

### Task 6：Commit 与状态同步（逻辑边界）

**Actions:**
- `git add .github/workflows/ docs/architecture/ci-quality-workflows.md docs/superpowers/plans/2026-08-08-ci-quality-workflows.md`；
- 更新 `docs/architecture/formalization-readiness.md`（OPS-01 状态 → implemented/完成）；
- 更新 `AGENTS.md`/`AURORA_RULES.md` 最小状态（OPS-01 completed，completed 38/remaining 40）；
- 更新 `docs/README.md`（新增 CI 规格映射）；
- `git commit`（逻辑边界：`ci: implement OPS-01 CI quality workflows`）。

**Expected result:** OPS-01 相关文件全部提交；叶子计数 37→38/41→40。

**Verification:** `git diff --cached --check`；`git status` 干净。

## 验收停点（OPS-01 Independent Acceptance）

OPS-01 关闭条件（spec §10）：

- [ ] approved spec `docs/architecture/ci-quality-workflows.md` 存在
- [ ] 实施计划 `docs/superpowers/plans/2026-08-08-ci-quality-workflows.md` 存在
- [ ] PR/main/nightly/release 四个 workflow 文件存在且 YAML 合法
- [ ] **真实 GitHub Actions 运行通过**（至少 PR + main；含 PostgreSQL service + browser job）
- [ ] PostgreSQL 17.10 隔离验证通过（6 包 integration 全绿）
- [ ] Chromium browser job 通过
- [ ] 无 secret 泄漏、无无关 diff
- [ ] verification-before-completion 通过
- [ ] 叶子计数 37→38 / 41→40

**OPS-01 只在真实 GitHub run 通过后关闭，不以 YAML 校验代替。**

## OPS-02 Readiness（本计划不实施）

- SDK reference app：不存在
- Console：不存在
- Browser matrix（Chrome/Edge/Firefox/Safari 版本表）：approved 设计存在，证据缺失
- Device matrix：不存在
- Performance measurement environment：不存在
- Playwright/Chromium 基础设施：**本计划建立 Chromium CI job**
- Accessibility target：approved（WCAG 2.2 AA），无实现
- Production UI：不存在

若 OPS-01 完成后 OPS-02 关键前置（reference app/Console/device matrix/performance env）仍缺失，OPS-02 记录为 **blocked**，G14 为 partially completed；不伪造 reference app/Console。
