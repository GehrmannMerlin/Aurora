---
title: Aurora 管理平台产品业务域
status: approved
owner: product/platform
last-reviewed: 2026-07-30
applies-to: Aurora 第一版管理平台 A1—D2、NAV-A、AUDIT-A 的稳定业务域与正式化边界
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../README.md
  - ../architecture/platform-frontend.md
  - ../architecture/platform-backend.md
  - ../security/account-deletion-and-data-lifecycle.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/specs/2026-07-29-aurora-topic-discussion-summary.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
supersedes: none
review-cycle: product-or-api-change
---

# Aurora 管理平台产品业务域

## 1. 权威边界

本文维护管理平台第一版的稳定业务域、对象归属和正式化入口。A1—D2 共 31 页的进入条件、页面结构、字段口径、权限、Query/Command 需求、全部页面状态、URL/分页/选择/返回、危险操作、一次性秘密、可访问性、排除项及 GAP-01—GAP-20，仍以[完整前端 UX/UI 设计](../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md)为详细权威来源。

本文不复制 31 页设计，也不把六专题总结提升为前端规格。出现语义差异时，按核心 PRD/长期规范 → accepted ADR → approved 完整专题设计 → approved 六专题总结的顺序处理。

## 2. 稳定业务域

| 业务域 | 页面 | 主对象与用户目标 | 正式关联 |
|---|---|---|---|
| 账号、认证与邀请 | A1—A5 | 注册/验证、登录、密码恢复、邀请接受、账号安全与注销 | A5 生命周期见[正式安全规则](../security/account-deletion-and-data-lifecycle.md) |
| 工作空间与组织治理 | B1—B8 | 可访问项目、项目创建、成员/邀请、时区、用量、私密令牌、安全审计、回收站 | 角色与组织不变量来自核心 PRD和完整 UX/UI |
| 项目接入与诊断 | C1、C2、C7 | 安装/初始化/测试事件、项目概览、接收与处理阶段诊断 | 依赖接入/处理公开状态契约，当前 `deferred` |
| 问题与事件分析 | C3、C4 | URL 权威查询、个人视图、问题聚合、代表样本、活动和处理 | 样本不等于完整事件历史 |
| 请求与性能 | C5、C6 | 规范化接口/页面列表与详情、服务端指标和可信度 | 公式、分母、水位和采样必须来自服务端契约 |
| 发布与 Source Map | C8、C9 | 发布/部署、严格 Source Map 文件上下文和处理状态 | 发布不是平台手工创建；对象上传不等于处理完成 |
| 告警 | C10—C12 | 规则定义、当前评估投影、触发实例、证据和轨迹 | 数据不足/暂停不等于恢复；实例快照与当前规则分离 |
| 项目访问、凭据与生命周期 | C13—C16 | 有效权限与来源、客户端密钥、设置/环境、归档/回收站 | 组织继承只读；私密令牌与客户端上报密钥分离 |
| 通知与平台资源策略 | D1、D2 | 账号通知时间流；平台默认、组织覆盖和项目上限策略 | D2 平台管理员身份/平台审计仍为真实阻塞 |

这九个领域是长期维护边界，不要求创建九个独立前端应用或服务，也不把每页拆成独立文档。

## 3. 共用交互与状态模型

`NAV-A` 和 `AUDIT-A` 对全部领域生效：

- 认证、账号、工作空间、组织、项目和平台作用域分离；切换作用域清理旧缓存、选择和危险确认；
- 当前筛选、搜索、排序和分页由 URL 表达；个人视图是显式快照，不自动覆盖；
- Query 与 Command 独立，写操作每次重新鉴权；`allowedActions` 只帮助展示，不授权写入；
- 页面按业务需要明确 `loading`、`empty`、`error`、`forbidden`、`processing`、`partial`、`stale`、`unavailable`、`conflict`、`propagating`、`archived`、`trash`、`deleting` 和 `deleted`；
- 服务端返回权威口径、时间、版本、水位、采样、降级、完整性和空值含义，前端不从有限样本推导总量或健康评分；
- 危险操作使用最新权威对象、明确身份复核和二次确认；秘密只在首次成功响应显示一次；
- 第一版必须满足键盘、焦点、缩放、屏幕阅读器和 WCAG 2.2 AA 目标，不用颜色作为唯一状态信号。

详细路由、逐页例外、字段及文案仍回读完整 UX/UI，不在本文平行维护。

## 4. 公开能力边界

页面中的 Query、Command、能力名和建议路径是需求标识，不是已经存在的机器 API。已批准的[总体 OpenAPI 与实现约束设计](../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)采用“统一公开契约、内部按领域模块化、生成单一 Platform OpenAPI”的方案 A，覆盖身份、权限、稳定错误、幂等、版本/冲突、Operation Result、部分/陈旧状态、安全目标和页面可达性。管理平台浏览器只能通过生成 Client 调用 `platform-api`，不直连数据库、Redis/BullMQ、处理存储或对象内部键。

31 个页面设计映射 36 个稳定 Route Target；差异来自 A1、C8、C11 的稳定子路由。B2 创建成功进入 C1；从 B1 选择已有 `active` 或可查看历史的 `archived` 项目进入 C2；回收站及删除态只从 B8 处理。每个正式 Route Target 都必须有真实 UI 入口和浏览器可达性验证，不能只靠手工输入 URL。

当前状态：总体契约与实现约束设计为 `approved`；机器 Platform OpenAPI、`platform-contract` 包、处理 Query/Command、数据模型和前端请求缓存实现仍为 `deferred`/absent；Session、前后端技术栈和数据基础设施仍受 `requires-accepted-adr` 约束；真实性能与浏览器证据为 `requires-benchmark`。

## 5. 第一版排除边界

不引入第三方登录、SSO、2FA、设备管理、Session Replay、完整行为分析、工单审批、即时通讯、外部通知/值班升级、收费、复杂责任小组、AI 根因分析、通用后台任务中心、跨页全量批处理或平台自助资源购买。新增产品能力必须先回到核心 PRD，不得由正式化或实现便利扩展。

## 6. 真实阻塞

- D2 平台管理员身份、授予/撤销和平台级审计缺少正式产品/安全规则；本轮标记 `deferred`，不展开新设计；
- 未验证账号的自动保留/清理未被 PRD 要求，第一版不提供 UI 或自动删除；若未来引入必须先补产品规则；
- 邮件供应商、期限和失败恢复属于 `implementation-detail` 与运营评审，不改变已批准页面流程；
- GAP-01—GAP-20 的机器公开契约仍不存在；已批准页面不得据此被描述为可调用或已实现。
