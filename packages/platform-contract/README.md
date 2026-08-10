# Platform Contract

`@aurora/platform-contract` 是 Aurora 管理平台公开契约的唯一权威来源（single source of truth for the Platform OpenAPI）。包目前保持私有，不代表已经发布到 npm。

## 模块定位

本包属于 `contract` 层，以确定性、可复现的方式定义管理平台公开机器契约：公共与领域 Zod Schema、A1—D2 操作集的操作注册表、生成 `docs/api/platform-openapi-v1.yaml` 的确定性生成器，以及已生成的 Client/Server 适配器、契约测试工具与漂移门禁。

## 职责

- 定义 Platform OpenAPI v1 的公共与领域 Schema（`src/common`、`src/identity`）；
- 维护 A1—D2 操作集的操作注册表与预期操作清单（`src/registry`）；
- 定义请求监控投影稳定操作 `requestsListEndpoints`（`src/monitoring/request-metrics.ts`，DAT-16）：请求/响应 Schema 与项目级查询契约；分页游标承载接口 keyset 游标 `base64url(method\nurl)`（`paginationMeta.cursor`/`nextCursor` 与 `requestsListEndpointsQuery.cursor` bound `4096`）；
- 以确定性生成器产出机器可读 Platform OpenAPI v1（`docs/api/platform-openapi-v1.yaml`）与覆盖清单（`docs/api/platform-openapi-v1.manifest.json`）；
- 提供已生成的 Client 适配器（`/client`）与服务端适配器（`/server`）；
- 提供契约测试样本与辅助工具（`/contract-testkit`）；
- 通过漂移门禁（`tooling/platform-contract-drift`）保证生成物与契约源码逐字节一致，禁止手工修改生成物。

## 非职责

- 不实现任何业务处理器、数据库、队列或数据模型；
- 不重新解释 `@aurora/event-schema`，事件协议仍以 `event-schema` 为唯一来源；
- 不实现管理平台后端服务、Session、权限、审计或部署；
- 不提供未计划端点；机器契约只覆盖已批准的第一版操作集。

## 对外接口

包导出四个真实入口，全部指向 `dist/`（由 `pnpm --filter @aurora/platform-contract build` 生成）。生成器 `src/generator/` 是内部实现，不对外导出。

### 根入口 `@aurora/platform-contract`

公共与领域 Schema、标识符、操作注册表、预期清单与身份/导航契约形状：

```ts
import {
  PLATFORM_CONTRACT_VERSION,
  ROUTE_TARGET_IDS,
  identityGetSessionResponse,
  navigationGetContextResponse,
  PLATFORM_OPERATIONS,
  OPERATION_MANIFEST,
  auroraProblem,
  obj,
  str,
} from '@aurora/platform-contract';
import type {
  PlatformContractVersion,
  OperationDef,
  RouteTargetId,
} from '@aurora/platform-contract';
```

### `/client` 入口

生成的 Client 请求描述与响应校验：

```ts
import {
  buildRequest,
  parseResponse,
  ClientInputError,
  PLATFORM_OPERATIONS,
} from '@aurora/platform-contract/client';
import type { OperationRequest, OperationResult } from '@aurora/platform-contract/client';
```

### `/server` 入口

生成的服务端输入校验与输出序列化：

```ts
import {
  parseInput,
  serializeOutput,
  problemSchema,
  listServerOperations,
} from '@aurora/platform-contract/server';
import type { HttpMethod, AuthLevel, OperationDef } from '@aurora/platform-contract/server';
```

### `/contract-testkit` 入口

契约测试样本与辅助工具（无秘密）：

```ts
import {
  validSessionSamples,
  invalidSessionSamples,
  validNavigationSamples,
  invalidNavigationSamples,
  validProblemSamples,
  invalidProblemSamples,
} from '@aurora/platform-contract/contract-testkit';
```

禁止导入 `src`、`generator`、`internal`、测试文件或未导出的子路径。

## 依赖边界

本包属于 `contract` 层，只能依赖 `protocol` 层（`@aurora/event-schema`）或外部包；不得依赖 `service`、`data`、`sdk-*`、`tooling` 或任何 Aurora 本地业务包。当前增量只依赖外部 `zod`，未导入 `@aurora/event-schema`。Workspace Policy 的 `forbidden-layer-dependency` 与 `private-path-import` 规则由 `pnpm check:boundaries` 强制执行。

## 生成物与漂移门禁

生成物（`docs/api/platform-openapi-v1.yaml`、`docs/api/platform-openapi-v1.manifest.json`、Client/Server 适配器、样本）带有“由契约源码生成、禁止手工修改”标记；重新生成必须逐字节相同，CI 通过漂移门禁（`tooling/platform-contract-drift`，经根 `openapi:check` 与 `platform-contract:drift`）校验生成物与契约源码保持一致。

## 命令

```bash
pnpm platform-contract:generate   # 从契约源码生成 Platform OpenAPI v1 与适配器
pnpm platform-contract:drift      # 漂移门禁：断言生成物与契约源码一致
pnpm openapi:platform:lint        # Redocly lint docs/api/platform-openapi-v1.yaml
```

## 开发与测试

```bash
pnpm --filter @aurora/platform-contract typecheck
pnpm --filter @aurora/platform-contract test
pnpm --filter @aurora/platform-contract test:coverage
pnpm --filter @aurora/platform-contract build
pnpm --filter @aurora/platform-contract test:package
```

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%，由根 `pnpm test:coverage` 强制执行（本包已接入该链）。

Schema 按 OpenAPI 3.1（JSON Schema 2020-12）语义导出：可空字段以 `type: [T, 'null']` 联合表达，不使用 draft-04 的 `nullable: true` 关键字。

## 关联文档

- [Platform Contract Foundation 规格](../../docs/architecture/platform-contract-foundation.md)
- [平台 OpenAPI 与实现约束设计](../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)
- [ADR-025](../../docs/adr/ADR-025-platform-frontend-technology-stack.md)
- [ADR-026](../../docs/adr/ADR-026-platform-backend-runtime-and-contract-chain.md)
- [ADR-027](../../docs/adr/ADR-027-platform-contract-codegen-tooling.md)
- [ADR-028](../../docs/adr/ADR-028-platform-session-csrf-security.md)
