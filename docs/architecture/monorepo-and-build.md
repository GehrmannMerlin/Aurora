---
title: Aurora Monorepo 与基础工程工具
status: approved
owner: architecture/tooling
last-reviewed: 2026-07-29
applies-to: Aurora 私有根 Workspace、工程命令、依赖边界检查与首个规划模块
related:
  - ../../README.md
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - ../README.md
  - system-overview.md
  - formalization-readiness.md
  - ../testing/test-strategy.md
  - ../adr/ADR-001-use-monorepo.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-007-workspace-package-and-task-tooling.md
supersedes: none
review-cycle: toolchain-major-or-module-boundary-change
---

# Aurora Monorepo 与基础工程工具

## 1. 定位与状态

本文冻结首个可独立规划模块的职责、工具默认值、命令契约和验收边界。ADR-001、ADR-006 和 ADR-007 已完成接受评审，本文作为该模块的 approved 规划规格；批准只表示规划输入充分，不表示 Workspace、命令、代码或测试已经存在。

## 2. 模块职责与明确排除

首模块负责：

- 建立私有根 Workspace、精确 Node/pnpm 版本入口和唯一锁文件；
- 提供跨平台的根质量命令与全量/过滤执行方式；
- 建立内部 Workspace policy 工具，检查包清单、公开边界、未声明依赖、循环依赖和私有深导入；
- 通过临时测试夹具验证允许与禁止场景，不创建虚假业务包；
- 为未来 CI 提供同一非交互命令入口，但不创建 CI 工作流。

明确排除：`event-schema`、SDK Core/Browser/插件、Vue/React、接入/处理/平台代码、OpenAPI、Schema、数据模型、数据库、发布/Changesets、GitHub Actions、远程缓存、制品、容器、IaC、AWS 和部署。首模块不创建空 `apps/*`、`packages/*` 或 `examples/*`。

## 3. Consumes 与 Produces

### 3.1 Consumes

- accepted [ADR-001](../adr/ADR-001-use-monorepo.md)：单一 Monorepo；
- accepted [ADR-006](../adr/ADR-006-one-way-dependencies.md)：单向依赖和自动约束原则；
- accepted [ADR-007](../adr/ADR-007-workspace-package-and-task-tooling.md)：pnpm Workspace 与原生任务入口；
- [架构规范](<../../Aurora 架构规范.md>)、[代码规范](<../../Aurora 代码规范.md>)和[测试规范](<../../Aurora 测试规范.md>)的边界、严格 TypeScript、TDD 和质量门禁。

### 3.2 Produces

- 私有根 Workspace 和可重复冻结安装；
- 稳定的项目命令接口：`format:check`、`lint`、`typecheck`、`test`、`check:boundaries`、`build`、`check`、`check:ci`；
- `tooling/workspace-policy` 内部工具的公开函数与 CLI；
- 未来真实模块可消费的包清单规则和边界失败语义；
- 本地验证记录。它不产生业务制品或发布版本。

## 4. 初始目录与文件边界

实施只允许创建根配置、`tooling/workspace-policy/` 真实内部工具及其 README/测试。`apps/*`、`packages/*` 和 `examples/*` 仅作为 `pnpm-workspace.yaml` 的未来匹配范围；没有真实模块时目录本身不得创建。

根目录六份长期规范保持原路径，是业务目录规则的明确例外。正式设计继续进入 `docs/`；工具代码不得成为 PRD、协议或业务规则的第二来源。

## 5. 工具和版本默认值

以下是 2026-07-29 的初始精确默认值，属于可审查的实施参数，不是性能证据：

| 工具                  | 精确版本/范围                           | 选择依据                                                                           |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Node.js               | `24.18.0`，`engines.node >=24.18.0 <25` | 当前 LTS；不使用 Current/EOL 线                                                    |
| pnpm                  | `11.17.0`，由 `packageManager` 精确固定 | Node 24 受支持；避开 2026-07-29 当日发布的 11.18.0；Workspace 与 `workspace:` 语义 |
| TypeScript            | `6.0.3`                                 | 严格 TypeScript；与所选 ESLint TypeScript 集成兼容                                 |
| ESLint / `@eslint/js` | `10.8.0` / `10.0.1`                     | 扁平配置与非交互 Lint                                                              |
| `typescript-eslint`   | `8.65.0`                                | 支持 ESLint 10 与 TypeScript `<6.1.0`                                              |
| Vitest                | `4.1.10`                                | 测试 Workspace policy 的 TypeScript API/CLI                                        |
| Prettier              | `3.9.6`                                 | 只负责格式检查，不承担语义 Lint                                                    |
| `tsx`                 | `4.23.1`                                | 执行 TypeScript policy CLI，不引入构建期运行时框架                                 |
| `@types/node`         | `24.13.3`                               | 与 Node 24 LTS 对齐                                                                |

升级任一精确版本必须显式修改根清单与锁文件并重新运行全部门禁。Node/pnpm 大版本、包管理器或任务策略变化需要 ADR 复查；其他补丁/小版本为 `implementation-detail`。本地已安装的旧版本不构成降级依据。

## 6. Workspace 和包清单契约

- 根 `package.json` 必须 `private: true`，精确声明 `packageManager: pnpm@11.17.0` 和 Node engine；
- 根 `.node-version` 必须精确写入 `24.18.0`，`pnpm-workspace.yaml` 同时声明 `nodeVersion: 24.18.0` 和 `engineStrict: true`；
- 唯一 `pnpm-lock.yaml` 必须提交；自动化入口使用 `pnpm install --frozen-lockfile`；
- Workspace 匹配 `apps/*`、`packages/*`、`examples/*`、`tooling/*`，不存在的匹配目录不创建；
- 所有 Workspace 包必须使用 `@aurora/<kebab-case-name>`，并显式声明 `private`、`type`、`exports`、`files`、`engines`、包级 scripts 和 `aurora.layer`；
- 首模块唯一真实 Workspace 包是私有 `@aurora/workspace-policy`，层级为 `tooling`；
- 本地依赖必须使用 `workspace:*`；禁止未声明依赖；
- 跨包只能通过 `exports`，禁止包含 `/src/`、`/internal/` 或未导出子路径；
- 包图不得成环。领域层级方向继续以 accepted ADR-002/003/005/006 为准，在对应真实模块加入时扩展可执行矩阵；首模块不虚构业务层包。截至 2026-07-30，可执行层级矩阵已扩展至 `sdk-browser`：`sdk-browser` 只允许依赖 `sdk-core` 与 `protocol`；Core 不允许反向依赖 Browser。Browser 真实浏览器门禁：`pnpm --filter @aurora/browser test:browser`，本地只运行 Chromium。
- `strictDepBuilds` 保持 `true`，首模块的 `allowBuilds` 只允许 `esbuild: true`；新增安装脚本执行权限必须逐包审查并显式变更，禁止 `dangerouslyAllowAllBuilds`。

## 7. 稳定命令契约

所有命令必须非交互、跨平台，并以退出码 `0` 表示通过、非 `0` 表示失败：

| 命令                    | 职责                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | 检查本模块新增/受管的工程源、JSON、YAML、根 README 和 Monorepo 规格，不写文件；不机械重排六份 append-only 长期规范或既有设计历史 |
| `pnpm lint`             | 对实际工程源文件运行 ESLint                                                                                                      |
| `pnpm typecheck`        | 对实际 TypeScript 工具运行严格类型检查，不产出文件                                                                               |
| `pnpm test`             | 运行 Workspace policy 单元与 CLI 集成测试                                                                                        |
| `pnpm check:boundaries` | 对真实 Workspace 执行包清单、依赖图和私有路径检查                                                                                |
| `pnpm build`            | 构建真实内部工具；无业务包时不得伪造业务制品                                                                                     |
| `pnpm check`            | 依次执行格式、Lint、类型、测试、边界和构建门禁                                                                                   |
| `pnpm check:ci`         | 复用 `check` 的非交互语义，供未来 CI 调用；本模块不创建工作流                                                                    |

包级执行使用 `pnpm --filter <package-name> <script>`。根命令名称是首模块输出接口；后续引入任务编排器时可以改变内部调用，但不得无迁移说明地改变名称和退出语义。

## 8. Workspace policy 接口

内部工具必须提供：

```ts
export type WorkspaceViolationCode =
  | 'invalid-package-name'
  | 'missing-package-field'
  | 'non-workspace-local-dependency'
  | 'undeclared-dependency'
  | 'dependency-cycle'
  | 'private-path-import';

export interface WorkspaceViolation {
  readonly code: WorkspaceViolationCode;
  readonly packageName: string;
  readonly file?: string;
  readonly dependency?: string;
  readonly message: string;
}

export interface WorkspaceCheckResult {
  readonly ok: boolean;
  readonly violations: readonly WorkspaceViolation[];
}

export function checkWorkspace(rootDir: string): Promise<WorkspaceCheckResult>;
export function formatViolations(result: WorkspaceCheckResult): string;
```

CLI 接收且只接收 `--root <path>`；通过时不输出普通成功噪声并返回 `0`，存在策略违规时向 stderr 输出按 `packageName/code/file` 稳定排序的诊断并返回 `1`，参数或读取失败返回 `2`。诊断不得包含环境秘密。

## 9. 测试与验收

- 单元测试使用临时目录建立最小包夹具，覆盖合法空 Workspace、合法内部工具包、字段缺失、名称错误、非 `workspace:` 本地依赖、未声明导入、循环和私有路径；夹具不得作为真实业务模块提交；
- CLI 集成测试覆盖退出码 `0/1/2`、stderr 稳定排序和 Windows 路径规范化；
- `tsc --noEmit` 必须在严格模式通过，禁止 `any`、忽略错误和不受控类型断言；
- `pnpm check:ci` 必须在干净冻结安装后通过；结果只能在实施时记录，不得预写；
- 重复运行 `pnpm install --frozen-lockfile` 不得修改锁文件；
- 反向/循环/私有/未声明依赖负例必须证明检查失败；
- 不创建 GitHub Actions、业务包、公共 exports、发布制品或缓存服务。

## 10. 迁移、回滚和重新评估

当前无工程代码，迁移从根 Workspace 和内部 policy 工具开始。后续每个真实模块在自己的计划中加入包清单、README、公开入口和测试；首模块不代建下游。

在首个业务包出现前，可删除本模块新增配置和内部工具恢复文档仓库。业务包出现后更换包管理器必须先生成可复现的新锁文件、保持根命令契约、验证全部包并通过替代 ADR；不得用删除锁文件或跳过边界检查降级。

出现以下任一条件时复查：原生 scripts 无法可靠表达真实任务依赖；版本化基准证明反馈时间超出批准预算；需要受影响任务计算或远程缓存；pnpm/Node 支持或安全状态变化；多语言成为主要工作负载；准备发布首个公共包或部署制品。

## 11. 批准记录

### 2026-07-29：规格批准

- 状态更新为 `approved`，Owner 保持 architecture/tooling；
- 前置 ADR-001、ADR-006 与 ADR-007 均已完成独立非作者和所需领域评审并成为 `accepted / not-started`；
- 隔离审查上下文 `adr_001_003_review` 复核了模块范围、三项工具候选、精确版本兼容、命令边界、YAGNI、迁移、回滚和重新评估条件，未发现内容阻断；
- 首模块仅获准进入规划：不创建业务包、CI 工作流、发布链、远程缓存、机器契约或云资源；
- 当前没有 Workspace、工程文件、依赖安装、锁文件、命令执行或测试结果，实施证据必须由计划执行阶段产生。

### 2026-07-29：首模块实施证据

实施日期：2026-07-29。实施 Commit：none（未提交）。

- Node.js：v24.18.0
- pnpm：11.17.0
- TypeScript：6.0.3
- 锁文件 SHA256：aed909b5d4138af350c3ee1a6c01987525ec087ce9856016ae83c8e9e70f2a27

命令验证结果（均在干净冻结安装后执行）：

| 命令                             | 退出码 | 结果                                    |
| -------------------------------- | ------ | --------------------------------------- |
| `pnpm install --frozen-lockfile` | 0      | 锁文件不变                              |
| `pnpm format:check`              | 0      | 通过                                    |
| `pnpm lint`                      | 0      | 通过                                    |
| `pnpm typecheck`                 | 0      | 通过                                    |
| `pnpm test`                      | 0      | 10 个测试全部通过                       |
| `pnpm check:boundaries`          | 0      | 真实仓库无违规                          |
| `pnpm build`                     | 0      | 仅产出 `tooling/workspace-policy/dist/` |
| `pnpm check:ci`                  | 0      | 全部门禁通过                            |
| `git diff --check`               | 0      | 通过                                    |

范围验证：

- `apps/`、`packages/`、`examples/`、`.github/` 均不存在
- 无 Turborepo、Nx、Changesets、远程缓存或 CI 工作流配置
- `pnpm-workspace.yaml` 不含 `dangerouslyAllowAllBuilds`
- 仅 `@aurora/workspace-policy` 一个真实内部包存在

未创建：业务包、机器契约、CI 工作流、发布配置、远程缓存、容器、IaC 或云资源。
