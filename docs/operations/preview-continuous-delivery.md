---
title: Aurora Preview Continuous Delivery Bridge
status: approved
owner: operations
created: 2026-08-08
last-reviewed: 2026-08-08
applies-to: 将现有 pnpm deploy:preview 接入 OPS-01 GitHub Actions，形成 main CI PASS → 自动 Preview 部署的持续交付桥接
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ./public-preview-single-host-deployment.md
  - ../architecture/ci-quality-workflows.md
  - ../architecture/deployment.md
  - ../releases/release-migration-and-rollback.md
  - ../architecture/formalization-readiness.md
  - ../superpowers/plans/2026-08-08-ci-quality-workflows.md
  - ../adr/README.md
supersedes: none
review-cycle: preview-lifecycle-or-replacement
---

# Aurora Preview Continuous Delivery Bridge

## 1. Purpose

本规格把已经可人工执行的 `pnpm deploy:preview` 接入已完成的 OPS-01 GitHub Actions。目标链路：

```
Developer local work → git commit → git push → main CI PASS → Preview deployment workflow
→ dedicated SSH deployment identity → new release → remote build/migration → health check
→ public smoke → atomic current switch → https://aurora.ah.cn 使用新版本
```

**CI FAIL 时不得部署。**

## 2. Temporary nature

本桥接是 **temporary-preview-bridge enhancement**，不是新 V1 叶子模块，不是 OPS-04/OPS-05 implementation。它只在 `temporary-preview-bridge-active` 阶段有效，被正式 OPS-05 取代。

## 3. Trigger

- **自动**：`workflow_run` 监听 `main` workflow 完成且 `conclusion == success` 且 `branch == main` → 触发 Preview deploy；
- **手动**：`workflow_dispatch` 允许对已知 commit 重新部署（recovery/debug），但要求该 commit 已有通过的 main quality evidence，且不得对任意 untrusted SHA 使用 Preview secret；
- **不部署 PR**：`pull_request` 不触发 Preview 部署（共享固定域名，避免未合并代码覆盖）。

## 4. CI dependency

Preview deploy 只依赖 `main` quality PASS。部署 workflow 必须 checkout **CI-passed 的 exact commit SHA**（`workflow_run.head_sha`），不是 `main` latest。核心不变量：**CI PASS 的 SHA == 部署的 SHA**。不一致则 fail closed。

## 5. Deployment target

`https://aurora.ah.cn` / `https://ingest.aurora.ah.cn`，服务器 `47.238.145.24`，`/opt/aurora-preview/`。

## 6. GitHub Environment

创建/复用 `preview` Environment：

- environment name: `preview`
- environment URL: `https://aurora.ah.cn`
- 不需要 production manual approval

## 7. SSH identity

- 专用 ED25519 key `aurora-preview-deploy`（无 passphrase，仅因存于 GitHub encrypted secret）；
- private key 永不写 repo；
- public key 上服务器 `authorized_keys`；
- 账户职责仅限 Aurora Preview 部署；权限最小化。

## 8. Host verification

- **禁止 `StrictHostKeyChecking=no`**；
- 获取服务器真实 SSH host public key（`/etc/ssh/ssh_host_*_key.pub` + `ssh-keyscan` 交叉验证），pin 到 workflow；
- 用 `PREVIEW_KNOWN_HOSTS` 或 repo 中公开 host-key pinning 文件（host public key 非 secret）。

## 9. Release identity

每次 GitHub deployment 使用唯一 release ID：`<timestamp>-<commit_sha_short>`（如 `20260808-103000-abc1234`）。manifest 记录：commit SHA、workflow run ID、deployment timestamp、`source_dirty=false`、`source_origin=GitHub`、release ID。

## 10. Source identity

GitHub CD **只能部署 clean repository commit**（`dirty=false`）。与手动 local 部署区分（local 可记录 `dirty=true`）。

## 11. Deploy concurrency

`concurrency: group: aurora-preview-deployment, cancel-in-progress: false`。同一时间只允许一个 Preview deployment；不中断已进入 Migration/atomic switch 阶段的 run。防止两个 deployment 同时操作 current symlink / DB migration / compose / nginx。

## 12. Migration

- 完全复用现有 Preview migration 路径（`compose run --rm migrate`）；
- PostgreSQL health first → forward migration → no reset / no drop / no clean DB / existing-data safe；
- 失败阻止 release switch。

## 13. Health verification

部署后内网验证：postgres healthy、ingestion-api healthy、worker running、无 crash loop。

## 14. Smoke verification

公网验证：

- `https://aurora.ah.cn` → 200（Preview 状态页，非 fake Console）；
- `http://aurora.ah.cn` → HTTPS redirect；
- `https://ingest.aurora.ah.cn/v1/batches` 无凭证安全请求 → 401；
- TLS hostname valid。

不在 GitHub log 打印合法 ingestion secret。

## 15. Atomic switch

`current` symlink 原子切换到新 release；失败保留 previous release 服务。

## 16. Rollback

复用 `pnpm deploy:preview:rollback` 核心（non-interactive 模式）；DB Migration 不自动执行破坏性 down；应用层 rollback 到上一 release。**禁止** deployment failure → `rm -rf current` → 全量重建。

## 17. Failure behavior

- current switch 前失败：不切换，previous release 保持服务，deployment fail；
- current switch 后 smoke fail：应用层 rollback，不破坏性回滚 DB。

## 18. Secrets

- `PREVIEW_SSH_PRIVATE_KEY`（GitHub encrypted secret，专用 deploy key）；
- `PREVIEW_HOST`/`PREVIEW_USER` 用 Environment variables（非 secret）；
- `PREVIEW_KNOWN_HOSTS`（host public key pinning，非 secret）。

## 19. Logs

不输出：SSH key、DB password、ingestion credential、`.env` 内容。

## 20. Server permissions

- `/opt/aurora-preview/{releases,current,shared,backups,deploy}` 为 Aurora Preview 管理范围；
- 自动部署只允许修改该范围；
- 禁止 `/opt` 其他项目、Lumina application files、`/root`、其他 Docker volumes、其他 database。

## 21. Lumina nginx interaction

- 修复共享 nginx 的 Aurora vhost ownership：让 Aurora vhost 不因 Lumina `deploy.sh` 重建 nginx 而丢失（compare include-owned vhost / shared managed edge / independent proxy，选最小不破坏方案）；
- 备份修改前文件并有回滚；
- 不修改 Lumina 业务逻辑。

## 22. Manual fallback

保留 `pnpm deploy:preview`（本地手动）与 `pnpm deploy:preview:rollback`；CI 与本地共用同一核心部署引擎，不复制第二套业务逻辑。

## 23. Audit/evidence

GitHub run summary 至少输出：commit SHA、release ID、deployment target、URL、migration result、internal health result、public smoke result、rollback performed?。

## 24. Out-of-scope

不建立 OPS-04 foundation、不可变生产制品 promotion、AWS OIDC、production Environment、ECS/ECR、正式 production rollout、Multi-AZ、production SLO、完整 DR。

## 25. Replacement condition

正式 OPS-05 在 OPS-04 approved/implemented 后取代本桥接。

## 26. Completion definition

本桥接完成当且仅当：

1. approved spec（本文）；
2. 实施计划已执行；
3. 真实 GitHub Actions Preview deployment 运行成功（main CI PASS → deploy → server release → public smoke PASS）；
4. exact SHA 保护生效；
5. 专用 deploy identity + host pinning 生效；
6. Lumina/nginx ownership 修复且 Lumina 零回归；
7. 无 secret 泄漏、无无关 diff；
8. 叶子计数不变（completed 38 / remaining 40）；
9. OPS-04 / OPS-05 不关闭；OPS-02 保持 blocked；G16 保持 `started / temporary-preview-bridge-active`。

## 27. ADR 判断

GitHub Actions、Preview single-host、SSH deployment 已在当前临时 Preview 与 OPS-01 范围形成。本桥接仅把现有 `deploy:preview` 接入 GitHub Actions，**无新的长期 ADR 决策**。不创建 ADR。
