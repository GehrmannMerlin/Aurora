# Aurora Preview Continuous Delivery Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 `pnpm deploy:preview` 接入 OPS-01 GitHub Actions，形成 `main CI PASS → Preview deployment workflow → dedicated SSH identity → new release → build/migrate → health → smoke → atomic switch` 的持续交付桥接。

**This plan closes no V1 leaf module.**

Starting leaf baseline:
```
completed = 38
remaining = 40
```

Expected leaf baseline after success:
```
completed = 38
remaining = 40
```

**OPS-04 != completed；OPS-05 != completed；G16 = started / temporary-preview-bridge-active；OPS-02 = blocked（本轮不实施）。**

## Global Constraints

- **不创建新 ADR**（GitHub Actions、Preview single-host、SSH deployment 已在现有范围；仅把现有 deploy:preview 接入 GitHub Actions）；
- 不修改叶子计数；不关闭 OPS-04/05；
- 不部署 PR；只有 main CI PASS 的 exact SHA 可部署；
- **CI 部署必须是 clean commit（dirty=false）**；不部署 dirty working tree；
- 禁止 `StrictHostKeyChecking=no`；host public key 必须 pin（非 secret）；
- private key 永不写 repo；`PREVIEW_SSH_PRIVATE_KEY` 只存 GitHub encrypted secret；
- 不输出 SSH key / DB password / ingestion credential / .env 内容到 logs；
- 共用同一核心部署引擎（local manual + GitHub CI），不复制第二套业务逻辑；
- 不修改 Lumina 业务逻辑；nginx ownership 修复需备份 + 可回滚；
- 禁止 force push / reset / clean / rebase；
- 每 logical commit 前 `git diff --cached --check` + `--stat`。

## 固定回读与权威边界

| 文件 | 重点 | 依据 |
| --- | --- | --- |
| `docs/operations/preview-continuous-delivery.md`（本 CD spec） | 26 项 | 唯一实现依据 |
| `docs/operations/public-preview-single-host-deployment.md` | 服务器/共享 nginx | 服务器事实 |
| `docs/architecture/ci-quality-workflows.md` | OPS-01 分层、GitHub Actions | CI 载体 |
| `.github/workflows/main.yml` | workflow name `Main Quality Gates`、job 结构 | workflow_run 绑定 |
| `deploy/preview/scripts/deploy-preview.sh` | 现有部署逻辑 | 复用核心 |
| `deploy/preview/scripts/rollback-preview.sh` | 回滚逻辑（含 interactive prompt） | CI 需 non-interactive |
| `deploy/preview/compose.aurora-override.yml` | 共享 nginx 挂载 | ownership 修复 |
| `Aurora 测试规范.md`、`Aurora 文档规范.md`、`Aurora 代码规范.md` | 通用门禁 | 实现风格 |

## 文件结构映射

```text
deploy/preview/
├── scripts/
│   ├── deploy-preview.sh        # Modify：CI=1 non-interactive mode（跳过本地 gate、sudo、交互）
│   └── rollback-preview.sh      # Modify：CI=1 non-interactive mode（跳过 read 提示）
├── lib/
│   └── deploy-preview-core.sh   # Create：共享部署核心（source shipping/build/migrate/health/smoke/switch）
├── nginx/
│   └── aurora-tls.conf          # Modify：确认 ownership 独立（若需）
.github/workflows/
└── deploy-preview.yml           # Create：workflow_run + workflow_dispatch
docs/operations/
├── preview-continuous-delivery.md        # Create（spec，已完成）
└── public-preview-single-host-deployment.md  # Modify：nginx ownership 修复记录
```

## Tasks

### Task A：deploy-preview.sh CI-safe non-interactive mode

**Consumes:** 现有 `deploy-preview.sh`。
**Produces:** 支持 `CI=1` 的部署脚本。

**Actions:**
- Modify `deploy/preview/scripts/deploy-preview.sh`：
  - 检测 `CI=1`：跳过本地 quality gate（typecheck/build，CI 已跑）、跳过 `sudo`（用 `SSH` 直接，因为专用 deploy user 已 chown）、跳过 `$HOME/.ssh` 默认 key（用 env `AURORA_PREVIEW_SSH_KEY`）；
  - SSH 函数支持 `AURORA_PREVIEW_KNOWN_HOSTS`（host pinning 文件）；
  - 保持 local manual 模式默认行为不变；
- 不复制第二套部署逻辑；`CI=1` 只是分支。

**Tests:** `bash -n`；dry-run 检查 `CI=1` 分支不触发本地 gate。

### Task B：rollback-preview.sh CI-safe mode

**Consumes:** 现有 `rollback-preview.sh`。
**Produces:** 支持 `CI=1` 的 rollback（跳过 interactive `read`）。

**Actions:**
- `CI=1` 时 `CONFIRM=y`（自动化 rollback 由 workflow 显式授权）；
- SSH 函数支持 env key + known_hosts；
- 保持 local manual 默认交互确认。

**Tests:** `bash -n`；`CI=1` 时无 `read` 阻塞。

### Task C：专用部署身份 + host pinning

**Consumes:** 服务器 SSH。
**Produces:** `aurora-preview-deploy` ED25519 key + public key 上服务器 + host-key pinning。

**Actions:**
- 生成 `aurora-preview-deploy` ED25519 key（无 passphrase，仅存 GitHub secret）；
- public key 追加到服务器 `authorized_keys`（最小化：仅 `/opt/aurora-preview` 操作所需）；
- Docker 权限方案评估（A: dedicated user + docker group / B: restricted sudo wrapper / C: 现有入口）：选最小可审计方案，记录 residual risk；
- host public key（`ssh_host_ed25519_key.pub`）已交叉验证，写入 repo `deploy/preview/ssh/known_hosts`（非 secret）。

**Tests:** SSH key auth 测试（专用 key 登录）；host key 匹配。

### Task D：GitHub Environment + Secrets 配置

**Consumes:** `gh`（已认证，admin perms）。
**Produces:** `preview` Environment + secrets。

**Actions:**
- `preview` Environment 已创建（protection_rules=0，无需 approval）；
- `PREVIEW_SSH_PRIVATE_KEY`：`gh secret set`（pipe，不打印，不写临时明文文件）；
- `PREVIEW_HOST=47.238.145.24`、`PREVIEW_USER=aurora-preview-deploy`：Environment variables；
- `PREVIEW_KNOWN_HOSTS`：repo 公开 host pinning（或 Environment variable）。

**Tests:** `gh secret list` 确认存在（不显示值）。

### Task E：deploy-preview.yml workflow

**Consumes:** main workflow name、deploy script、secrets。
**Produces:** `.github/workflows/deploy-preview.yml`。

**Actions:**
- 触发：
  - `workflow_run`：`workflows: ["Main Quality Gates"]`，`types: [completed]`，branch main + conclusion success 时继续，否则退出；
  - `workflow_dispatch`：`ref` input（要求已有 main quality evidence）；
- `permissions: contents: read`（+ `deployments: write` 用于 environment deployment）；
- checkout exact SHA：`github.event.workflow_run.head_sha`（非 `main` latest）；验证 `git rev-parse HEAD == CI-passed SHA`，不一致 fail closed；
- `environment: preview`；
- `concurrency: group: aurora-preview-deployment, cancel-in-progress: false`；
- steps：checkout → setup node → setup pnpm → `pnpm install` → build app deps → `deploy/preview/scripts/deploy-preview.sh` with `CI=1` + env（SSH key from secret, known_hosts from repo）→ public smoke → run summary evidence；
- secrets：`PREVIEW_SSH_PRIVATE_KEY`；vars：`PREVIEW_HOST`/`PREVIEW_USER`；不配置 AWS/Alibaba deployment secret；
- PR 不触发（`pull_request` 不在 `on`）。

**Tests:** YAML 解析校验；`workflow_run` 语法正确；无 `pull_request_target`。

### Task F：Lumina/nginx ownership 修复

**Consumes:** 服务器 nginx 现状。
**Produces:** Aurora vhost ownership 独立于 Lumina deploy。

**Actions:**
- 评估方案：A（include-owned vhost，nginx conf.d glob 已存在）、B（shared managed edge）、C（independent proxy）；
- 选 A：确认 nginx 主配置 `include /etc/nginx/conf.d/*.conf` 已稳定存在，Aurora vhost 作为独立 `.conf` 文件存在即可——重点是把 Aurora 挂载从 compose override 提升为**不受 Lumina deploy.sh 影响的持久挂载**；
- 若需修改 Lumina deploy.sh：仅改 nginx 配置 ownership 相关部分，不改业务行为；**备份修改前文件**；
- 验证：`nginx -t`、Lumina `lumina.ac.cn` smoke、Aurora smoke。

**Tests:** `nginx -t` PASS；Lumina 200；Aurora 200/401。

### Task G：真实 GitHub Actions Preview deployment 运行

**Consumes:** 完成的 workflow + secrets + identity。
**Produces:** 真实部署证据。

**Actions:**
- 用 `workflow_dispatch` 对当前已通过 CI 的 commit 触发一次真实 Preview deployment；
- 验证：workflow triggered → exact SHA checkout → server release created → build/migrate → public smoke PASS；
- 服务器检查：`current` 指向新 release、compose ps、postgres health、API health、worker running、无 5432 公网。

**Tests:** GitHub run conclusion=success；服务器 release ID；public smoke。

### Task H：文档与证据

**Consumes:** 全部实现。
**Produces:** 文档同步 + run summary。

**Actions:**
- 更新 `public-preview-single-host-deployment.md`：nginx ownership 修复、CD 接入；
- 更新 `AURORA_RULES.md`/`AGENTS.md` 最小状态（CD bridge active，叶子计数不变）；
- `docs/README.md` 加 Preview CD 行；
- GitHub run summary 输出：commit SHA、release ID、target、URL、migration result、health、smoke、rollback?。

**Tests:** 文档 prettier；git diff --check。

## 验收停点（Preview CD Independent Acceptance）

- [ ] approved spec `docs/operations/preview-continuous-delivery.md`
- [ ] 实施计划 `docs/superpowers/plans/2026-08-08-preview-continuous-delivery-bridge.md`
- [ ] deploy/rollback 支持 CI=1 non-interactive
- [ ] 专用 deploy identity + host pinning
- [ ] `preview` Environment + `PREVIEW_SSH_PRIVATE_KEY` secret
- [ ] `deploy-preview.yml` workflow 存在且 YAML 合法
- [ ] **真实 GitHub Actions Preview deployment 成功**（main CI PASS → deploy → server release → public smoke）
- [ ] exact SHA 保护生效
- [ ] Lumina/nginx ownership 修复 + Lumina 零回归
- [ ] 无 secret 泄漏、无无关 diff
- [ ] 叶子计数不变（completed 38 / remaining 40）
- [ ] OPS-04/05 不关闭；OPS-02 保持 blocked；G16 `started / temporary-preview-bridge-active`

**Preview CD 只在真实 GitHub deployment run 通过后关闭，不以 YAML 校验代替。**

## Plan self-review

- spec coverage = pass（26 项全部映射）
- placeholder = pass（无占位）
- security = pass（secrets 最小、host pinning、无 StrictHostKeyChecking=no）
- deployment identity = pass（专用 key + 最小权限）
- exact SHA = pass（workflow_run.head_sha + fail closed）
- nginx ownership = pass（include-owned vhost）
- migration = pass（复用现有 forward migration）
- rollback = pass（CI=1 non-interactive，复用现有 rollback）
- scope = pass（temporary-preview-bridge enhancement）
- leaf accounting = pass（38/40 不变）
