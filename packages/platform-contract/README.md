# Platform Contract

`@aurora/platform-contract` 是 Aurora 管理平台公开契约的唯一权威来源（single source of truth for the Platform OpenAPI）。包目前保持私有，不代表已经发布到 npm。

## 模块定位

本包属于 `contract` 层，以确定性、可复现的方式定义管理平台公开机器契约：公共与领域 Zod Schema、A1—D2 操作集的操作注册表、生成 `docs/api/platform-openapi-v1.yaml` 的确定性生成器，以及生成 Client/Server 适配器、漂移门禁和契约测试工具。

## 职责

- 定义 Platform OpenAPI v1 的公共与领域 Schema；
- 维护 A1—D2 操作集的操作注册表与预期操作清单；
- 以确定性生成器产出机器可读 Platform OpenAPI（v1）与覆盖清单；
- 生成 Client/Server 适配器（规划入口 `/client`、`/server`）；
- 提供契约测试样本与辅助工具（规划入口 `/contract-testkit`）；
- 通过漂移门禁保证生成物与契约源码逐字节一致，禁止手工修改生成物。

## 非职责

- 不实现任何业务处理器、数据库、队列或数据模型；
- 不重新解释 `@aurora/event-schema`，事件协议仍以 `event-schema` 为唯一来源；
- 不实现管理平台后端服务、Session、权限、审计或部署；
- 不提供未计划端点；机器契约只覆盖已批准的第一版操作集。

## 对外接口

当前已存在根入口：

```ts
import { PLATFORM_CONTRACT_VERSION, type PlatformContractVersion } from '@aurora/platform-contract';
```

规划中的子路径由后续任务落地，当前尚未导出：

- `@aurora/platform-contract/client` — 生成 Client 适配器；
- `@aurora/platform-contract/server` — 生成服务端适配器；
- `@aurora/platform-contract/contract-testkit` — 契约测试样本与辅助工具。

禁止导入 `src`、`internal`、测试文件或未导出的子路径。

## 依赖边界

本包属于 `contract` 层，只能依赖 `protocol` 层（`@aurora/event-schema`）或外部包；不得依赖 `service`、`data`、`sdk-*`、`tooling` 或任何 Aurora 本地业务包。当前增量尚未导入 `@aurora/event-schema`。

## 生成物与漂移门禁

生成物（`docs/api/platform-openapi-v1.yaml`、Client/Server 适配器、覆盖清单、样本）带有“由契约源码生成、禁止手工修改”标记；重新生成必须逐字节相同，CI 通过漂移门禁校验生成物与契约源码保持一致。

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

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。

## 关联文档

- [Platform Contract Foundation 规格](../../docs/architecture/platform-contract-foundation.md)
- [平台 OpenAPI 与实现约束设计](../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)
- [ADR-026](../../docs/adr/ADR-026-platform-backend-runtime-and-contract-chain.md)
- [ADR-027](../../docs/adr/ADR-027-platform-contract-codegen-tooling.md)
