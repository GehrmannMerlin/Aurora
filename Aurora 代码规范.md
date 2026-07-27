# 3. 代码规范

> 规则类别：`CODE`  
> 适用范围：Aurora SDK、服务端、管理平台、公共协议包及工程工具  
> 状态：已批准  
> 目标：保证代码类型安全、职责清晰、容易维护，并确保 Aurora SDK 不影响接入方业务页面

## 3.1 基本原则

Aurora 代码必须遵守以下原则：

- 默认使用严格 TypeScript；
- 文件、类型和变量采用统一命名；
- 函数和模块保持单一职责；
- 外部输入必须先校验，再进入业务逻辑；
- 错误必须被正确处理，不得静默吞掉；
- SDK 内部错误不得影响宿主页面；
- 公共 API 必须最小、明确且稳定；
- 插件必须通过公开接口与 Core 通信；
- 禁止绕过统一事件、脱敏、采样和上报流程；
- 不为追求抽象而提前设计复杂的通用层。

## 3.2 CODE-001：TypeScript 严格模式

Aurora 全项目必须开启 TypeScript `strict` 模式。

必须遵守：

- 禁止无说明地使用 `any`；
- 外部输入和不可信数据必须先定义为 `unknown`；
- 公共函数必须声明明确的参数和返回类型；
- 公共 API、SDK 配置和事件模型不得使用宽泛对象类型；
- SDK 上报数据和接口输入必须经过运行时校验；
- 可选值必须显式处理；
- 联合类型必须完整处理所有分支。

限制使用：

- 非空断言 `!`；
- 双重类型断言；
- 宽泛的 `as`；
- `Record<string, any>`；
- `Function`、`Object` 等缺少约束的类型。

禁止直接使用：

    // @ts-ignore

确需抑制预期类型错误时，使用：

    // 说明为什么该错误是预期行为
    // @ts-expect-error

类型断言不能代替数据校验。

错误示例：

    const event = input as ErrorEvent

正确做法：

    const result = ErrorEventSchema.safeParse(input)

    if (!result.success) {
      return
    }

    const event = result.data

## 3.3 CODE-002：命名规范

### 文件命名

- 普通 TypeScript 文件：`kebab-case.ts`
- React 组件：`PascalCase.tsx`
- Vue 组件：`PascalCase.vue`
- 测试文件：源码名称加 `.test` 或 `.spec`
- 类型声明文件：根据职责使用 `kebab-case.ts`
- 包名：小写 `kebab-case`

示例：

    error-plugin.ts
    event-buffer.ts
    ErrorDetailPanel.tsx
    ErrorDetailPanel.test.tsx

### 代码命名

- 类型、接口、类、枚举和组件：`PascalCase`
- 函数、变量和对象属性：`camelCase`
- 真正的全局不可变常量：`UPPER_SNAKE_CASE`
- 布尔变量：使用 `is`、`has`、`can`、`should` 等前缀
- 内部处理函数：使用 `handle` 前缀
- 对外回调属性：使用 `on` 前缀

示例：

    const isInitialized = true
    const hasPendingEvents = false

    function handleGlobalError(): void {}

    interface ErrorPluginOptions {}

    const DEFAULT_SAMPLE_RATE = 1

### 命名要求

名称必须表达业务含义。

禁止使用：

    data
    temp
    item
    value
    obj
    test1
    handleData
    doSomething

确实属于局部且含义明确的短变量除外。

禁止建立大型杂物目录：

    utils/
    helpers/
    common/
    misc/

通用代码必须有明确职责和归属。

## 3.4 CODE-003：复杂度与职责

一个函数只完成一个明确任务，一个文件只承担一个主要职责。

以下数值作为代码评审的预警线，而不是机械限制：

- 函数超过约 50 行；
- 文件超过约 300 行；
- 参数超过 4 个；
- 条件或循环嵌套超过 3 层；
- 一个函数同时负责采集、转换、脱敏、缓存和上报；
- 一个模块同时包含多个不相关业务职责。

出现上述情况时，必须检查是否需要拆分。

参数较多时优先使用参数对象：

    interface CreateErrorEventInput {
      error: unknown
      context: EventContext
      timestamp: number
      source: ErrorSource
    }

    function createErrorEvent(input: CreateErrorEventInput): ErrorEvent {}

复杂分支优先使用提前返回：

    function processEvent(event: unknown): AuroraEvent | null {
      if (!isSdkEnabled()) {
        return null
      }

      const parsedEvent = parseEvent(event)

      if (!parsedEvent) {
        return null
      }

      return sanitizeEvent(parsedEvent)
    }

禁止为了满足行数要求，将代码拆成大量没有业务语义的小函数。

## 3.5 CODE-004：错误与日志

### SDK 错误处理

SDK 必须以“不影响宿主页面”为最高原则。

必须保证：

- SDK 内部异常不会冒泡到宿主应用；
- 单个插件异常不会阻断其他插件；
- 监听器回调必须有错误隔离；
- 上报失败进入统一重试或丢弃策略；
- SDK 自身错误通过内部诊断模块记录；
- SDK 停止后能够释放监听器、定时器和代理。

SDK 禁止直接向宿主页面抛出内部异常。

    try {
      plugin.capture()
    } catch (error: unknown) {
      diagnostics.record({
        source: plugin.name,
        error: normalizeInternalError(error),
      })
    }

### 服务端错误处理

服务端必须：

- 使用明确的业务错误或错误码；
- 通过统一异常处理中间件处理未知异常；
- 为请求和事件记录追踪标识；
- 对外返回稳定的错误结构；
- 在内部日志中保留必要诊断信息。

禁止：

- 捕获异常后不记录、不处理；
- 将完整异常堆栈返回给客户端；
- 暴露数据库结构、文件路径和内部服务信息。

### 管理平台错误处理

管理平台必须：

- 通过统一请求层转换接口错误；
- 使用页面或组件错误边界隔离渲染异常；
- 对可恢复错误提供清晰提示；
- 对无权限、无数据、请求失败分别处理；
- 避免每个组件自行定义不同的错误格式。

### 日志级别

统一使用：

- `debug`：开发调试信息；
- `info`：关键正常流程；
- `warn`：可恢复异常和降级；
- `error`：需要调查的失败。

日志禁止包含：

- 密码；
- Token；
- Cookie；
- Authorization；
- 完整请求体或响应体；
- 未脱敏的用户输入；
- 其他敏感个人数据。

SDK 生产环境默认不得输出大量控制台日志。

## 3.6 CODE-005：公共 API

Aurora 公共 API 必须遵循“最小化并保持稳定”的原则。

只有接入方真正需要使用的内容才能从包入口导出。

公共 API 必须明确：

- 参数类型；
- 返回类型；
- 默认值；
- 是否允许重复调用；
- 错误行为；
- 生命周期；
- 异步行为；
- 兼容性承诺。

示例：

    export interface AuroraOptions {
      endpoint: string
      projectId: string
      sampleRate?: number
    }

    export interface AuroraClient {
      captureException(error: unknown): void
      setUser(user: AuroraUser | null): void
      flush(): Promise<void>
      destroy(): void
    }

禁止公开：

- Core 内部状态；
- 可变的内部集合；
- 私有队列；
- 内部实现类；
- 仅为测试创建的接口；
- 未准备好长期维护的实验能力。

公共 API 兼容规则：

- 新增可选配置通常属于兼容变更；
- 删除或重命名 API 属于不兼容变更；
- 修改参数含义属于不兼容变更；
- 修改返回值结构属于不兼容变更；
- 将可选字段改为必填字段属于不兼容变更；
- 改变默认行为可能属于不兼容变更。

不兼容变更必须：

- 创建 ADR；
- 提供迁移方案；
- 通过主版本发布。

废弃 API 必须先标记：

    /**
     * @deprecated 请改用 captureException。
     */

废弃说明必须指出替代 API 和迁移方式。

## 3.7 CODE-006：Aurora SDK 编码禁区

Aurora SDK 运行在接入方业务页面中，因此必须遵守比普通前端应用更严格的限制。

### 禁止破坏宿主环境

禁止：

- 覆盖已有的 `window.onerror`；
- 覆盖已有的 `window.onunhandledrejection`；
- 修改宿主页面全局变量；
- 修改原生对象原型；
- 永久替换 `fetch`、`XMLHttpRequest` 或 `history`；
- 重复初始化时重复安装监听器；
- SDK 销毁后仍保留监听器、定时器或代理。

事件监听优先使用：

    window.addEventListener('error', handleError)

对原生 API 的代理必须：

- 保存原始实现；
- 防止重复代理；
- 保持原方法调用语义；
- 支持完整恢复；
- 处理代理自身异常。

### 禁止阻塞主线程

禁止在同步采集路径中：

- 深度遍历完整 DOM；
- 序列化完整 `window` 或全局状态；
- 执行 Source Map 解析；
- 进行大规模数据聚合；
- 执行无上限的对象递归；
- 使用高频且无法停止的定时器；
- 处理无限长度的堆栈、数组或字符串。

所有采集数据必须设置数量、长度和深度限制。

耗时任务应延迟、分片或交由服务端处理。

### 禁止不受控采集

默认禁止采集：

- 密码输入；
- Token；
- Cookie；
- Authorization；
- 完整表单内容；
- 完整请求体和响应体；
- 完整 DOM；
- 未经配置允许的用户输入；
- 无法确认用途的数据字段。

所有事件必须经过统一的：

    标准化
    → 字段限制
    → 脱敏
    → 过滤
    → 采样
    → 缓存
    → 上报

插件不得绕过该流程直接发送数据。

### 禁止不稳定运行

禁止：

- SDK 内部错误向宿主页面抛出；
- 一个插件失败导致整个 SDK 停止；
- 上报无限重试；
- 上报请求被请求插件再次采集；
- 重复初始化产生重复事件；
- 页面卸载时执行长时间异步任务；
- 未设置上限地缓存事件；
- 网络异常时无限增长内存队列。

上报请求必须带有内部标记，以避免递归监控。

队列、重试次数、退避时间和单批事件数量必须存在上限。

### 禁止绕过架构边界

禁止：

- 插件访问 Core 私有状态；
- 插件直接实现独立上报通道；
- 插件之间直接依赖内部实现；
- 跨包引用其他包的 `src` 或 `internal`；
- 绕过 `event-schema` 手工拼接事件；
- 使用魔法字符串表示事件类型；
- 通过全局单例阻止多个 Aurora 实例隔离运行。

事件类型必须来源于公共协议：

    import { EventType } from '@aurora/event-schema'

## 3.8 代码注释

注释应当解释“为什么”，而不是重复“代码做了什么”。

适合添加注释的情况：

- 浏览器兼容性处理；
- 性能取舍；
- 安全或隐私限制；
- 协议兼容逻辑；
- 暂时保留的历史行为；
- 不明显的算法或边界条件；
- 使用 `@ts-expect-error` 的原因。

不推荐：

    // 将 isReady 设置为 true
    isReady = true

推荐：

    // 接入方可能在多个入口重复初始化，必须先标记状态以避免重复注册监听器。
    isInitialized = true

临时方案必须同时说明：

- 为什么存在；
- 在什么条件下可以删除；
- 对应清理任务。

## 3.9 代码评审检查表

提交 Aurora 代码评审前必须确认：

    - [ ] TypeScript 严格检查通过
    - [ ] 未使用无说明的 any
    - [ ] 外部输入已经过运行时校验
    - [ ] 文件和代码命名符合规范
    - [ ] 函数和文件职责清晰
    - [ ] 没有明显过深嵌套
    - [ ] 错误未被静默吞掉
    - [ ] 日志不包含敏感数据
    - [ ] 公共 API 未意外扩大
    - [ ] 未跨包访问私有文件
    - [ ] SDK 异常不会影响宿主页面
    - [ ] SDK 不会重复注册或递归采集
    - [ ] 采集数据存在长度和数量限制
    - [ ] 插件未绕过统一事件管道
    - [ ] 资源可以在 destroy 时释放

## 3.10 初始代码规则

### CODE-001 v1：严格 TypeScript

Aurora 全项目必须开启严格 TypeScript，并限制 `any`、类型断言和错误抑制指令。

### CODE-002 v1：统一命名

文件、组件、类型、变量和插件包必须按照职责采用统一命名方式。

### CODE-003 v1：单一职责

函数、文件和模块必须保持单一职责，行数和嵌套数作为复杂度预警指标。

### CODE-004 v1：分层错误处理

SDK、服务端和管理平台必须根据各自运行环境采用统一且安全的错误处理方式。

### CODE-005 v1：稳定公共 API

Aurora 公共 API 必须保持最小化、类型明确，并遵守兼容性和废弃流程。

### CODE-006 v1：SDK 编码禁区

SDK 禁止破坏宿主环境、阻塞主线程、不受控采集数据、无限重试或绕过统一事件处理流程。
