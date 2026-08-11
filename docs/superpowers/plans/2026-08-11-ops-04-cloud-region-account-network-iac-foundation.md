# OPS-04 Cloud Region / Account / Network / IaC Foundation Implementation Plan

> **For agentic workers:** This plan is executed INLINE by the main session (user override: no subagents, no executing-plans skill). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Aurora 正式 AWS 生产云的基础设施即代码（IaC）基座——账号/区域契约、网络基座、托管计算/数据服务边界、边缘/安全边界、GitHub OIDC 身份与命名/标签/删除保护，全部以 CDK TypeScript 表达并通过 `cdk synth` 验证，不创建任何真实 AWS 资源。

**Architecture:** 在现有 pnpm monorepo 内新增 `tooling/aws-infra`（`tooling` 层私有 workspace 包，包名 `@aurora/aws-infra`），用 AWS CDK（TypeScript）定义按环境（`staging`/`production`）组合的堆栈：NetworkStack（VPC/子网/NAT/SG/VPC Endpoint）、ComputeStack（ECS cluster/ECR/任务角色基础）、DataStack（私有加密 RDS PostgreSQL，删除保护；ElastiCache/S3 作为 deferred 边界不创建）、IdentityStack（GitHub OIDC + 分环境 CI 角色）。边缘/DNS/TLS 作为边界契约模块（域名必填校验、HTTPS/TLS/WAF 参数），不实例化真实 CloudFront/ALB/ACM/Route53 资源（defer 至 OPS-05，需用户提供真实域名）。

**Tech Stack:** AWS CDK v2（TypeScript）、aws-cdk-lib、constructs、vitest、pnpm workspace（`tooling` 层）。

## Global Constraints

- 正式生产平台 = **AWS**（TD-001=A，ADR-022/023/024 已 accepted）；主区域 **`ap-southeast-1`**（OPS-04 默认，provisioning 前可重新评估）。
- 账号模型：**双 AWS 账号**（非生产 staging/CI/PR + 生产）；账号 ID 作为环境配置输入，**不硬编码真实账号**（默认占位符，必须替换后才能 deploy）。
- IaC 工具：**AWS CDK（TypeScript）**；`cdk synth` 必须无凭据可运行（栈内 `new Vpc` 命令式定义，禁止 `fromLookup`）。
- **不创建真实 AWS 资源**：本计划只写 IaC 并 synth 验证；`cdk deploy` 属 OPS-05。不创建 Migration、不创建 production secret。
- ElastiCache Redis、私有 S3（Source Map）**defer**（真实消费者 platform-api + backend ADR accepted 前不创建）。
- 边缘/DNS/TLS：域名值由用户提供；**不购买域名、不把未知域名写入正式配置**（占位契约 + 必填校验）。
- 秘密不入仓库/日志/镜像；CI 用 GitHub OIDC 短期身份，生产/非生产角色分离，OIDC 信任策略按仓库 + environment 钉住 `sub`/`aud`。
- 命名/标签至少含 system、environment、Owner、data-classification、cost-center、managed-by。
- 生产删除保护（RDS deletionProtection、S3 blockPublicAccess/versioning 预留、CFN termination protection）。
- Workspace 门禁：`tooling/aws-infra` 必须通过 `typecheck`/`test`/`lint`/`format:check`/`check:boundaries`；coverage 为显式白名单（不含本包），不运行根 coverage。
- 版本钉住：`aws-cdk-lib`/`aws-cdk` 选已发布 ≥1 天的稳定版（`minimumReleaseAge: 1440`），Node 24 兼容。
- 不越界 OPS-05/06/07，不实现 G08/G04。

---

## File Structure

```
tooling/aws-infra/
  package.json                  # name=@aurora/aws-infra, aurora.layer=tooling, scripts(typecheck/build/test/synth/lint-notes)
  tsconfig.json                 # strict TS, extends ../../tsconfig.base.json
  tsconfig.build.json           # outDir dist
  vitest.config.ts              # vitest node env, include test/**/*.test.ts
  README.md                     # OPS-04 IaC 基座说明 + deploy guard + 域名必填说明
  src/
    config.ts                   # 环境/账号/区域契约 + 校验（纯函数，可测）
    naming.ts                   # 资源命名前缀 + 标准标签（system/environment/Owner/data-classification/cost-center/managed-by）
    edge-contract.ts            # 边缘/DNS/TLS 边界契约校验（域名必填、HTTPS/TLS/WAF 参数）——defer 到 OPS-05
    stacks/network-stack.ts     # VPC/子网/NAT/SG/VPC Endpoint
    stacks/compute-stack.ts     # ECS cluster + ECR + 任务执行角色（基础，无 Service）
    stacks/data-stack.ts        # RDS PostgreSQL（私有/加密/删除保护/备份 35d/Multi-AZ-prod）；Redis/S3 deferred 边界注释
    stacks/identity-stack.ts    # GitHub OIDC Provider + 分环境 CI 角色（钉 sub/aud）
    app.ts                      # 组合入口：按环境实例化上述栈 + Tag aspect + termination protection
  test/
    config.test.ts              # 环境/账号/区域/命名/标签契约测试
    stacks.test.ts              # 全 app synth 断言：RDS deletionProtection/加密/私有、无公网 DB、无 Redis/S3 资源、OIDC 角色、标签
package.json（根）               # format:check / lint 注册 tooling/aws-infra 路径
```

接口契约（跨任务复用）：

- `src/config.ts` 导出 `AURORA_ENVIRONMENTS`（`'staging' | 'production'`）、`DEFAULT_PRIMARY_REGION = 'ap-southeast-1'`、`interface EnvironmentConfig { name; isProduction; account: string; region: string }`、`function resolveEnvironmentConfig(name, overrides?): EnvironmentConfig`、`function assertDeployable(env): void`（占位账号时抛错，禁止误 deploy）。
- `src/naming.ts` 导出 `function resourceName(env, type, id): string`（`aurora-<env>-<type>-<id>`）、`function standardTags(env): Record<string, string>`、`const OWNER_TAG_VALUE = 'aurora-cloud-ops'`。
- `src/edge-contract.ts` 导出 `interface EdgeContract { domainName: string | undefined; httpsOnly: boolean; tlsMinVersion: '1.2'|'1.3'; wafRateLimitRps: number }`、`function validateEdgeContract(c): EdgeContract`（域名缺失抛稳定错误 `edge_domain_required`）。
- 栈构造签名：`new NetworkStack(scope, 'Network', { env })`、`new ComputeStack(scope, 'Compute', { env, vpc })`、`new DataStack(scope, 'Data', { env, vpc })`、`new IdentityStack(scope, 'Identity', { env })`。

---

### Task 1: CDK 工程脚手架 + 环境/账号/区域契约

**Files:**
- Create: `tooling/aws-infra/package.json`, `tooling/aws-infra/tsconfig.json`, `tooling/aws-infra/tsconfig.build.json`, `tooling/aws-infra/vitest.config.ts`, `tooling/aws-infra/README.md`
- Create: `tooling/aws-infra/src/config.ts`, `tooling/aws-infra/src/naming.ts`
- Create: `tooling/aws-infra/test/config.test.ts`
- Modify: `package.json`（根 `format:check` 与 `lint` 注册 `tooling/aws-infra` 文件/目录）

**Interfaces:**
- Produces: `resolveEnvironmentConfig(name, overrides?)`、`assertDeployable(env)`、`resourceName(env, type, id)`、`standardTags(env)`、`DEFAULT_PRIMARY_REGION`、`AURORA_ENVIRONMENTS`。

- [ ] **Step 1: 写失败测试** `tooling/aws-infra/test/config.test.ts`，覆盖：staging 非生产、production 生产；默认区域 `ap-southeast-1`；占位账号时 `assertDeployable` 抛稳定错误；`resourceName` 前缀 `aurora-<env>-`；`standardTags` 含 system/environment/Owner/data-classification/cost-center/managed-by 且生产 `deletion-protection` 提示位。

- [ ] **Step 2: 运行测试确认失败**：`pnpm --filter @aurora/aws-infra test` → 因包不存在失败。

- [ ] **Step 3: 脚手架 + 实现** `package.json`（`aurora.layer: tooling`，`engines.node >=24 <25`，deps：`aws-cdk-lib`/`constructs`，devDeps：`typescript`/`vitest`/`tsx`；scripts：`typecheck`/`build`/`test`/`synth`），tsconfig（strict、extends 根 base、DOM 不必要），vitest config（node env），`src/config.ts`（AURORA_ENVIRONMENTS 默认账号占位符 `000000000000`/`111111111111`，region 默认 `ap-southeast-1`，`resolveEnvironmentConfig` 允许 env 覆盖 `AURORA_<NAME>_ACCOUNT`/`AURORA_<NAME>_REGION`，`assertDeployable` 在账号为占位符或缺失时抛 `invalid_account_placeholder`），`src/naming.ts`（如上接口），README.md。

- [ ] **Step 4: 运行测试确认通过**：`pnpm --filter @aurora/aws-infra test` → 全绿；`pnpm --filter @aurora/aws-infra typecheck` → 通过。

- [ ] **Step 5: 注册根 format/lint**：根 `package.json` 的 `format:check` 追加 `tooling/aws-infra/package.json tooling/aws-infra/tsconfig.json tooling/aws-infra/tsconfig.build.json tooling/aws-infra/vitest.config.ts "tooling/aws-infra/src/**/*.ts" "tooling/aws-infra/test/**/*.ts" tooling/aws-infra/README.md`；`lint` 追加 `tooling/aws-infra/src tooling/aws-infra/test tooling/aws-infra/vitest.config.ts`。

- [ ] **Step 6: 定向验证**：`pnpm format:check`（仅注册路径由 prettier 检查）与 `pnpm lint` 通过；`pnpm check:boundaries` 通过（tooling 层合法）。Commit：`feat(infra): scaffold aws-infra CDK package with environment/account/region contract`.

---

### Task 2: 网络基座 + 边缘/DNS/TLS 边界契约

**Files:**
- Create: `tooling/aws-infra/src/edge-contract.ts`, `tooling/aws-infra/test/edge-contract.test.ts`, `tooling/aws-infra/src/stacks/network-stack.ts`

**Interfaces:**
- Consumes: `EnvironmentConfig`（Task 1）、`resourceName`/`standardTags`（Task 1）。
- Produces: `validateEdgeContract(c): EdgeContract`、`new NetworkStack(scope, id, { env })`。

- [ ] **Step 1: 写失败测试** `edge-contract.test.ts`：域名缺失抛 `edge_domain_required`；`httpsOnly=false` 抛稳定错误；tlsMinVersion 非法抛错；合法契约返回冻结对象。`stacks.test.ts`（新建，本 Task 仅网络断言）：synth 后 VPC 存在、有公有/私有子网、生产含 NAT、无 `AWS::RDS::DBInstance` 等无关资源。

- [ ] **Step 2: 运行确认失败**：`pnpm --filter @aurora/aws-infra test` → 契约测试与网络断言失败。

- [ ] **Step 3: 实现** `edge-contract.ts`：域名缺失/`httpsOnly=false`/非法 tls → 稳定错误；成功返回 `Object.freeze`。`network-stack.ts`：`new Vpc`（命令式，无 lookup），配置 `maxAzs: isProduction ? 3 : 2`、`natGateways`（生产 1，staging 0 简化成本）、公有/私有子网、SG（数据库/服务最小规则由 OPS-05 细化）、VPC Endpoints（`InterfaceVpcEndpoint` S3 Gateway + SecretsManager + ECR/CloudWatch 预留注释）；全部资源经 `Tags.of(...)` 打 `standardTags`。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aws-infra test` → 全绿；`pnpm --filter @aurora/aws-infra typecheck` 通过。

- [ ] **Step 5: Commit**：`feat(infra): network base stack + edge/dns/tls boundary contract`.

---

### Task 3: 托管计算/数据服务基础 + 秘密边界（RDS/ECS/ECR；Redis/S3 deferred）

**Files:**
- Create: `tooling/aws-infra/src/stacks/compute-stack.ts`, `tooling/aws-infra/src/stacks/data-stack.ts`
- Modify: `tooling/aws-infra/test/stacks.test.ts`（追加 Data/Compute 断言）

**Interfaces:**
- Consumes: `EnvironmentConfig`、`resourceName`/`standardTags`、`NetworkStack`（`vpc` 属性）。
- Produces: `new ComputeStack(scope, id, { env, vpc })`、`new DataStack(scope, id, { env, vpc })`。

- [ ] **Step 1: 写失败测试**（追加到 `stacks.test.ts`）：DataStack synth 后含 `AWS::RDS::DBInstance` 且 `DBInstance` 属性 `deletionProtection=true`（生产）、`publiclyAccessible=false`、`storageEncrypted=true`、`backupRetentionDays>=35`；**不含** `AWS::ElastiCache::CacheCluster` 与 `AWS::S3::Bucket`（deferred 边界）。ComputeStack synth 后含 `AWS::ECS::Cluster` 与 ≥2 个 `AWS::ECR::Repository`（ingestion-api/ingestion-worker），**不含** `AWS::ECS::Service`（OPS-05）。

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3: 实现** `compute-stack.ts`：ECS Cluster（`containerInsights` 关闭或开启按 env）、ECR 仓库（ingestion-api/ingestion-worker，`imageScanOnPush`、`lifecycle` 保留近期版本）、任务执行角色（最小权限策略骨架：ECR pull、日志、SecretsManager read），不创建 ECS Service。`data-stack.ts`：RDS PostgreSQL 17（`engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_17_5 })` 或等），生产 `multiAz: true`、`deletionProtection: true`、`storageEncrypted: true`、`backupRetentionDays: 35`、`instanceType`（staging 最小，生产占位 `t3.medium` 注释 `requires-benchmark`）、`vpcSubnets: private`、安全组最小入口；文件头注释明确 **ElastiCache Redis 与私有 S3（Source Map）defer**（真实消费者 + backend ADR）。

- [ ] **Step 4: 运行确认通过**。

- [ ] **Step 5: Commit**：`feat(infra): compute foundation (ECS/ECR/roles) + private encrypted RDS; redis/s3 deferred`.

---

### Task 4: GitHub OIDC 身份 + App 组合（标签/删除保护全局落位）

**Files:**
- Create: `tooling/aws-infra/src/stacks/identity-stack.ts`, `tooling/aws-infra/src/app.ts`
- Modify: `tooling/aws-infra/test/stacks.test.ts`（追加 Identity/App 断言）

**Interfaces:**
- Consumes: Task 1—3 全部。
- Produces: `new IdentityStack(scope, id, { env })`、`app.ts` 导出 `function buildAuroraApp(envNames?)`。

- [ ] **Step 1: 写失败测试**（追加）：synth 后含 `AWS::IAM::OIDCProvider`（GitHub）与每个环境 ≥1 个 `AWS::IAM::Role`；CI 角色 AssumeRole 策略钉 `token.actions.githubusercontent.com`、`aud=sts.amazonaws.com`、`sub` 含 `repo:GehrmannMerlin/Aurora:environment:<env>`（占位 GitHub org 名可配置）；生产栈 `terminationProtection`；所有栈资源带 cost-center 标签。

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3: 实现** `identity-stack.ts`：`OpenIdConnectProvider`（`https://token.actions.githubusercontent.com`）+ 分环境 IAM Role（assume role policy 钉 `aud: sts.amazonaws.com`、`sub: repo:${GITHUB_ORG}:environment:${env}`，`GITHUB_ORG` 来自 config 默认 `GehrmannMerlin/Aurora`），生产角色与 staging 角色分离；不存长期密钥。`app.ts`：`buildAuroraApp(envNames = ['staging','production'])` 对每个环境创建 Network/Compute/Data/Identity 四栈；用 `Aspects`/`Tags.of` 对全部资源打 `standardTags`；`CfnStack.terminationProtection = true`（生产）；`synth` 无凭据可跑（env 账号用 config 解析结果）。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aws-infra test` 全绿；`pnpm --filter @aurora/aws-infra synth`（npm script：`cdk synth --app '.../app.ts' --all --no-lookups` 或等价 tsx 入口）成功。

- [ ] **Step 5: Commit**：`feat(infra): github oidc identity + app composition with cost tags and termination protection`.

---

### Task 5: 定向验证 + 文档同步

**Files:**
- Modify: `tooling/aws-infra/README.md`, `docs/operations/ops04-foundation-audit-and-migration-surface.md`（标记 OPS-04 已实施部分）, `AGENTS.md`, `AURORA_RULES.md`（G16/OPS-04 条目：ADR-022/023/024 accepted、OPS-04 implementation 进度、计数保持 62/16）

**Interfaces:**
- Consumes: Task 1—4 全量。

- [ ] **Step 1: IaC 静态验证**：`pnpm --filter @aurora/aws-infra synth` → 全部环境模板生成成功（staging/production × 4 栈）；`pnpm --filter @aurora/aws-infra test` → 契约 + 栈断言全绿；`pnpm --filter @aurora/aws-infra typecheck`、`pnpm lint`、`pnpm format:check`（注册路径）、`pnpm check:boundaries` 通过。

- [ ] **Step 2: secret-negative 审计**：`grep -rnE 'AKIA|BEGIN .*PRIVATE KEY|aurora_ingest_|SecretAccessKey' tooling/aws-infra/` → 无命中（只允许占位符/`$` 变量）。

- [ ] **Step 3: dry-run/plan 等价验证**：`cdk synth` 即 CloudFormation 模板生成（等价 terraform plan 的静态面）；确认模板内 `deletionProtection: true`（生产 RDS）、`publiclyAccessible: false`、无 ElastiCache/S3/ECS-Service 资源；`git diff --check` 干净。

- [ ] **Step 4: 文档同步**：更新 README.md（synth 用法、deploy guard、域名必填、Redis/S3 deferred、Preview 隔离）；审计文档标记 OPS-04 IaC 已实施；AGENTS.md/AURORA_RULES.md 追加 G16/OPS-04 条目（ADR-022/023/024 accepted/in-progress、OPS-04 implementation = completed（本增量）、acceptance = 待 IaC 独立验收 + OPS-05、计数 62/16 不变、阿里云 Preview 保持 temporary）。

- [ ] **Step 5: Commit**：`docs(infra): ops-04 validation evidence + entry sync (count stays 62/16)`.

---

## Self-Review

**Spec coverage（OPS-04 规格 §4—19）**：§4 账号/环境 = Task 1 config；§5 区域 = Task 1（`ap-southeast-1`）；§6 IaC = 全计划 CDK；§7 网络 = Task 2；§8 计算 = Task 3；§9 PostgreSQL = Task 3；§10 Redis = Task 3 deferred 边界；§11 对象存储 = Task 3 deferred 边界；§12 秘密/加密 = Task 3 注释 + Task 5 audit + Identity 无长期密钥；§13 DNS/域名/HTTPS = Task 2 edge-contract；§14 边缘/公开入口 = Task 2（WAF/速率/TLS 参数契约）；§15 环境配置 = Task 1；§16 命名/标签 = Task 1 + Task 4 全局 Aspects；§17 成本 = Task 4 cost-center 标签；§18 生命周期/销毁 = Task 3/4 删除保护；§19 漂移/可重复创建 = Task 5 synth + README。**无遗漏。**

**Placeholder scan**：无 "TBD/TODO/合适错误处理" 等占位描述；唯一占位是**账号 ID 与域名**——已定义为配置输入 + 必填/禁 deploy 校验（有意为之，属 approved 契约）。

**Type consistency**：`EnvironmentConfig`、`resolveEnvironmentConfig`、`assertDeployable`、`resourceName`、`standardTags`、`validateEdgeContract`、`EdgeContract`、`NetworkStack/ComputeStack/DataStack/IdentityStack` 构造签名与 `buildAuroraApp` 在 Task 1—5 间一致。

**本计划不创建真实 AWS 资源、不运行 `cdk deploy`、不越界 OPS-05/06/07、不实现 G08/G04。**
