# AWS 部署入口（OPS-05）

Aurora 正式 AWS 部署流水线的静态定义与前置说明。

## 状态：PROVISIONING_EVIDENCE_PENDING

OPS-05 的工具链、ECS 部署目标（`tooling/aws-infra` ComputeStack 的 ingestion-api/ingestion-worker Fargate Service）、部署计划编排与回滚计划已实现并通过本地验证（单元测试 + `cdk synth` + dry-run CLI）。**尚未执行任何真实 AWS provisioning**：需要 AWS 凭据（GitHub OIDC）与用户提供域名后才可实际部署。

## 流水线

`deploy/aws/deploy.yml` — GitHub Actions（**仅 `workflow_dispatch` 手动触发**，避免 main 自动运行）。

1. 检出精确 CI-passed SHA（不可变制品，绝不从分支重建）；
2. 构建 `@aurora/aurora-release`；
3. 经 GitHub OIDC 换短期 AWS 身份（生产/非生产角色分离）；
4. `validate-migrations`（前向兼容检查，禁止破坏性 up / down）；
5. `plan`（dry-run 渲染 migrate → API → Worker → SPA 计划）；
6. ECS `update-service`，digest-pinned task definition + 部署熔断回滚。

## 前置（provisioning 前必须就绪）

- `AURORA_STAGING_ACCOUNT` / `AURORA_PRODUCTION_ACCOUNT`、`AURORA_PRIMARY_REGION`（GitHub vars/secrets）；
- 生产/非生产域名（用户提供，ADR-024）；边缘/DNS/TLS 资源在域名落位后由 IaC 创建；
- ECR 镜像已按 digest 推入；`bootstrap-placeholder` 占位 tag 永不作发布依据。

## 回滚

`tooling/aurora-release` 的 `planRollback`（`src/rollback.ts`）按服务回退上一 digest、SPA 入口回退、Worker drain 语义；**绝不自动运行破坏性 DB down Migration**（forward-fix/兼容方案，release-migration-and-rollback §4）。

## 与阿里云 Preview 的关系

`deploy/preview/`（`aurora.ah.cn` / `47.238.145.24`）保持 `temporary-operational-snapshot`，与本 AWS 流水线完全隔离；本目录不修改 Preview 任何文件。
