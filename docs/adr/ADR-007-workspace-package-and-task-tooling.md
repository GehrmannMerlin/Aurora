---
title: ADR-007：采用 pnpm Workspace 与原生任务入口
status: accepted
implementation-status: implemented
owner: tooling
date: 2026-07-29
last-reviewed: 2026-07-29
applies-to: Aurora Monorepo 根工作区、包解析、锁文件和本地任务入口
related:
  - ../../AURORA_RULES.md
  - "../../Aurora 架构规范.md"
  - "../../Aurora 代码规范.md"
  - "../../Aurora 测试规范.md"
  - ../architecture/monorepo-and-build.md
  - ../architecture/system-overview.md
  - ../testing/test-strategy.md
  - ADR-001-use-monorepo.md
  - ADR-006-one-way-dependencies.md
supersedes: none
superseded-by: none
---

# ADR-007：采用 pnpm Workspace 与原生任务入口

## 元数据

- 状态：accepted
- 日期：2026-07-29
- Owner：tooling
- 适用范围：根 Workspace、包管理器、锁文件、版本固定、全量/过滤任务与本地质量入口
- 关联技术方案：[Monorepo 与基础工程工具](../architecture/monorepo-and-build.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none
- 实施状态：not-started
- 评审状态：非作者及所需领域评审已通过

## 背景

ADR-001 选择统一 Monorepo，ADR-006 要求依赖边界可自动检查。仓库当前只有文档，没有 Workspace、包清单、锁文件或可执行质量命令。第一个实施模块需要一套可重复安装、能解析本地包并提供稳定命令入口的最小工程基础，但零代码阶段没有证据支持提前引入任务图、远程缓存或发布编排。

## 决策驱动因素

- 安装必须由提交的锁文件和精确包管理器版本复现；
- 本地包必须显式声明并优先解析 Workspace 内版本；
- 根命令需要支持全量运行和按包过滤；
- 同一质量命令应可被开发者和未来 CI 调用；
- 第一版应避免在没有构建耗时证据时引入任务编排器或远程缓存；
- 版本发布、制品、CI 工作流和云基础设施属于其他模块。

## 候选方案

### 方案 A：pnpm Workspace＋原生 package scripts

使用 pnpm 管理 Workspace、单一锁文件和过滤执行；根 `package.json` 以原生 scripts 聚合质量命令。首期不引入 Turborepo、Nx 或远程缓存。

优点：

- `workspace:` 协议可阻止本地依赖意外解析到注册表版本；
- 单一锁文件和精确 `packageManager` 可提供可重复安装；
- `pnpm --filter` 已满足首批包级任务选择；
- 工具层最薄，迁移和回滚成本低；
- 不预设尚无证据的任务图和缓存平台。

缺点：

- 跨包任务顺序主要依赖 scripts 与过滤规则；
- 不提供受影响任务计算和远程缓存；
- 包数量增长后根脚本可能需要迁移到任务编排器。

### 方案 B：pnpm Workspace＋Turborepo

使用 pnpm 管理依赖，同时由 Turborepo 建模任务图、增量执行和缓存。

优点：

- 任务依赖和并行关系显式；
- 内置本地缓存与受影响执行能力；
- 包数量增长后更容易控制反馈时间。

缺点：

- 零代码阶段增加配置、缓存正确性和升级面；
- 尚无构建耗时证明其收益；
- 后续若任务模型不适配仍需迁移。

### 方案 C：npm Workspaces＋原生 scripts

使用 Node 附带的 npm 管理 Workspace 和锁文件，以 npm scripts 聚合任务。

优点：

- 无需额外包管理器；
- 团队认知成本低；
- 对最小仓库足够直接。

缺点：

- 缺少 `workspace:` 的强制本地解析语义；
- Workspace 过滤与依赖隔离能力弱于 pnpm；
- 与已批准前端/后端 TypeScript 多包方向相比，长期边界约束更依赖额外脚本。

## 最终决策

决定选择方案 A：pnpm Workspace＋原生 package scripts，首期不引入任务编排器或远程缓存。

本 ADR 只选择 Workspace、包管理器和任务入口策略。Node 与 pnpm 的精确补丁版本、TypeScript/Lint/测试工具版本和命令参数由[Monorepo 与基础工程工具](../architecture/monorepo-and-build.md)维护；版本发布、Changesets、制品、GitHub Actions 工作流和远程缓存不在本 ADR 范围。

## 结果与影响

### 正面影响

- 首个工程增量保持私有、轻量且可回滚；
- 本地包依赖可以通过 `workspace:` 显式约束；
- 根任务与包级任务具有统一调用入口；
- 未来 CI 可直接复用非交互质量命令；
- 若真实基准触发，仍可独立引入任务编排器。

### 负面影响与长期代价

- 原生 scripts 不提供完整任务图和跨机缓存；
- 根任务约定需要文档与测试保持一致；
- pnpm 大版本升级需要兼容和锁文件评审；
- 后续迁移任务编排器时需要调整根命令内部实现，但应保持命令契约稳定。

## 安全、隐私与兼容影响

- 锁文件必须提交并使用冻结安装，降低未审查依赖漂移；
- `packageManager` 固定精确 pnpm 版本，Node 使用受支持 LTS 线；
- 本 ADR 不改变任何采集、身份、隐私或数据生命周期规则；
- 外部依赖升级仍需安全、许可和供应链检查，当前没有扫描结果；
- Windows、Linux 和 macOS 的开发/CI 命令必须避免依赖单一 Shell 私有语法。

## 实施约束

- 根包必须 `private: true`，首模块不得发布任何制品；
- 必须提交唯一 `pnpm-lock.yaml`，自动化安装使用 `--frozen-lockfile`；
- Workspace 本地依赖必须使用 `workspace:` 协议；
- 第一版根任务只聚合明确的包级 scripts，不在根脚本中复制业务实现；
- 本地与未来 CI 复用同一非交互 `check:ci` 入口；
- 首模块不得创建空 `apps/*`、`packages/*`、`examples/*` 或虚假业务 README；
- 首期不启用远程缓存，也不创建 GitHub Actions、发布或云配置；
- 依赖边界检查必须可以独立失败，并由测试夹具证明允许/禁止示例；
- 精确版本升级只能由显式变更完成，并同步锁文件、正式规格和验证结果。
- 依赖安装脚本默认禁止；确需执行的包必须在 `allowBuilds` 中经审查显式批准，不得启用全局放行。

## 迁移方案

先建立私有根包、`pnpm-workspace.yaml`、精确包管理器固定和锁文件，再提供最小本地质量命令与依赖边界检查。后续真实模块出现时逐个加入 Workspace，并使用 `workspace:` 声明本地依赖。版本发布、CI 工作流和任务编排器只能在各自门禁满足后另行引入。

## 回滚方案

在业务包和公开制品出现前，可删除 Workspace 配置与内部工具并恢复文档状态，不影响业务数据。若已有 Workspace 包，改用 npm 或引入任务编排器必须通过新 ADR 或替代记录，先保证锁文件可重建、根命令契约不变并验证所有包，再切换工具；不得同时更换包管理器和发布策略。

## 验证方式

- 精确版本环境下两次冻结安装得到同一锁文件且第二次无漂移；
- 未声明、本地非 `workspace:`、循环和私有路径依赖夹具被拒绝；
- 根全量命令和 `pnpm --filter` 包级命令返回一致退出语义；
- Windows 与 Linux 执行相同项目命令，无 Shell 专属脚本；
- 无业务包时检查正常通过，新增真实包后无需修改根命令名称；
- 仓库中不存在 Turborepo、Nx、远程缓存、发布或 CI 工作流配置。

上述均是实施验证要求，不是当前已有结果。

## 重新评估条件

- 真实包数量和任务依赖使原生 scripts 无法可靠表达执行顺序；
- 版本化基准证明重复构建或 CI 时间超过届时批准的反馈预算；
- 多团队并行开发需要受影响任务计算或共享缓存；
- pnpm 的支持、安全或迁移成本不再可接受；
- 多语言模块成为主要工作负载；
- 需要发布第一个公共包或部署制品。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-07-29：提案建立

- 状态为 `proposed / not-started`；当前没有 Workspace、包清单、锁文件、工程命令、CI 或测试结果；
- 提案只解除首个私有 Monorepo 根工作区与最小本地工具的长期选择，不决定版本发布、业务模块、公共协议、SDK、服务端、前端、CI/IaC 或云资源；
- 推荐方案采用最小可回滚默认值；任务编排器和远程缓存保持 `deferred / requires-benchmark`；
- 进入 `accepted` 前需要独立非作者以及 architecture、tooling、quality 和模块消费方视角评审。

### 2026-07-29：接受决策

- 决策状态更新为 `accepted`，实施状态保持 `not-started`；前置 ADR-001 与 ADR-006 已于同批次接受；
- 独立非作者评审由隔离审查上下文 `adr_001_003_review` 完成，覆盖 architecture、tooling、quality 和未来模块消费方视角；
- 评审确认 pnpm 原生 scripts、pnpm＋Turborepo、npm Workspaces 三项候选真实；零代码阶段没有任务图或缓存收益证据，方案 A 符合 YAGNI 与最小可回滚原则；
- 版本兼容核验确认 Node 24、pnpm 11、TypeScript 6.0、ESLint 10、typescript-eslint 8.65、Vitest 4.1 及相关工具约束互相兼容；正式规格随后按供应链保守原则把 pnpm 精确默认固定为已越过等待窗口的 `11.17.0`，不采用 2026-07-29 当日发布的 `11.18.0`；
- 当前没有 Workspace、包清单、锁文件、命令、CI、Issue、实现 PR 或测试结果，本次接受不得解释为工具已安装或模块已实施。

### 2026-07-29：首模块实施证据

- 实施状态更新为 `implemented`；冻结安装、全部测试、Lint、类型检查、边界检查、构建、格式化和文档检查均已通过；
- 实施 Commit：none（未提交）
- 验证命令与结果：
  - `pnpm install --frozen-lockfile`: 通过（锁文件 SHA256 不变：aed909b5d4138af350c3ee1a6c01987525ec087ce9856016ae83c8e9e70f2a27）
  - `pnpm format:check`: 通过（exit 0）
  - `pnpm lint`: 通过（exit 0）
  - `pnpm typecheck`: 通过（exit 0）
  - `pnpm test`: 通过（exit 0，10 个测试）
  - `pnpm check:boundaries`: 通过（exit 0，真实仓库无违规）
  - `pnpm build`: 通过（exit 0，仅产出 `tooling/workspace-policy/dist/`）
  - `pnpm check:ci`: 通过（exit 0）
  - `git diff --check`: 通过（exit 0）
- 证据路径：`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tooling/workspace-policy/`（src/、test/、dist/）
- Issue/PR：none
- CI 证据：无 GitHub Actions 工作流；`check:ci` 仅为本地非交互入口
- 精确版本：Node.js v24.18.0、pnpm 11.17.0、TypeScript 6.0.3、ESLint 10.8.0、Vitest 4.1.10
- 范围验证：`apps/`、`packages/`、`examples/`、`.github/` 均不存在；无 Turborepo/Nx/远程缓存/Changesets/CI 配置
- 性能结果：不存在
