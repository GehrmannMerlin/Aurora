# apps/console（`@aurora/console`）

Aurora 管理平台前端 Vue 3 SPA 壳层（PLT-02），私有包，工作区层 `console`。本模块实现 36 个稳定 Route Target 的真实可达性：bootstrap → router → Session/Navigation Context → Aurora UI shell → 状态页。

## 层边界

- `console` 层只允许依赖 `contract` 与 `tooling` 层；依赖 `@aurora/platform-contract`（`contract` 层）是唯一业务契约依赖，禁止依赖 `data`/`service` 层内部包（含 `event-schema`、`ingestion-*`、`processing-store` 等），由 `pnpm check:boundaries`（workspace-policy）强制执行。
- 平台数据模型、`platform-api`/Worker、Query/Command 与权限仍未实现；本壳层只消费公开契约类型，不发明接口。
- 生产构建不含 MSW 与 `contract-testkit`（`main.ts` 的 `import.meta.env.MODE === 'test'` 死代码门禁 + `test:package` 构建产物门禁双层保证）。

## 架构

```
main.ts bootstrap
  ├─（仅 MODE === 'test'）import('./mocks/entry') → setupWorker(msw/browser)
  ├─ createApp(App) + app.config.errorHandler
  ├─ pinia（stores/session.ts Session Context、stores/navigation.ts Navigation Context）
  ├─ router（router/index.ts 36 个 RouteTarget、guards、focus）
  └─ mount('#app')
App.vue → components/shell/AppShell（TopBar + LayeredSidebar + ScopeSwitcher + ContentOutlet）
  └─ 状态页：RootView / WorkspaceHomeView / ForbiddenView / NotFoundView /
     UnavailableView / RouteErrorView / AuthUnavailableView
```

- `src/api/`：基于 `@aurora/platform-contract/client`（`buildRequest`/`parseResponse`/`PLATFORM_OPERATIONS`）的统一请求层，`platformRequest(operationId, input, { scope, signal })` 为当前唯一请求入口；错误经 `normalizeProblem` 归一为 `ApiError`。无已实现端点（Session/Query/Command 均未上线）。
- `src/contracts/`：RouteTarget 注册表、路由类型与侧栏条目（消费 platform-contract 的 `ROUTE_TARGET_IDS` 等契约常量）。
- `src/components/aurora/`：基础 UI（AppButton/AppLink/AppDrawer/AppPageHeader/AppStatusBadge）。
- `src/styles/`：设计令牌（`tokens.css`）与基础样式（`base.css`）。

## 命令

| 命令                                          | 作用                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @aurora/console build`         | 先构建 `@aurora/platform-contract`，再 `vite build` 产出生产 `dist/`（sourcemap false，无 MSW） |
| `pnpm --filter @aurora/console build:test`    | `vite build --mode test` 产出 `dist-test/`（启用 MSW，仅供浏览器测试）                          |
| `pnpm --filter @aurora/console typecheck`     | `vue-tsc --noEmit`                                                                              |
| `pnpm --filter @aurora/console test`          | vitest（jsdom），排除 `test/package-entry.test.ts`                                              |
| `pnpm --filter @aurora/console test:coverage` | vitest 覆盖率（阈值 branches 75 / functions 80 / lines 80 / statements 80），排除 `src/main.ts` |
| `pnpm --filter @aurora/console test:package`  | 构建产物结构门禁：先 `pnpm build`，再 `vitest run test/package-entry.test.ts`                   |
| `pnpm --filter @aurora/console test:browser`  | Playwright（Chromium）真实浏览器可达性 + axe 可访问性门禁                                       |

## 测试模式与生产构建隔离

- 单元/组件测试（`test/`）运行于 jsdom；`setupMockServer` 仅在 `import.meta.env.MODE === 'test'` 时经动态 `import('./mocks/entry')` 加载 MSW。`vite build --mode test` 构建 `dist-test/` 供 Playwright 使用。
- 生产 `vite build`（默认 mode）把 `MODE === 'test'` 折叠为常量假分支，rollup tree-shake 删除 `msw/browser` 与 `contract-testkit` 引用，不进入生产 bundle。
- `test:package` 是生产构建门禁：断言 `dist/index.html` 加载带 hash 的 `/assets/*-<hash>.js`、无 `.map` 源映射、且 `dist/assets/` 的 JS bundle 不含 `msw`/`contract-testkit`/`validSessionSamples`/`__mock/scope`，也不含 `Invalid PrimeUI License`/`p-license-host`/`license-manager`（PrimeUI 商业许可机制回归门禁，见下文）。
- `test-browser/license.spec.ts` 是真实浏览器许可回归门禁：对多个壳层路由断言 `#p-license-host`（PrimeUI 许可证横幅宿主元素）计数为 0，且控制台不出现 primeui/primevue license 警告。该缺陷类曾在公网 Preview 右下角出现 `Invalid PrimeUI License` 横幅。
- Vite 会把 `public/mockServiceWorker.js`（Task 5 MSW 初始化产物）原样复制进 `dist/`，它是自包含的惰性 worker 脚本，只含 MSW 脚手架、不含 MSW 库代码，且从不被应用 bundle 引用；因此 bundle 门禁只扫描 `dist/assets/` 下的 hashed chunk，不在 `dist/` 根上误报该 worker 文件。
- `test/package-entry.test.ts` 顶部声明 `// @vitest-environment node`：本文件只检查磁盘构建产物，node 环境保证 `import.meta.url` 是真实文件 URL（jsdom 环境会把它重写为 `http://localhost:3000`，使 `fileURLToPath` 抛错）。

## 依赖版本（Task 1 锁定）

| 依赖                        | 版本                                    |
| --------------------------- | --------------------------------------- |
| `vue`                       | 3.5.41                                  |
| `vue-router`                | 5.2.0                                   |
| `pinia`                     | 4.0.2                                   |
| `primevue`                  | 4.5.5（MIT 开源线，非商业 PrimeUI 5.x） |
| `zod`                       | 4.4.3                                   |
| `@aurora/platform-contract` | workspace:*（根 + `/client`）           |
| `msw`                       | 2.15.0（dev，仅测试模式）               |
| `vite`                      | 8.2.1（dev）                            |
| `vitest`                    | 4.1.10（dev）                           |
| `@vitejs/plugin-vue`        | 6.0.8（dev）                            |
| `vue-tsc`                   | 3.3.9（dev）                            |
| `typescript`                | 6.0.3（dev）                            |
| `jsdom`                     | 30.0.1（dev）                           |
| `@vue/test-utils`           | 2.4.11（dev）                           |
| `@testing-library/vue`      | 8.1.0（dev）                            |
| `@playwright/test`          | 1.62.1（dev）                           |
| `@axe-core/playwright`      | 4.12.1（dev）                           |
| `@vitest/coverage-v8`       | 4.1.10（dev）                           |

## 可访问性方向

- 目标 WCAG 2.2 AA；真实浏览器门禁（Playwright + `@axe-core/playwright`）在 `test-browser/axe.spec.ts` 校验无 axe 违规。
- 壳层提供键盘可达的基础（focus trap、焦点恢复、`AppLink` 语义、ARIA 标注）；窄屏抽屉与键盘导航基础见 Task 9 增量。

## 非职责

- 无 G10—G13 业务：本壳层不实现认证、组织/工作空间、项目、问题、指标、发布、告警、通知等任何领域页面（仅占位状态页），不消费未上线的 Session/Query/Command 端点。
- 无 ECharts/Storybook：不引入图表库与组件画册；图表依赖在更下游模块按需评估。
- 无暗色主题 / Web Font：视觉语言为浅色内容区 + 深石墨顶栏 + 纯色琥珀橙侧栏；字体走系统字体栈。
- 无 fake data：除 MSW 前端测试 handler 外，不内置虚构业务数据；状态页文案为纯静态壳层文案。

## 工程记录（Task 1—2 安装/验证时修正）

- `primevue` 固定为 MIT 开源的 **4.5.5**（`v4-stable`），不使用 PrimeVue 5.x：5.x 采用 PrimeUI 商业许可（`@primeui/license-manager`），在未配置许可证时会在页面右下角注入 `Invalid PrimeUI License` 横幅（公网 Preview 真实可见缺陷）。approved 技术栈（ADR-025）只需要开源 PrimeVue 组件能力，Aurora UI 包装层当前只使用 `primevue/drawer`（4.x 与 5.x 均支持 `visible`/`position`/`header` 及 `aria-label` attrs，API 兼容）。回归门禁见 `test:package` 与 `test-browser/license.spec.ts`。
- `vitest.config.ts` 增加 `plugins: [vue()]`：Vitest 优先使用 `vitest.config.ts`，不会继承 `vite.config.ts` 的插件，缺少 Vue 插件时 `.vue` SFC 无法解析。
- `vitest.config.ts` coverage 增加 `exclude: ['src/main.ts']`：Vitest 4 默认 `coverage.all=true`，未单测的应用入口 `src/main.ts` 会把行/语句覆盖率拉到 0% 导致阈值失败；与 `packages/platform-contract`/`event-schema` 排除入口 `index.ts` 的仓库先例一致。
- `apps/console/tsconfig.json` 增加 `skipLibCheck: true`：`@testing-library/vue@8.1.0` 发布类型里 `import { RemoveIndexSignature } from 'type-fest'` 为幽灵依赖，当前 type-fest 4.x/5.x 均已移除该导出；仓库 tsconfig 默认 `skipLibCheck:false` 会把它当错误。`skipLibCheck` 是 Vue 生态（create-vue）默认，仅对本应用生效，不削弱 SDK/后端类型检查。
- 根 `pnpm-workspace.yaml` `allowBuilds` 增加 `msw: true`：msw 2.15.0 带无害 postinstall（仅当包声明 `msw.workerDirectory` 时复制 worker 脚本），仓库 `strictDepBuilds:true` 需显式允许。
- 根 `eslint` 保持 `10.8.0`（计划拟升级 `10.8.1`，但该版本发布于 `minimumReleaseAge` 24 小时门槛内被仓库供应链策略拦截；`10.8.0` 为已成熟原 pin，不改动）。
- `src/vite-env.d.ts` 增加 `declare module '*.vue'`（`DefineComponent` 类型 shim）：eslint 的类型化规则（`no-unsafe-argument`）需要 `.vue` 导入有类型，而 vite/vue 均不内置 `*.vue` 声明；`vue-tsc` 原生理解 SFC 不受影响。
