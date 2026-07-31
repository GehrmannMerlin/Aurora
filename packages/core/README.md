# SDK Core

`@aurora/core` 是 Aurora SDK 的环境无关生命周期与插件编排基础包。包保持私有，不代表已经发布到 npm。

## 模块定位

Core 为每个 `createCore()` 调用建立独立实例，负责最小配置、生命周期、插件顺序、标准事件信封入口和有界内部诊断。Core 不访问 Browser 环境，也不负责采集或发送。

## 职责

- 提供 `created`、`initialized`、`started`、`stopped`、`destroyed` 生命周期；
- 提供默认 `maxDiagnosticEntries` 为 `100` 的冻结配置快照；
- 在单实例内串行化异步生命周期调用；
- 注册并隔离插件，按注册顺序初始化/启动、逆序停止/销毁；
- 通过 `@aurora/event-schema` 根入口验证标准事件信封；
- 提供每实例有界且不含异常内容的诊断结果。

## 非职责

- Browser 环境层和浏览器对象；
- 错误、请求、性能、资源等具体采集插件；
- React/Vue 适配、采样、队列、批次、网络传输、重试或持久化；
- 数据接入、服务端、CI、发布、容器、IaC 或云资源。

## 对外接口

```ts
import {
  createCore,
  type AuroraCore,
  type CoreConfigInput,
  type CoreDiagnostic,
  type CoreEventResult,
  type CoreLifecycleResult,
  type CorePlugin,
  type CorePluginContext,
} from '@aurora/core';
```

包只有根公开入口。禁止导入 `src`、`internal` 或未导出的子路径。

## 生命周期

```text
created --initialize--> initialized --start--> started
                                   ^            |
                                   |            v
                                   +---start-- stopped

任一未销毁状态 --destroy--> destroyed
```

`initialize`、`start`、`stop`、`destroy` 返回 Promise，并在单实例内按调用顺序执行。重复初始化、启动、停止和销毁返回稳定幂等结果；销毁后不能初始化、启动、注册插件、更新配置或接受事件。

配置没有必填字段。可在 `initialized` 或 `stopped` 更新 `maxDiagnosticEntries`，合法范围为 1—1000；`started` 状态锁定更新。所有成功配置都是新建并冻结的快照。

## 插件契约

插件名必须是 1—64 字符 kebab-case。插件只在 `created` 注册；首次初始化尝试后注册关闭。初始化和启动按注册顺序，停止和销毁按逆序。同步异常和 Promise 拒绝不会冒泡；失败插件被隔离，其他插件继续，销毁仍执行一次。

`CorePluginContext` 只有冻结的 `submitEvent(input: unknown)`。插件不能读取 Core 配置、诊断、其他插件或私有状态，也不能通过 Core 获得独立上报通道。

## 事件入口

`submitEvent(input: unknown): CoreEventResult` 仅在 `started` 接受输入，并调用 `@aurora/event-schema` 的 `parseEventEnvelope`。`accepted` 只表示 Core 已启动且信封通过校验；它不表示事件已采样、保留、排队、批处理、发送或持久化。Core 不修改或保存协议对象。

## 诊断与隐私

`getDiagnostics()` 返回冻结副本。诊断只包含实例内序号、稳定代码、操作和可选的已验证插件名，不包含异常消息、堆栈、配置值、事件内容、URL、凭据、IP 或用户数据。容量默认 100，最大 1000，超限移除最旧记录。

## 依赖边界

唯一运行时依赖是 `@aurora/event-schema` 根公开出口。Core 在无 DOM TypeScript 环境编译，不引用浏览器全局，不依赖 Browser、具体插件、框架或服务端包，不声明全局可变单例。

## 开发与测试

```bash
pnpm --filter @aurora/core typecheck
pnpm --filter @aurora/core test
pnpm --filter @aurora/core test:coverage
pnpm --filter @aurora/core build
pnpm --filter @aurora/core test:package
pnpm check:boundaries
pnpm check:ci
```

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。无 DOM 编译、包根入口、私有路径拒绝、依赖层级、浏览器全局和模块级可变状态均有自动门禁。

## 关联文档

- [Core 基础规格](../../docs/sdk/sdk-core-foundation.md)
- [SDK 架构](../../docs/architecture/sdk-architecture.md)
- [event-schema 基础规格](../../docs/protocol/event-schema-foundation.md)
- [ADR-003](../../docs/adr/ADR-003-sdk-plugin-architecture.md)
- [ADR-005](../../docs/adr/ADR-005-event-schema-source-of-truth.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [测试策略](../../docs/testing/test-strategy.md)
