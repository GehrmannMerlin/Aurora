---
title: Aurora 事件信封协议版本 1
status: approved
owner: protocol
last-reviewed: 2026-07-30
applies-to: @aurora/event-schema 事件公共信封版本 1
related:
  - event-schema-foundation.md
  - ../../packages/event-schema/README.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../testing/test-strategy.md
supersedes: none
review-cycle: protocol-change-or-release
---

# Aurora 事件信封协议版本 1

## 1. 范围

版本 `1` 只定义事件公共信封和通用资源/禁止字段边界。`body` 的具体事件字段尚未定义；信封通过不表示具体事件正文可被接入或处理系统接受。

## 2. 字段

| 字段              | 类型           | 必填 | 限制                                          | 含义                                   |
| ----------------- | -------------- | ---: | --------------------------------------------- | -------------------------------------- |
| `protocolVersion` | 数字字面量 `1` |   是 | 只接受受支持列表中的精确值                    | 公共协议主版本                         |
| `eventId`         | string         |   是 | 长度 1—128                                    | 客户端生成且重试保持不变的稳定事件编号 |
| `eventType`       | enum           |   是 | `error`、`request`、`performance`、`resource` | 已批准的事件类别                       |
| `occurredAt`      | number         |   是 | 正安全整数，Unix epoch 毫秒                   | 事件真实发生时间                       |
| `body`            | unknown        |   是 | 通过第 3 节通用边界；具体 Schema 尚未定义     | 后续具体事件正文                       |

顶层不接受其他字段。客户端时钟合理性和服务端校正属于后续接入/处理契约，本版本只校验正安全整数。

## 3. 通用正文边界

- 字符串最长 4096 个 UTF-16 code units；
- 数组最多 100 项；
- 单个对象最多 100 个自有可枚举键；
- 根正文深度为 0，最大对象/数组嵌套深度为 8；
- 数字必须有限；只接受 JSON 可表达值和普通对象；
- 循环引用拒绝；最多返回 50 个 issue；
- 任意层级拒绝 `authorization`、`cookie`、`password`、`requestBody`、`responseBody`、`formData`、`dom`、`consoleLog`、`ipAddress`，字段名按 ASCII 小写比较。

本边界不是完整脱敏器。SDK 和服务端仍必须执行各自的允许列表、隐私过滤和具体事件 Schema。

## 4. 合法示例

<!-- contract-example:valid-protocol -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-protocol-synthetic-valid",
  "eventType": "performance",
  "occurredAt": 1800000000400,
  "body": {
    "optionalContext": {
      "attempt": 1
    }
  }
}
```

## 5. 非法示例

<!-- contract-example:invalid-protocol -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-protocol-synthetic-invalid",
  "eventType": "request",
  "occurredAt": 1800000000401,
  "body": {
    "authorization": "synthetic"
  }
}
```

该示例返回 `forbidden_field`，测试不会记录正文值。

## 6. 失败语义

解析器返回 `success: false` 和稳定 issue。必填缺失、类型、未知顶层字段、大小、深度、非法时间、事件类型、协议版本、循环和禁止字段分别有明确 code。普通非法输入不抛异常，也不写日志。

## 7. 兼容性

当前仅支持版本 `1`，不存在历史协议转换。版本 `0` 与 `2` 都明确拒绝。同版本信封可以在 `body` 中增加通用边界允许的可选数据；这只证明信封级兼容，不能代替未来具体事件字段兼容。删除/重释字段、改变类型、把可选字段改为必填或改变枚举含义是不兼容变化，必须先有 accepted ADR、迁移和旧版本处理方案。

版本协商公共入口：`negotiateProtocolVersion(input)`（见[协议兼容边界](protocol-compatibility-boundary.md)）返回 `{ ok: true, code: 'supported' }` 或 `{ ok: false, code: 'unsupported_version' }`；SDK 与消费者不得把未知/更新版本降级、猜测或改写。当前兼容转换能力为空，`@aurora/event-schema` 不导出任何转换函数。

## 8. 共享样本

SDK、数据接入和数据处理的契约测试统一从 `@aurora/event-schema/contract-testkit` 导入合法、非法和边界样本。消费者不得复制并改写这些样本的协议含义。

## 9. 精确错误事件解析

公共 `parseEventEnvelope(input: unknown)` 继续只校验信封和通用 `body` 资源边界，成功结果的 `body` 保持 `unknown`。

错误事件必须继续调用 `parseErrorEventEnvelope(input: unknown)`。该入口复用本信封的版本、编号、事件类型和时间戳规则，要求 `eventType` 为 `error`，再按[错误事件协议契约](error-event-contract.md)校验 JavaScript、未处理 Promise 拒绝或资源加载错误正文。

资源加载错误属于 `eventType: "error"` 与 `body.category: "resource"` 的组合，不使用公共 `eventType: "resource"`。通过通用信封解析不等于通过精确错误正文解析。

## 10. 精确请求事件解析

请求事件必须调用 `parseRequestEventEnvelope(input: unknown)`。该入口复用本信封的版本、编号、事件类型和时间戳规则，要求 `eventType` 为 `request`，再按[请求事件协议契约](request-event-contract.md)校验最小安全请求正文（方法、安全 URL、开始时间、持续时间、结果类别和可选状态码）。`EventType.Request` 表示请求事件类别；请求监控的允许来源、同源、跨域和路径归一化判断不属于协议层。通过通用信封解析不等于通过精确请求正文解析。
