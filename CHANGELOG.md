<!--
title: Aurora 更新日志
status: approved
owner: release
last-reviewed: 2026-08-15
applies-to: Aurora 用户可感知功能、行为、Bug 与安全修复
related: README.md, docs/releases/release-migration-and-rollback.md
supersedes: none
-->

# Changelog

本文件记录 Aurora 用户可感知的功能、行为变化、Bug 修复与安全修复。开发中的变化先写入 `Unreleased`；创建正式版本标签时，再移动到 `## [x.y.z] - YYYY-MM-DD`。

## [Unreleased]

### Added

- 推出 `Calm Observability` 管理控制台，以“状态 → 证据 → 行动”组织监控、调查与治理工作区。
- 增加阿里云 DirectMail 邮箱验证投递，以及登录 Session 下的历史未验证账号重发能力。
- 完成 TypeScript SDK 的错误、请求与 Web 性能采集、可靠发送链及 Vue/React 框架适配。
- 提供 Issue、Source Map、请求与性能查询、告警、站内通知、组织/项目治理和资源策略能力。

### Changed

- Aurora v1 使用 provider-neutral 单主机 Docker Compose 部署，不绑定特定云厂商 API。
- 控制台认证与首次使用流程统一到新的双层导航和上下文界面。

### Fixed

- 修复部署后首次引导状态丢失的问题。
- 修复邮箱重发冷却时间和滚动额度状态未被正确保持的问题。
- 修复平台运行时依赖、数据库 Migration 兼容与部署回滚安全问题。

### Security

- 邮箱验证链接保持最新链接唯一有效，重发采用 60 秒冷却和滚动 24 小时最多 5 次限制。
- 验证意图令牌不进入请求日志，邮件 Outbox 失败状态和终态数据保持脱敏。
- 默认隐私边界继续禁止采集请求/响应正文、凭据、表单内容、完整 DOM、完整 IP 与设备指纹。
