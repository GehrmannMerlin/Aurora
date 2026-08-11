# @aurora/aws-infra

Aurora OPS-04 AWS region/account/network/IaC foundation（CDK TypeScript）。

> **本包只写 IaC 并 `synth` 验证，不创建任何真实 AWS 资源。** `cdk deploy` 属 OPS-05。

## 范围

- 环境/账号/区域契约：`staging`（非生产账号）+ `production`（生产账号），主区域默认 `ap-southeast-1`（OPS-04 默认，provisioning 前可重新评估）。
- 网络基座：VPC/子网/NAT/SG/VPC Endpoint（NetworkStack）。
- 托管计算基础：ECS cluster + ECR（ingestion-api/ingestion-worker）+ 任务执行角色（ComputeStack）；不创建 ECS Service（属 OPS-05）。
- 托管数据基础：RDS PostgreSQL 17（私有、加密、删除保护、备份 35 天、生产 Multi-AZ）（DataStack）。
- **ElastiCache Redis 与私有 S3（Source Map）defer**：真实消费者（platform-api + backend ADR accepted）前不创建。
- 边缘/DNS/TLS 为边界契约（`src/edge-contract.ts`）：域名必填校验、HTTPS only、TLS ≥1.2 优先 1.3、WAF/速率限制参数；真实 CloudFront/ALB/Route 53/ACM 属 OPS-05，需用户提供域名。
- 身份：GitHub OIDC Provider + 分环境 CI 角色（钉 `aud`/`sub`，生产/非生产分离）（IdentityStack）。

## 用法

```bash
pnpm --filter @aurora/aws-infra typecheck
pnpm --filter @aurora/aws-infra test
pnpm --filter @aurora/aws-infra build
pnpm --filter @aurora/aws-infra synth    # 生成 cdk.out CloudFormation 模板（无凭据）
```

## 部署守卫（deploy 前必读）

- 账号 ID 默认占位符（`111111111111`/`222222222222`）。`cdk deploy` 前必须设置
  `AURORA_STAGING_ACCOUNT` / `AURORA_PRODUCTION_ACCOUNT`（12 位真实账号）；`assertDeployable`
  对占位/非法账号抛稳定错误，防止误用占位账号。
- 秘密不入仓库/日志/镜像；生产域名值由用户提供后才进入边缘资源。

## 与 Preview 隔离

阿里云单机 Public Preview（`public-preview`）保持 `temporary-operational-snapshot`，
仅作现状/迁移输入；本 IaC 面向正式 AWS 生产基座，二者身份/数据/秘密隔离。
