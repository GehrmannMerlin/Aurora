---
title: Aurora 发布、Migration 与回滚
status: approved
owner: release
last-reviewed: 2026-07-29
applies-to: Aurora SPA、API、Worker、SDK、数据库 Migration、制品晋级和回滚
related:
  - ../../AURORA_RULES.md
  - ../../Aurora 测试规范.md
  - ../architecture/deployment.md
  - ../testing/test-strategy.md
  - ../operations/backup-and-recovery.md
  - ../adr/README.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
review-cycle: release-policy-or-migration-change
---

# Aurora 发布、Migration 与回滚

## 1. 发布原则

本文正式承载 approved 不可变制品、分阶段晋级、expand/contract Migration 和受保护生产批准规则。第一版部署为 provider-neutral 单主机 Docker Compose（accepted [ADR-036](../adr/ADR-036-provider-neutral-single-host-deployment.md)，`supersedes` ADR-022/023/024 的 AWS-first 方向）；部署/回滚经 `pnpm deploy:preview` / `deploy:preview:rollback` 受控执行，不再依赖 ECS/CloudWatch/ECS task definition。GitHub Actions 是 approved 设计方向，但流水线、Environment、OIDC 角色、制品仓库和真实命令均不存在；发布基础设施为 `requires-accepted-adr`。

## 2. 晋级序列

1. Pull Request 完成文档、ADR、架构、类型、测试、契约和安全门禁；
2. 同一提交生成 SPA、API、Worker、SDK（如适用）和发布清单；
3. 同一候选制品部署预发布并运行核心 E2E、Migration、回滚/恢复烟雾和安全检查；
4. 独立生产批准者检查差异、SLO/告警、备份、兼容窗口和回滚条件；
5. 先执行兼容的 expand Migration，再部署兼容 API/Worker，观察健康和业务不变量；
6. 切换新行为并执行有界 backfill；旧版本与旧路径退出后，后续独立发布才允许 contract；
7. 部署后验证公开 API、关键业务链、队列/Outbox、水位、审计和告警，再关闭发布窗口。

提交者不得独自批准未经独立复核的高风险生产变更。生产只能晋级预发布验证过的 digest/哈希，不重新构建。

## 3. 数据库 Migration

- 使用全局互斥或版本前置，重复运行必须幂等或安全失败；
- expand 先增加兼容结构，应用在兼容窗口内支持新旧数据；
- 大表 backfill 分批、可暂停、可续跑、有限并发，并观测锁、延迟、复制和存储水位；
- contract 只在旧应用和旧数据路径退出、回滚窗口关闭后进行；
- Migration 失败立即停止后续部署，保留证据并按 Runbook 恢复；
- 不自动运行破坏性 down Migration；数据修复需要独立审核、恢复点和验证。

实际 SQL、数据模型、Migration 工具和批次参数为 `deferred`/`implementation-detail`，在数据库 ADR accepted 前不能创建权威脚本。

## 4. SPA、API 与 Worker 回滚

- Docker Compose 单主机使用健康检查、`restart: unless-stopped` 与部署前 `docker compose config` 校验；失败时回滚到上一已验证 release/digest（`deploy:preview:rollback` 回退到上一成功 release，不自动回退破坏性 DB Migration，向后不兼容时停止并报告）；
- 应用回滚必须继续兼容已执行的 expand 结构，不依赖破坏性数据库回退；
- SPA 以版本前缀和内容哈希发布，入口切换失败时恢复上一入口版本；旧静态资源保留兼容窗口，避免已打开页面引用失效；
- Worker 可暂停消费、回滚版本后续跑；不得丢弃已经可靠接收或 Outbox 中的事实；
- 回滚后仍要验证业务不变量、队列积压、审计和数据水位，不能只看进程健康。

## 5. SDK 发布与兼容

- npm 发布遵循 SemVer、精确文件清单、公开 exports、类型、tree-shaking、包体、安装和真实示例验证；
- 协议、SDK、接入与消费者的兼容组合必须进入发布清单；
- 已发布包不可覆盖；撤回或弃用必须保留迁移说明；
- SDK 与应用制品可以独立发布，但版本编排、统一/独立版本策略属于 `requires-accepted-adr`。

## 6. 发布证据与阻断

发布证据至少包含提交/制品摘要、SBOM/来源证明、测试矩阵、性能预算、Migration/回滚结果、备份恢复结果、已知风险、批准者和部署后验证。缺少必要证据、协议不兼容、恢复失败、数据删除复活、秘密泄露或错误预算耗尽时阻止非关键发布。

当前没有流水线、制品、数据库或环境，本文不能被解释为已发布或可直接发布。
