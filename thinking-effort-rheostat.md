# 思考强度滑块（Thinking Effort Rheostat）· DSH 设计方案

> 目标读者：DSH 插件作者 / 本仓库后续实现者
> 状态：设计定稿草案（v1），全部"现状"结论均来自 `cordis_inspect_*` 只读探针的**活体运行时**读取，非猜测。

---

## 0. 一句话结论

DSH 的 `llm` 层**已经**有 `reasoningEffort` 这个一等公民：模型会自己申报档位表，会话级选择可以持久化、可以中途切换、并且写进会话日志。
真正缺的是一个**好用的、好看的、能随模型能力自动降级**的控件 —— 也就是你要的那个滑块。

所以这个功能不是"造管道"，而是"造表盘"。工作量集中在 UI / 交互 / 动效，风险集中在客户端能不能拿到读写通道（见 §10）。

---

## 1. 现状分析（已核实）
### 1.1 下游管道：全通

| 层 | 事实 | 来源 |
|---|---|---|
| 请求参数 | `GenerateOptions.reasoningEffort?: ReasoningEffortId`，`LlmCallConfig` 同名字段 | `llm` 服务契约 |
| 能力申报 | `llm.resolveModelInfo(provider, model)` → `reasoning?: { efforts: LlmReasoningEffortInfo[]; defaultEffort? }`，`LlmReasoningEffortInfo = { id, name, description? }` | 同上 |
| 校验策略 | `resolveCallConfig`：**"Unsupported explicit efforts reject before provider I/O; no clamping or aliasing is performed."** → 不支持就报错，不会悄悄帮你降档 | 同上 |
| 目录 | `session.modelCatalog()` → `ModelCatalog { default, routableProviders, groups[{ id, name, models[{ id, name, description?, reasoning?: { efforts: [{id,name,description?}], defaultEffort? } }] }], failures }` | `sessionController` 的 `@Remote('modelCatalog')` |
| 选择写入 | `session.selectModel({ sessionId, provider, model, reasoningEffort? })` → `{ selected }`，语义是"**先显式 resume 该会话**，装一个 Session-local 选择，同时后台保存默认值" | `@Remote('selectModel')` |
| 全局默认 | `agentDefaultModel.currentSelection()` / `saveSelection(next)`，返回值是"**detached provider, model, and optional reasoning selection**" | `agentDefaultModel` 服务 |
| 可追溯 | 每次请求头落盘：`'request/header' { header: EpochHeader{ config: LlmCallConfig, adapterDefaults? }, reason: 'initial'\|'resume'\|'change'\|'series', startsSeries? }` | `SessionEventMap` |

**这条链的含义**：档位数量、档位名字、每档的说明文案，**全部由模型适配器申报**，UI 不允许自己编。滑块上的刻度点数 = `reasoning.efforts.length`，档位名 = `effort.name`，档位解释 = `effort.description`。适配器说几档就是几档 —— 这是设计的硬约束，也是它自动兼容新模型的原因。

### 1.2 已有 UI：一个模型菜单，没有独立表盘

活体槽位树显示：

- `conversation.input.model`（**single / shadows-shipped-ui**）已被占用（注册者 `mf`）—— 这是自带的模型选择器，我不应该去抢。
- `conversation.input.left`（**list / replaceRisk: none / 当前 0 个占用者**）—— "Compact controls at the left of the composer tool row"。
- `conversation.input.overlay`（**list / 可叠加**，现有 `slash-menu`、`command-popup`、`feedback-dialog`）—— "Floating entries rendered inside the resident composer card"。
- 相关客户端包 `@deepseek-ai/dsh-client-ui-model-selection`、`dsh-client-ui-conversation`、`dsh-client-ui-settings-general`、`dsh-client-ui-settings-models` 都在配置树里。

槽位注册者能拿到一组标准 props：`useConversation`、`useChat`、`useInput`、`inputActions`、`useSession`、`sessionId`、`useProjection`、`useTrajectory`、`useSessionStatus`、`useResource`…（Inspect 只给到这里，具体形状是 §10 的待核实项）

**结论**：`conversation.input.left` + `conversation.input.overlay` 是一对**天生为这个功能准备的**空座位 —— 一个放工具行控件，一个放浮层卡片。

### 1.3 主题令牌：只有 14 个，且必须双套

`--dsw-alias-bg-base` / `-bg-layer-1` / `-bg-layer-2` / `-bg-overlay` / `-border-l1` / `-border-l2` / `-brand-primary` / `-label-primary` / `-label-secondary` / `-state-error-primary` / `-state-idle-primary` / `-state-success-primary` / `-state-warn-primary` / `--dsw-specific-sidebar-fill`。

全部 `requiresLightAndDark: true`。→ 方块阵列与散点的颜色必须**从 `--dsw-alias-brand-primary` 派生**（`color-mix`），不能写死一个蓝；否则切主题就废了。

---

## 2. 缺口（要补的就是这些）

1. 没有一个"一眼看到当前思考强度"的常驻指示。
2. 调档要进模型菜单（或者根本没有入口）。
3. 档位的**语义**（每档意味着什么、贵在哪）没有解释入口。
4. 最高档没有任何"我很猛"的仪式感。

---

## 3. 目标 / 非目标

**目标**
- G1：常驻可见当前档位，一次点击/拖拽即可改档，不打断打字。
- G2：档位完全由 `modelCatalog` 驱动，永不硬编码；模型不支持时优雅降级。
- G3：视觉语言来自 DSH 令牌，明暗双主题都成立，动效克制但最高档有"记忆点"。
- G4：键盘/读屏可用，`prefers-reduced-motion` 下依然好看。

**非目标**
- 不替换自带模型选择器（`shadows-shipped-ui`，抢它等于跟官方 UI 打架）。
- 不发明档位、不做 clamping（下游明确拒绝"悄悄降档"，我们也不能假装成功）。
- 不做"思考预算 = 具体 token 数"的伪精确滑动（那是另一套 API：`thinking.budget_tokens` 那类；DSH 这里是**离散档位**）。

---

## 4. 交互设计

### 4.1 入口：工具行里的两个独立控件（模型 / 思考强度分开放）

```
┌──────────────────────────────────────────────────────────────┐
│  [◆ 模型 ▾]   [◍ High]                    ...      [发送 ↑]  │   ← conversation.input.left
└──────────────────────────────────────────────────────────────┘
        └── 8px 间距，两个各自独立的控件 ──┘
```

- **不合并**：模型选择与思考强度是两个控件、两个菜单，只保持 8px 间距对齐。模型按钮维持中性色；Effort 按钮在**非默认档**时着色（品牌色文字 + 13% 品牌底）。
- **一切皆为圆角方形**：28px 高、圆角 8px，**无边框**、无胶囊、无全圆（与自带模型选择器同一套语言）。
- **自动检测**（硬要求）：Effort 按钮的存亡完全由所选模型决定——
  `model.reasoning.efforts.length >= 2` 才渲染；`=== 1` 或缺失 → 控件以 200ms 收起动画消失（`width:0` + 淡出，不留空位跳动）。
  判定源是 `session.modelCatalog()` 每模型自报的 `reasoning.efforts`，**不是**任何写死的模型名单。
- 三态：`待机`（默认档，弱化）/ `已上调`（非默认档，品牌色）/ `运行中`（流式思考时图标呼吸，可选接线）。

### 4.2 浮层：卡片长什么样（严格对齐参考实现）

```
┌─────────────────────────────┐
│ Effort  Ultracode        (?)│   ← 13px；档位名非默认档时用品牌色
│                             │
│ Faster              Smarter │   ← 11.5px/500
│ ┌─────────────────────────┐ │
│ │ ▪ ▪ ▪ ▪ ▪ ▪      ▣▪▪▪▪▪ │ │   ← 左：6 个档位刻度（圆角方块）
│ │  ▫▪▫▪▪▫▪▪▫▪▪▪▫▪▪▪▪▪▪▪▪▪ │ │   ← 最高档：5 排方块阵列 + 随机散点
│ └─────────────────────────┘ │   ← ▣ = 滑块（圆角方形 26×22 r7）
└─────────────────────────────┘
```

- **卡片极简**：只有 `Effort + 档位名 + (?)`、`Faster/Smarter`、轨道三段。**没有**档位说明文字、没有用量、没有"设为默认"——与参考实现一致（宽 272px，padding 13px）。
- 头部：`Effort` 次级色 + 档位名 13px/600；非默认档用品牌色，默认档用主文本色。
- 轴标签 `Faster` / `Smarter`：**唯一**的方向引导，必须留（11.5px/500，句首大写，不是全大写）。
- 轨道：30px 高、圆角 9px；左端 6 个**圆角方块**刻度对应 6 档；滑块可拖、轨道可点、键盘可调。
- `(?)` tooltip 一句话说清"档位表由模型自报、越高越慢越准"。
- 位置：`conversation.input.overlay`，浮在 composer 卡内、工具行上方；背景 `--dsw-alias-bg-overlay`，边框 `--dsw-alias-border-l1`，圆角 12px，阴影走 overlay 语义。
- 模型菜单是**另一个**独立浮层（246px），条目 32px 高、圆角 7px，右侧带能力徽章：`6 档` / `单档` / `不支持`（虚线边）。

### 4.3 拖拽手感（"不僵硬"的关键）

- **拖动时连续跟随指针**（不做逐档硬吸附），档位名实时按最近档更新；
- **松手才吸附**：移除 `is-drag` 的同一帧里把 `--p` 改到吸附档，过渡重新生效 → 滑块**自己滑进档位**，而不是"啪"地跳过去。这一段是手感的灵魂。
- `--p`（注册过的 `<number>` 自定义属性）由 `.rail` 上一条 `transition: --p .36s cubic-bezier(.32,.72,0,1)` 驱动，进度条宽度、刻度、滑块位移**同源同曲线**，所以整体像一块东西在动。
- 拖拽中 `.is-drag{transition:none}` 保证跟手无延迟。
- 指针按下滑块 `scale(1.04)`（0.12s），松开回落。
- 提交用 200ms debounce。
- 失败（`llm` 拒绝不支持档位）→ 回滚到已提交档 + 滑块 0.32s 抖动（**不要静默**，下游语义明确是 reject 而非 clamp）。
- 卡片打开/关闭：`translateY(5px) scale(.98)` → 原位，0.26s `cubic-bezier(.32,.72,0,1)`；`transform-origin` 对齐触发按钮。

### 4.4 键盘与无障碍

| 键 | 行为 |
|---|---|
| `Tab` | 工具行控件 → 浮层内拇指进入焦点环 |
| `← / →` | 降/升一档，立即提交 |
| `Home / End` | 最低 / 最高档 |
| `Enter / Space` | 打开/关闭浮层 |
| `Esc` | 关浮层并把焦点还给工具行控件 |

拇指：`role="slider"`、`aria-valuemin=1`、`aria-valuemax=N`、`aria-valuenow`、`aria-valuetext="High，第 4 档，共 6 档"`；刻度是纯装饰（`aria-hidden`，不进 tab 序列）。

### 4.5 状态矩阵

| 状态 | Effort 控件 | 档位名 | 备注 |
|---|---|---|---|
| 模型无 `reasoning` | **自动收起** | — | 检测源：`efforts.length === 0` |
| 模型仅 1 档 | **自动收起** | — | 检测源：`efforts.length === 1`（文案区别于"不支持"）|
| 任意非最高档（含默认档） | 中性色，永不改色 | **原色** | 默认档与其它档**视觉一致** |
| 最高档 | 中性色，永不改色 | **品牌色** | 唯一一处颜色变化；配合方块阵列 |
| 正在流式思考 | 可选加图标呼吸 | — | 可选接线 `reasoning-delta` |
| 会话运行中 | 允许改档 | — | 因为 `selectModel` 会 resume，改档成本低 |
| 提交中 / 失败 | — | — | 失败：滑块抖动回滚 + 可见说明 |

> **颜色语义的硬规则（v3 之前做错了）**：
> ① 档位名的颜色**只**表示"是不是最高档"，与"是不是默认档"无关。v3 曾经把"非默认档"染成品牌色 → 用户看到 Medium 是白的、High 是紫的，会误以为紫色有特殊含义。**默认档不该有任何视觉特权**。
> ② **控件外部永不变色**：工具行那颗 Effort chip 在拖动、改档、最高档时都保持中性色，只有 hover / 展开才出现 `bg-layer-2` 底片。外面安静，状态由 chip 上的档位名本身传达。

### 4.6 降级阶梯（必须实现，否则一换模型就崩）

1. `reasoning.efforts.length ≥ 2` → 完整滑块。
2. `length === 1` → 收起控件，检测行说明"仅 1 档，无可调"。
3. 无 `reasoning` 字段 → 收起控件，检测行说明"未申报思考档位"。
4. `modelCatalog` 未就绪 / 会话未绑定 → 不渲染控件（**不要**渲染骨架占位，否则工具栏会跳动；就绪后再以 200ms 淡入）。
5. `modelCatalog.failures` 里有该 provider → 工具行控件挂 `--dsw-alias-state-warn-primary` 小方块 + tooltip 错误摘要。

---

## 5. 视觉设计

### 5.1 令牌映射（明暗双套，不新增调色板）

| 部件 | 令牌 |
|---|---|
| 控件底 / 轨道槽 | `--dsw-alias-bg-layer-2`（hover → `bg-layer-3`）；轨道加 `inset 0 1px 2px` 内阴影做凹槽 |
| 控件边框 | `--dsw-alias-border-l1`（hover → `border-l2`）|
| 未激活刻度 | `color-mix(in oklab, var(--dsw-alias-label-secondary) 42%, transparent)` |
| 已激活刻度 / 方块阵列 | `--dsw-alias-brand-primary`；**亮色下阵列另用更深的 `--dot`**（见 §5.1.1-6） |
| 档位名 | **普通档 = `--dsw-alias-label-primary`（原色）；只有最高档 = 品牌色** |
| 滑块 | 暗色：`#f5f7fa` 中性白；亮色：`#ffffff` + 1px 深色描边（否则在浅轨道上不可见）|
| 轴标签 FASTER/SMARTER | `--dsw-alias-label-secondary` |
| 错误 | `--dsw-alias-state-error-primary` |

**品牌色基准 = DeepSeek 官方 logo 蓝 `#5686fe`**，按主题各取一档：

| 主题 | 值 | 理由 |
|---|---|---|
| 暗色 | `#5686fe` | 官方原色；在 `#131519` 上对比约 **6.2:1**，够亮、够正 |
| 亮色 | `#3b6ef6` | 官方原色在白底上只有约 **3.3:1**，13px 半粗字偏弱；加深同一色相到约 **4.4:1** |

> 注意：这里**不是**在 DSH 里硬编码这两个值。真实实现应使用 `--dsw-alias-brand-primary` 令牌（由主题提供），上面两个值只是"主题该把 brand 令牌设成什么"的建议值。

### 5.1.1 亮色主题的六个坑（"很丑"的逐条修复）

1. **紫灰底**：原来 `--brand:#5b47e0` 是偏紫的靛蓝，和 DeepSeek 的蓝完全不搭，整页透着紫雾。→ 换成 `#3b6ef6`。
2. **页面底色发灰**：纯灰白 `#f5f6f8` 显脏、和白卡片拉不开层次。→ 改成极浅竖向渐变 `#fdfeff → #f7f9fd → #eef2f9`（上近白、下微冷），卡片自然浮起。
3. **近透明轨道**：原来 `background: rgba(14,16,22,.045)` 在浅底上几乎看不见。→ 改成实色 `#eaeef6` + 内阴影。
4. **白滑块消失在浅轨道上**：原来只靠一层浅影。→ 补 1px `rgba(15,23,42,.12)` 描边 + 三层阴影。
5. **文字对比不足**：次级文字原来 `#8e97a8`（3.4:1）。→ `--fg-2:#525b6b`、`--fg-3:#79828f`。
6. **方块阵列糊在浅蓝进度层上**（最刺眼的一条）：同样的 `color-mix` 透明度叠在**浅色**轨道上比叠在近黑轨道上"实"得多，于是浅蓝进度层 + 淡蓝散点 = 一团发闷的蓝雾。三处一起改：
   - 进度层整体压淡（亮色 11%→30% 改为 **7%→16%**）；最高档再乘 `opacity:.28` —— 阵列自己是主角，底下不需要一整条蓝。
   - 阵列方块换用更深的专用令牌 `--dot:#2b52c4`（比 `--brand` 深一档），浅底上才有"实心小方块"的硬度。
   - 包络尾巴抬高（34% 处 `.62→.74`、58% 处 `.3→.46`、80% 处 `.1→.26`），闪烁下限 `.3→.42`（`twkL` 专用关键帧）—— 否则左侧方块会溶进进度层里变成糊。

### 5.2 精确规格（一律圆角方形，无胶囊）

| 元素 | 值 |
|---|---|
| 工具行控件 | 28px 高，圆角 **8px**，padding 0 9px，字号 12.5px/500，**无边框**（与 DSH 自带模型选择器同一套：hover 才有 `bg-layer-2`） |
| 控件间距 | 2px（模型与 Effort 各自独立、天然分列，不合并、不贴边） |
| 浮层（卡片） | 宽 **272px**，圆角 12px，padding 13px（极简：三段内容） |
| 浮层（模型菜单） | 宽 246px，圆角 12px，条目 32px 高、圆角 7px |
| 轨道 | 30px 高，圆角 **9px**，内嵌进度层 inset 4px、圆角 6px |
| 刻度 | **4 × 4px 圆角方块**（r 1.2），N 档等距铺在 `[13px, W-13px]` 上（锚点在格心，故 `translate` 里补 `-50%`） |
| 方块阵列 | **3 × 3px 圆角方块**（r 1），间距 2px，**5 排**，列数按宽度实算；亮色用 `--dot` 深一档 |
| 进度层 | 仅"染一点色"：暗色 `brand 9%→26%`；亮色 `brand 7%→16%`，且**最高档时 `opacity:.28`** 让位给方块阵列 |
| 滑块 | **26 × 22px 圆角方形**（r 7）——不是圆，也不是胶囊；暗色用中性白 `#f5f7fa`，亮色用 `#fff` + 1px 描边。定位用 `left:0` + `translateX(calc(var(--p) * var(--travel)))`，使 p=0 时其中心恰在 13px 与首刻度同心 |
| 滑块投影 | 接触影 `0 1px 2px rgba(0,0,0,.32)` + 1px 描边 + 顶部内高光 `inset 0 1px 0 rgba(255,255,255,.72)` |
| 最高档滑块 | 品牌色描边 + `0 0 14px 1px` 品牌辉光 |
| 位移 | 进度宽/刻度/滑块共用 `--p ∈ [0,1]`；`--travel` 由 JS 实测（`rail.clientWidth - 26`）；过渡 `--p .36s cubic-bezier(.32,.72,0,1)`；拖拽中 `transition:none` |
| 阴影 | `0 1px 1px rgba(0,0,0,.4), 0 10px 28px -6px rgba(0,0,0,.65)` |
| 字体细节 | 数字 `font-variant-numeric: tabular-nums`；轴标签句首大写（`Faster`/`Smarter`），非全大写 |

### 5.3 最高档"方块阵列"（核心炫技点）

> **v1/v2 的错误在此更正**：v1 用 `radial-gradient` 铺散点 → 无序噪点；v2 用"扫光带自右向左滑过" → 机械、僵硬，像进度条动画。正确做法是**整齐的方块阵列 + 随机散点闪烁**：秩序来自静态几何，灵动来自随机闪烁。

只在 `selected === efforts[last]` 时挂 `.is-max`。**四层**：

1. **方块阵列本体**（`display:grid`，`grid-auto-flow` 由显式 `grid-template-columns/rows` 决定）：格子固定 **3 × 3px、间距 2px、5 排**，列数由 JS 按轨道实测宽度算出（`cols = floor((inner + gap) / (cell + gap))`），所以**每一格都是正方形、行列严格对齐**。约 47 列 × 5 排。用固定种子的 PRNG 生成，重绘图案不乱跳。
2. **亮度包络**（有秩序）：**不用逐格 inline opacity**，而是给容器一条 `mask-image: linear-gradient(to left, #000 0%, #000 12%, rgba(0,0,0,.62) 34%, .3 58%, .1 80%, transparent)`。→ 右端满亮、向左渐隐。**一次 mask 搞定，GPU 友好，主题/宽度变化都不用重算**。
3. **随机散点闪烁**（无序中又有顺序）：约 **22%** 的格子随机带上 `.sk`，各自内联 `--d`（2.6–5.2s）与 `--dl`（-0…-5s，负值让它们一开始就错开），跑同一个 `@keyframes twk`（一个周期里闪 4 次、含 0.28 的呼吸底）。因为**容器的 mask 依然乘在上层**，左边的散点自然微弱、右边的明亮 —— 于是"随机"被"有序的包络"约束住了。
4. **入场**（取代 v2 那套僵硬扫光）：容器 `clip-path: inset(0 0 0 100%) → inset(0 0 0 0)`，**`1.25s cubic-bezier(.4,0,.2,1)`** —— 自右向左缓缓铺开，起点慢、收尾稳（v3 的 `.62s cubic-bezier(.22,1,.36,1)` 起手太快，像被"弹"出来）。同时刻度 `opacity:0` 让位（0.3s 交叉淡出）。退出反向收回。

预算：稳态 = **约 50 个只动 opacity 的小格子动画**（比 v2 的逐格 `transform` 更轻），无 canvas、无 JS 逐帧、无 layout 抖动。

### 5.4 动效礼让与本地化

- `@media (prefers-reduced-motion: reduce)`：关掉散点闪烁，**保留阵列几何 + 亮度包络**（静态的方块阵列本身就是"满档"的表达，不靠动画也成立）。
- 额外设置项 `motion: full|reduced`（低配机器 / 个人口味），与系统偏好取交集。
- 文案走 `locale` 服务注册命名空间字典（`zh-CN` / `en`）：`Effort`、`Faster`、`Smarter`、tooltip 正文。
- 档位名 `effort.name` 是**提供方给的**，不强制翻译；对已知 id（`minimal|low|medium|high|xhigh|max`）提供一张可选映射表，未知 id 原样显示。

---

## 6. 接线与数据流

### 6.1 座位分配

| 座位 | 内容 | 依据 |
|---|---|---|
| `conversation.input.left` | Effort 控件（32px 圆角方形）| list / 空 / `replaceRisk: none` |
| `conversation.input.overlay` | 浮层卡片（392px）+ 模型菜单（288px）| list / 可叠加 / 在 composer 卡内浮起 |
| `settings.general.item` | "思考强度"偏好行 | 单行偏好（跟 Language / Appearance / Composer Enter 同级）|
| `settings.section`（可选）| 进阶页：每 provider 默认档、动效开关、降级策略 | 想放更多才需要 |

### 6.2 数据流

```
session.modelCatalog() ──► per-model reasoning.efforts ──► 渲染 N 个刻度
        (只读, 可缓存)
             ▲                                            │
             │ 当前值: 会话 request/header 的 config.reasoningEffort
             │        (客户端侧: useConversation / useSession 提供的选择快照)
             │                                            ▼
             └──────── 用户拖拽 ◄──────── 实时吸附 / 键盘 / 点刻度
                              │ 200ms debounce
                              ▼
        session.selectModel({ sessionId, provider, model, reasoningEffort })
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
             Session-local 生效     后台保存默认值
                    │
                    ▼
        'request/header' reason:'change' 落盘 → 会话可追溯
```

### 6.3 代码骨架（客户端半边，DSH 不给 JSX，用 `React.createElement`）

```js
const h = React.createElement

function EffortPill({ sessionId, catalog, selection, onOpen }) {
  const efforts = catalog?.reasoning?.efforts ?? []
  if (efforts.length < 2) return null                 // §4.6 降级
  const idx = indexOfEffort(efforts, selection.reasoningEffort, catalog.reasoning.defaultEffort)
  const effort = efforts[idx]
  const isMax = idx === efforts.length - 1
  return h('button', {
    className: 'dsh-effort-pill' + (isMax ? ' is-max' : ''),
    'aria-haspopup': 'dialog',
    'aria-expanded': String(open),
    onClick: onOpen,
  }, h('span', { className: 'dsh-effort-pill__icon', 'aria-hidden': 'true' }),
     h('span', { className: 'dsh-effort-pill__label' }, effort.name))
}

function Rheostat({ efforts, value, onCommit }) {
  // 轨道: pointerdown 定位 → pointermove 吸附 → pointerup 提交
  // 键盘: ArrowLeft/Right, Home/End
  // role="slider" 在拇指上
}
```

样式用 `styles.insert(css)` 注入，随插件卸载清理；主题变量全部走 `var(--dsw-alias-*)`。

---

## 6.5 已实施（v2，2026-10）

插件已按官方 `cordis-plugin-development` skill 的 bundle 形态落地并安装到 `desktop` profile。

### 目录

| 文件 | 作用 |
|---|---|
| `bundle/package.json` | `dsh.bundle.patch` + `dsh.client{platform:'web', inject:[ui-conversation]}`；`exports` 含 `./client`（**正是客户端条目 id 的来源**） |
| `bundle/cordis.patch.yml` | `- insert: [{ id: thinking-effort, name: '@local/dsh-thinking-effort-rheostat' }]`（v3.9 起用全名） |
| `bundle/index.js` | host 半边：注册一条 `POST /thinking-effort/levels` 路由，经 `configEditor` 申报/撤销档位 |
| `bundle/config-declare.js` | host 行半边的**纯函数**：定位 `providers[route].models[id]`、判定档位来源、算出"该写什么"，不碰 Cordis 与 Node API |
| `bundle/client.js` | 浏览器半边：`window.__ModuleLoader__.load({id, factory})`，手写，**无需构建** |
| `tools/smoke.js` | 无头渲染测试（迷你 React 运行时，状态跨重绘保留，**副作用真跑**），**70 项断言** |
| `tools/smoke-declare.mjs` | host 侧配置手术的单元测试 + **跨文件不变量**（预览档位 vs 申报档位、路由路径、错误码词典），**49 项断言** |
| `tools/audit-css.js` | 样式静态审计：变量必须被定义、被读取、且**明暗两套对称**；**禁止任何有彩色字面量**；**所有 `--dsw-*` 必须是本 build 真实定义的令牌** |
| `tools/contrast.js` | **对比度门禁**：用主题解析出的真实色值，断言 6 组配对在明暗两套下都过下限 |
| `tools/theme-blocks.js` | 定位某个令牌**由哪个选择器、在哪套主题里**定义（把"别名→静态"的归属钉死） |
| `tools/theme-values.js` | 令牌解析与对比度的探索版（被 theme-blocks + contrast 取代，保留作参考） |
| `tools/asar.js` / `peek.js` | 从 `app.asar` 读取官方源码与 CSS 的取证工具（`peek.js` 支持按行段或正则取片段，不再依赖 PowerShell 重定向） |

六条门禁：

```
node --check bundle/client.js
node tools/audit-css.js
node tools/contrast.js
node tools/smoke.js
node tools/smoke-declare.mjs
node --input-type=module -e "import('./bundle/index.js')"   # host 半边能被 import
```

安装结果：`{"application":"applied","warnings":[]}`；条目落在 `conversation.input.right`、`active: true`（HMR 已自动回收旧的左槽位注册，左槽 `occupants` 为空）。

### 对比度：为什么面板换了令牌（有数字）

用 `tools/theme-blocks.js` 把"令牌 → 选择器 → 真实色值"钉死后，实测：

| 配对 | 目标 | 亮色 | 暗色 |
|---|---|---|---|
| 轨道 vs 面板 | ≥1.45 | **1.62:1** | **2.01:1** |
| 未激活刻度 vs 轨道 | ≥1.75 | **3.14:1** | **3.21:1** |
| 激活刻度 vs 轨道 | ≥2.00 | **2.61:1** | **3.35:1** |
| 滑块 vs 轨道 | ≥3.00 | **11.63:1** | **7.47:1** |
| 次要文字 vs 面板 | ≥3.00 | **5.80:1** | **10.42:1** |
| 强调色（档位名/方块） vs 面板 | ≥3.00 | **4.23:1** | **6.75:1** |

关键发现：**暗色下 `--dsw-alias-bg-overlay`（文档说它是"浮层与弹窗背景"）解析成 `#61666b` 这个中灰**，强调蓝 `#7aaaff` 压在上面只有 **2.49:1**——13px 文字根本不够。换成 `--dsw-alias-bg-layer-1`（"抬升表面"）后暗色是 `#232324`，同一个蓝变成 **6.75:1**，亮色则是干净的白卡。这条取舍连数字一起记在 `contrast.js` 的末尾，将来想改回去得先跟这个数较劲。

其余取色原则：**面板以上的一切都用 `label-primary` 的百分比混合**（它是"当前主题最高对比的墨色"，暗=白、亮=近黑），所以**一条配方在两套主题下都成立**，不再需要任何主题分支。

### 与 v1 的关键差异

| 项 | v1 | v2 |
|---|---|---|
| 槽位 | `conversation.input.left`（左侧那组） | **`conversation.input.right`** → 紧贴自带模型选择器左边（`standardControls` 的 gap 是 12px） |
| 结构 | **两个槽位条目**（chip 在左、panel 在 overlay），靠模块级 Map 同步开合 | **单一条目单组件**：chip + panel 同一棵树，开合是本地 state |
| 面板定位 | `position:absolute` 挂在 overlay 锚点 | **`position:fixed`**，由 trigger 的 `getBoundingClientRect()` 定位，并跟随 `resize`/`scroll` 重算 |
| 未申报档位 | 直接**隐藏控件**（用户什么都看不到） | 回落显示 4 档（v2）→ v3 改为 **3 档预览 + 一键申报** |
| 未选中态 | 假装停在最低档 | 显示"模型默认"，**不假装用户选了某一档** |
| 几何 | 手写、偏小、圆角不一致 | **逐值移植原型**：thumb 26×22 r7、rail 30px r9、panel 272px、刻度 4px、阵列 3px×5 排、padding 13px、axis 11.5px |
| 暗色检测 | 猜的（`body[data-ds-dark-theme]`） | **完全不检测**：11 个颜色全部来自主题令牌，明暗自跟随 |
| 品牌色 | `--dsw-alias-brand-primary`（其实是单色黑白） | `--dsw-alias-state-business-primary`（亮 `#4176e6` / 暗 `#7aaaff`） |
| 面板底 | `--dsw-alias-bg-overlay` | **`--dsw-alias-bg-layer-1`**（暗色 `#232324` 而非中灰 `#61666b`，强调色对比 2.49:1 → 6.75:1） |
| 轨道 | `--dsw-alias-interactive-bg-hover`（≈1.1:1，看不见） | `color-mix(label-primary 22%, transparent)`（亮 1.62:1 / 暗 2.01:1） |
| 刻度 | `label-tertiary` @42%（糊） | `label-primary` @50%，激活为强调色 |
| 次要文字 | `label-tertiary` | `label-secondary` |
| 滑块色 | 亮色写死 `#fff` | `--dsw-alias-label-primary`（暗=白 / 亮=近黑，两套都是最高对比） |
| 页脚留白 | 恒定 2 行（说明与提示共用） | **只有"逐档说明"才留 2 行**（它会随滑块变长），提示/错误是定长单行 |
| 选项释放 | 等 store 追上才释放乐观位置（store 不更新就**永久卡住**） | 提交回执即释放，store 的 `current` 随后接管 |

### "强制申报"的确切依据（v3 更正）

v2 的说法是"回落到通用档位，提交时由宿主校验，拒绝就回滚"。**读完 `dsh-llm` 的校验点后这条被推翻**：那个回落档位永远不可能被接受，因为它连校验都过不去。

pi-ai 适配器（`@deepseek-ai/dsh-llm-pi-ai`）确实会省略 `reasoning`：

```js
function getSupportedThinkingLevels(model) {
  if (!model.reasoning) return ["off"];      // 未申报 ⇒ 只报 off
  ...
}
function reasoningInfo(model, defaultLevel) {
  if (!model.reasoning) return {};           // 未申报 ⇒ 整个 reasoning 字段都省略
  ...
}
```

而 `dsh-llm` 对"省略"的解读是**拒绝一切显式档位**，且在**发出请求之前**：

```js
// dsh-llm/lib/index.js  resolveCallWithInfo()
if (reasoning === void 0) {
  if (requested !== void 0) throw new LlmError(
    `provider "..." model "..." does not support reasoning effort "..."`,
    "UNSUPPORTED_REASONING_EFFORT");
}
```

`session/selectModel`（host）正是走这条路径：

```js
await this.ctx.llm.resolveCallConfig({ provider, model, ...reasoningEffort });
// → 抛错 → RemoteError("session/model-unavailable") → 客户端 store.error
```

**所以客户端无论如何都提交不了未申报的档位**，这不是本插件能绕过的：`directory.select` 没有旁路，也没有"仅本会话"的未校验写入口。

**唯一被支持的"强制上报"就是把档位申报进 profile**——这正是 pi-ai 自己文档里 `reasoningEfforts` 字段的用途：

> `reasoningEfforts` 声明模型可选择的 thinking 等级：每个键都是选择器提供的等级，其值是分派时在协议中发送的拼写。

申报后 `resolveModelReasoning` 会返回 `{ reasoning: true, thinkingLevelMap }`，于是：

1. 宿主**原生**提供这组档位（滑块不再走回落），
2. `resolveCallConfig` 通过，
3. `openai-completions` 把它发上线：`params.reasoning_effort = model.thinkingLevelMap?.[level] ?? level`。

即：**不是绕过检查，而是把检查要的那个申报补上。**

### 用户实际的路由

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: llm-pi-ai
  config:
    providers:
      undarouter:
        api: openai-completions
        baseURL: https://r.unda.bot.cd/v1
        models:
          - id: agentrouter/deepseek-v4-flash
            contextWindow: 1000000
            maxTokens: 384000
            input: [text, image]
```

这是**手写路由**（不在随包目录里），所以 `base` 为空 → `reasoning: false` → 无档位可调。加一行就好了：

```yaml
            reasoningEfforts:
              low: low
              medium: medium
              high: high
```

只用 `low/medium/high` 是有理由的：`minimal` 是 OpenAI 专有值、很多聚合网关会拒；`xhigh`/`max` 需要网关自己的词汇；`off` 对这类模型等价于"不发这个参数"，加它只是多一个空档位。

### 关键 API（全部来自官方源码，非猜测）

- 数据源：`ctx.modelDirectories.directoryFor(sessionId)` → `{ available, store, select(selection), load() }`
- 快照：`store.getSnapshot()` → `{ current:{provider,model,reasoningEffort?}, retainedEffort, groups, failures, status, pending, error }`
- 档位表：`groups[].models[].reasoning` → `{ efforts:[{id,name,description?}], defaultEffort? }`
- 提交：`directory.select({ provider, model, reasoningEffort })` → `Promise<{ok}|{error}>`
- 浮层锚点 `conversation.input.overlay` 的父容器只有 **1px 高**（`inset:0 0 auto`）；真实 composer 卡在 `.Dc7zOa_scrollBody`（`overflow-y:auto`）内，所以面板必须 `fixed`，否则被裁切

### 上线时踩的坑（值得记住）

**`undefined !== null`**：模型未申报档位时 `entry.reasoning` 是 **`undefined`** 而非 `null`，而守卫写成了 `reasoning !== null` → 直接读 `undefined.efforts` 抛错 → 渲染器错误边界捕获 → **条目被 abdicate（永久退役出该 id 单元）**，槽位渲染成空的 `<div data-slot-error>`，页面上什么都看不到。

诊断路径（无控制台时也能走通）：`Slots.listSubTree` 显示 `active:false` → 读 `ui-slots` 源码，`active` 只由 `entriesOfSlot` 的非-abdicated 胜者决定 → 读 `abdicated` 写入点，唯一来源是 `reportEntryError({abdicate:true})` → 唯一调用方是 `SlotErrorBoundary.componentDidCatch` → **必然是渲染崩溃**。

修法：`absent(v)` 同时判 `null` 与 `undefined`，全文所有可选字段一律走它（同类隐患一次清掉 3 处：`reasoning`、`useStoreSnapshot` 的 `store`、`select()` 的返回值）。

**教训**：
1. `active:false` + 槽位为空 = 我的组件抛错了，不要往 data/locale/style 上猜。
2. **不要用 PowerShell 的 `Get-Content/Set-Content` 处理含中文的文件**（控制台代码页会把 UTF-8 读成 GBK，不可逆损坏），只用文件工具。
3. `new Function('window', src)` 会**遮蔽**全局 `window`：组件读 `window.innerWidth` 时拿到的是那个参数，测试与生产必须传同一个对象。
4. 网格只写 `grid-auto-flow:column` 而**不写 `grid-template-columns`** 时，`justify-content:center` 会把所有格子堆成一长行（实测 230 格一行），看起来就是"一条线"。
5. 变量只在暗色块或只在亮色块里定义，都会**静默串味**；`tools/audit-css.js` 就是为这条写的。
6. **不要靠主题属性分支来配色。** v2 曾用 `body[data-ds-dark-theme]` 覆盖亮色基准值并出现"白滑块压在浅灰轨道上"；v3 改成一条配方走天下——面板以上的一切都是 `label-primary` 的百分比混合。教训是颜色只走 `--dsw-alias-*` 令牌：令牌改名只会让外观退化，而手写的主题分支会直接产出不可读的界面。`audit-css.js` 现在会**拒绝任何有彩色字面量**（只放行 `#000` 这类掩码用的无彩值）。
7. **"不好看"要变成数字。** "对比度太低"这句话被 `tools/contrast.js` 变成了 6 组配对 × 2 套主题的断言，也顺带查出了 `bg-overlay` 在暗色下是中灰这个反直觉的事实。凡是能用测量表达的主观反馈，就先测量再改——否则只会在配色上反复打转。
8. **"能不能做"要先找到那个说不的地方。** 用户说"我想要强制上报档位"，我没有先写代码，而是去找**谁在拒绝**：`grep reasoningEffort` → `resolveCallConfig` → `resolveCallWithInfo` 里那一行 `throw`。找到拒绝点之后，"能/不能"和"怎么做"同时有了答案，而且答案不是"绕过去"，是"把缺的那半补上"。如果我按直觉直接写"多试几次/换字段名"，做出来的会是个永远失败的功能。

---

## 6.6 已实施（v3）

两件事：修掉页脚的空行，以及把"强制上报"做成真的能用的功能。

### 页脚的空行

`.te-foot` 原来恒定 `min-height:32px`（留两行）。这个预留是为**逐档说明**准备的——说明文字随滑块长度变化，不预留整张卡会跳。但"未申报"提示和错误都是定长单行，预留出来的第二行就是一条**空行**。

改法是把预留绑到真正需要它的那一种状态：

```css
.te-foot{margin-top:9px;color:...;font-size:11px;line-height:16px}  /* 不再有 min-height */
.te-footDesc{min-height:32px}                                       /* 只有逐档说明才留两行 */
```

页脚现在有四个互斥状态：逐档说明（留两行）、选档失败、未申报（带操作）、本插件已申报（带撤销）。

### "申报档位"：跨 Host 的真功能

**客户端半边不可能自己完成这件事**，所以这一版第一次给这个插件写了 host 半边。

```
client.js  ──GET /thinking-effort/levels?provider=&model=──▶  index.js
           ◀── {state: undeclared|ours|native|nonreasoning|unsupported} ──
           ──POST {provider, model, action}──▶  config-declare.js（纯函数）
                                              ▲
                                              └── configEditor.edit(entry, change)
                                                    ├─ 用插件自己的 Config schema 校验
                                                    ├─ 原子写 profile 的 cordis.patch.yml
                                                    └─ 失败则回滚文件
```

选择 Fetch 路由而不是 Client Service：注册 Remote 要走 Typert 代码生成，而 `ctx.webServer.register` 是 `dsh-host-open-in-app` 用来做浏览器侧写入的**同一条缝隙**，连信任围栏都能复用：

```js
const rejection = connection.requestRejection(req);   // Host/Origin 栅栏 + 浏览器认证
```

写完之后 host 主动 `ctx.emit("llm/adapters-updated")`：pi-ai 自己**不发**这个事件（它的目录每次请求重建），而客户端的 `ModelCatalogDirectory` 只监听事件，所以不补这一下，滑块会停在旧状态直到刷新页面。

**写的是什么，是可以逐字节验证的：** `config-declare.js` 只动 `providers[route].models[id].reasoningEfforts`，其余整棵配置克隆不动；`revert` 只有在当前值**逐字节等于**自己写的那份时才删，所以**任何不是本插件写的档位都不会被删掉**（`tools/smoke-declare.mjs` 里有 5 条针对这条的拒绝断言）。

**界面的诚实性：** 未申报时轨道进入 `te-railIdle`——不画滑块、不画填充、指针与键盘都不提交，只把 3 个刻度画出来当作"申报后能拿到什么"的预览。以前那种"拖了必报错"的死滑块不再存在。

**失败是可见的**：host 返回稳定的 `code`，客户端映射到中英词典（`why.route-missing` 等 8 条），未知码回落到通用文案，永远不会把裸标识符打在界面上。

### 这一版新增的门禁

- `tools/smoke-declare.mjs`（49 项）：配置手术的正确性、**幂等性**、**不改输入对象**、以及"除目标字段外逐字节不变"；再加三条跨文件不变量——客户端预览的档位 id 必须等于 host 申报的档位 id、两边的路由路径必须相同、host 能返回的每个错误码必须在中英词典里都有条目（**两条都靠读源码文本断言**，因为两个 bundle 无法互相 import）。
- `tools/audit-css.js` 加了 `--dsw-*` 门禁：从 `app.asar` 的 `dsh-client-ui-theme` 里读出本 build 真实定义的 403 个令牌，断言样式里读到的每一个都在其中。以前这条只覆盖插件自己的 `--te-*` 变量，而**颜色令牌写错**的表现是"某个值没生效"，不是报错——正是最难查的那类。加了 `process.argv[2]` 之后也能拿一份改坏的副本做反向验证（已验证：把 `--dsw-alias-label-tertiary` 改成 `...y` 会让门禁以退出码 1 失败）。
- `tools/smoke.js` 的迷你运行时**开始真跑 `useEffect`**（带 deps 与清理），于是"申报"整条链路可以在无浏览器条件下走完：GET → 出现按钮 → 点击 → POST 载荷 → host 发布新档位 → 轨道恢复可拖 → 变成"取消申报" → 再 POST。70 项断言。

顺带修掉一个潜伏问题：外部点击关闭那个 `useEffect` 直接用了 `document` 而没做存在性判断，在 `useEffect` 是空实现的旧测试里从未被执行到——一开副作用就会抛。

---

## 6.7 已实施（v3.1）：吸附与键帽

两条用户反馈，一条是真 bug，一条是配色取舍。

### 「不会自动弹到档位对应的位置」——命令式定位漏了一个依赖

滑块的位移不是渲染出来的，是一个 `useLayoutEffect` 直接写 `style.transform`（因为拖拽要跟手，不能走渲染）。它的依赖是：

```js
}, [fraction, travel, open, anchor]);   // ← 少了 dragging
```

拖拽期间 `pushChoice` 已经把档位**乐观地**选成目标档，所以松手时 `fraction` **没有变化**；`dragging` 又不在依赖里 ⇒ 这个 effect 从不重跑 ⇒ 滑块停在手指松开的那一格中间，永远不吸附到刻度上。

复现数字（6 档、`median→high`、轨道 240、行程 214）：

| 场景 | 期望 | 实际 |
|---|---|---|
| 同一档内松手（`medium` 偏移 +9px） | `translateX(85.6px)` | **94.6px** |
| 换到下一档松手（`high` 偏移 +11px） | `translateX(128.4px)` | **139.4px** |

修法：把 `dragging` 加进依赖（它不参与计算，只作为"松手"的信号）。注释里写清了这一点，因为下一个人很可能会把它当成无用依赖删掉。

**顺带修了测试运行器的一个欺骗性缺陷**：假 DOM 节点每次重绘都新建，而 React 会复用同一个节点。结果是命令式写进 `style` 的值在重绘后凭空消失，`paint()` 的行为根本无法被测到（第一次跑出来是 `NaN`）。改成用 `WeakMap` 让同一个 ref 映射到同一个假节点之后，这个 bug 才暴露出来。

### 「滑块的颜色感觉很暗」——键帽不该是墨色

原来滑块底色是 `--dsw-alias-label-primary`：暗色下是白（好看），**亮色下是近黑 `#0f1115`**（就是"很暗"）。我那套理由是"两套主题都拿最高对比"，但那是**文字**的逻辑，不是**键帽**的逻辑。Claude 和 ChatGPT 的滑块在两套主题下都是浅色键帽。

改成白色键帽 + 描边 + 双层投影，靠**边缘和高度**而不是亮度差来定义。门禁也跟着改，但**不是放宽**——是把"白键帽凭什么能看见"变成可测的：

```
亮度差 ≥3:1                          → 用 dark 主题（7.80:1，走 fill 路径）
否则必须同时满足：                     → 用 light 主题（走 edge+shadow 路径）
  描边 vs 轨道 ≥1.15:1   （实测 1.50:1）
  描边 vs 键帽面 ≥1.15:1 （实测 2.43:1）
  投影层数 ≥2            （实测 3 层）
```

关键是这个判定读的是**样式表里真实写的 `box-shadow`**（正则抓 `.te-thumb` 的声明并数层数），所以把投影删掉会让门禁失败，而不是让界面悄悄变平。

### 教训

9. **命令式更新的正确性有一半在依赖数组里。** 不参与计算的状态也可以是必需的依赖——`dragging` 就是这样：它唯一的用途是"这个 effect 该在松手后重跑一次"。凡是"外观由 effect 直接改 DOM"的写法，都要有一条断言去读那个 DOM 属性的**最终值**，而不是只断言 aria 或业务回调。这个 bug 之前 74 项断言全绿，因为没有任何一项读过 `transform`。
10. **"高对比"是文字的标准，不是控件的标准。** 拿 `label-primary` 给键帽上色，等于把"最易读的墨"当成"最像实物的键"，结果亮色下是一块黑方块。控件可以靠描边和投影成立；把它写成门禁里的显式分支，比在配色上辩论有用。

---

## 6.8 已实施（v3.2）：「强制申报没做好」与那条时报时好的错误

用户报了两件事：申报不可靠，以及**偶发**的「provider 不支持该思考等级」。后者是官方错误串，先定位它从哪儿抛。

### 三个抛出点

```
dsh-llm/lib/index.js:2191          requested !== undefined 且 reasoning === undefined
dsh-llm/lib/index.js:2195          档位不在 efforts 里
dsh-llm-pi-ai/lib/index.js:1788    分发路径：resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning)
```

全是**校验点**，没有一处是网关返回的。也就是说：只要提交的档位和**当下**的能力视图对不上，就一定报这个错——问题在于谁会拿到过期视图。

### W1：写入后、目录刷新前的那个窗口（主因）

申报走的是「写 profile → hmr 重新加载 → 适配器重建 → 目录 refetch」。而客户端原来在 **POST 返回的那一刻**就把滑块重新点亮，注释里还写着"宿主会自己发 `llm/adapters-updated`，不用猜"——**这是我写错的假设**：profile 改了、目录还没刷新，提交必然撞上旧视图。

修法：写成功后不再乐观放行，而是 `await directory.load()` 之后再 `setBusy(false)`。宁可多转半秒的"写入中…"，也不给一个必然报错的滑块。

同时 Host 现在会**回报实际生效的档位**（读 `llm.resolveModelInfo`，不是读 profile）：

```js
resolveModelInfo(provider, model).reasoning.efforts.map(e => e.id)   // 请求路径真正会校验的那份
```

这样"写进去的"和"会被接受的"是同一个来源，不再各读各的。

### W2：取消申报会留下一个孤儿默认档（我的 bug）

`session/selectModel` 成功后会调 `agentDefaultModel.saveSelection(selected)`，所以在这个控件里选过档，profile 里就**永久**多了：

```yaml
- id: agent-default-model
  config: { provider: undarouter, model: agentrouter/deepseek-v4-flash, reasoningEffort: high }
```

于是 `revert` 撤掉 `reasoningEfforts` 之后，上面那行 `high` 就成了孤儿：**之后每个新请求**都拿 `high` 去校验一个未申报的模型 → 每条都报「不支持该等级」，而且**发生在用户从没碰过这个控件的会话里**。这解释了"有的时候会报错"——它跟你刚才点过什么有关。

修法：`revert` 顺手清掉这个默认档，但只在**三个条件同时成立**时：

1. 默认档指向的正是这条 route；
2. 它的档位是我们申报过的那几个 id 之一；
3. 当前值逐字节等于我们要删的。

否则一律不动（`tools/smoke-declare.mjs` 里有 6 条针对这些边界的断言，包括"另一个模型的默认档不受影响"）。

### 另外两处

- **`llm` 改成按请求解析**，不放进 inject 列表。它只用于提供 `levels` 这条信息，而硬依赖会让启动顺序决定整条路由是否存在——我在围栏那次已经踩过这个坑（`scope.get("connection")` 在挂载时返回 `undefined`，整个围栏被跳过）。
- **`connection` 仍是硬依赖**：它是写配置的围栏，缺席时路由就不该存在。

### 教训

11. **"事件会自己发出来"是要验证的断言，不是可以写进注释的安慰。** 我在注释里写下"宿主会发 `llm/adapters-updated`，不用猜"，但真正决定成败的不是那个事件，而是**目录有没有 refetch 完**。乐观放行把两件不同的事混成一件：写成功 ≠ 能力视图已更新。
12. **写配置的功能必须检查"留下的其它配置"。** 我的 `revert` 只回滚了自己写的那一行，却把一个由**别人**（`selectModel`）写进去、现在指向不存在能力的字段留在原地。凡是本次改动让某个已有配置失效的，都要在同一次操作里处理掉——否则错误会跑到毫不相干的会话里。

---

## 6.9 已实施（v3.3）：滑块配色的四次失败与最终的"关系"

用户先后说了三句话，每一句都在指同一个我没想到的层面：

> "滑块好暗（对比度极低）" → "谁让你改成灰色的" → "这是什么蓝色？这么深，给谁看的？"

### 四次尝试，四次都在改颜色，而没有改关系

| 版本 | 轨道 | 已用段 | 键帽对轨道 | 用户看到的 |
|---|---|---|---|---|
| v1 | `label-primary` 22% 混色 | 品牌色 24→52% | 1.62:1（亮） | 糊 |
| v2 | 同上 + 白键 | 同上 | 1.62:1 | **对比度极低** |
| v3 | 中灰 `#8a8f95` | 深灰 `#565b61` | 3.26:1 | 能看了，但**"谁让你改成灰色"** |
| v4 | `#5686fe` 满色 | `#2f56c4` 深藏青 | 3.37:1 | **"这么深，给谁看的"** |

关键错误在 v4：我把**轨道**做成了品牌满色，把**已用段**做成更深的藏青。于是档位一高，整条轨道被深蓝覆盖大半，看起来就是一根深色条。

**改颜色永远修不好"关系错了"。** 正确的是：

```
轨道 = 品牌蓝 26% 的浅色（color-mix 到面板底色上）
已用段 = 品牌蓝本身 #5686fe
```

即"**浅槽里填蓝**"，而不是"蓝槽里填更深"。这就同时满足了三件事：轨道始终是浅的（不再"太深"）、是品牌蓝（不再"灰色"）、键帽压在已用段上是 3.37:1（不再"对比度极低"）。

另外这次轨道用 `color-mix` 到 `--dsw-alias-bg-layer-1`，**一条配方两套主题都成立**：叠在白底上是 `#d3e0ff`，叠在 `#232324` 上是 `#303d5d`——深色主题下自动变深，不需要任何主题分支。

### 键帽的两条判定路径

白键压在浅槽上**不可能**到 3:1——任何浅到看起来是"浅色"的底，白字都到不了。所以门禁承认两条路径，**必须满足其一**：

- **fill**：键帽对底色 ≥3:1（深色主题的 `#303d5d` 是 10.76:1，走这条路）；
- **edge+shadow**：描边对底 ≥1.35:1、对键帽面 ≥1.35:1、投影 ≥2 层（亮色主题的 `#d3e0ff` 是 1.32:1，走这条路，1.60:1 / 2.12:1 / 3 层）。

这不是放宽——这是承认控件和文字本来就是两种可读性机制。

### 教训

13. **先问"谁该深谁该浅"，再问"用什么色"。** 三次改色失败，是因为轨道和已用段的**明暗关系**一直反着：窄的已用段比宽的轨道更深，于是"用了多少"视觉上变成"整条多暗"。控件设计里，填充物和被填充物谁更深，比具体色号重要一个量级。
14. **门禁的解析要盯住"基础规则"，不是"任何匹配"。** 这轮有两个门禁自己出错：`contrast.js` 用正则搜描边，搜到的是 `.te-max .te-thumb` 那份变体，于是把删掉投影的坏样本判成通过；`show-rule.js` 的常量发现正则写错了分组，渲染出 `NaN%`。**门禁绿了不等于门禁在看**——`tools/negative.js` 才是证明它在看的东西，而它这轮一共抓出 4 次门禁自身的失效。

---

## 7. 作用域与持久化

| 层 | 存什么 | 机制 | 备注 |
|---|---|---|---|
| 会话级（即时） | 当前档 | `session.selectModel` | 这是主路径，改档立即作用于下一条消息 |
| 全局默认 | 新会话的起始档 | `agentDefaultModel.saveSelection`（写入时机见 §10-R3）| 注意：`selectModel` 本身"会在后台保存默认值"，如果只想改本会话而不动默认，需要另行确认是否存在纯 session-local 写入路径 |
| 插件偏好 | 显示策略、动效开关、每 provider 默认档 | `settings` 命名空间（`settingsController` 的 describe/update/mutate）| 走 `settings.general.item` 那一行的 schema |

**已改档的会话天然可追溯**：`request/header` 事件带 `reason:'change'`，历史里能看到"从 High 切到 Ultracode"。

---

## 8. 实现路径（三种载体）

| 载体 | 交付方式 | 优点 | 代价 |
|---|---|---|---|
| **A. 动态客户端插件**（运行时 define/run） | 不用构建，改完立即在 GUI 生效 | 迭代最快，最适合验证动效 | 受动态半边能力边界限制；本会话的工具集里**没有** `cordis_define/cordis_run`（那套工具属于另一个 profile），我这边走不通 |
| **B. 源码插件包**（`@deepseek-ai/dsh-client-ui-*-effort` + 可选 host 半边） | pnpm 构建 → 客户端 HMR | 正规、可发布、可进 Plugins 页 | 需要可写的 dev checkout + 构建链（本机目前不满足，见 §11） |
| **C. npm bundle** | `plugin_manager install_bundle` | 无需 checkout，用户可自行装卸 | 需先有一个可安装的包（本地/私有 registry） |

**推荐**：先用 A 把动效和手感调到位（1 个文件，几十分钟），定稿后照 B 落地成正式插件包，用 C 分发。
本轮的交付物就是**为 B/A 都能直接复用的规格 + 一个不依赖构建的原型**（`rheostat-prototype.html`）。

---

## 9. 验收清单

**已由无头测试证明（`node tools/smoke.js`，39/39）**
- [x] N 档模型的滑块正好 N 个刻度；无档位/单档 → 控件不渲染（**没有硬编码档位**）。
- [x] `reasoning` 缺失或为 `null` 时**不抛错**（上线崩溃的回归锁）。
- [x] 拖到最右 → 提交最高档；拖回当前档 → **不发请求**；一档位移 → 恰好一次请求。
- [x] `←/→` 一档一档走；`Home/End` 到两端；滑块是 `role="slider"` 且 `aria-valuetext` 可读。
- [x] 最高档方块阵列 **5 排 × N 列 = 5N 格**，格子是 3px 正方形，且显式声明了 `grid-template-columns`（否则会退化成一行）。
- [x] 约 22% 格子参与闪烁，各自带独立 `--te-dl` 延时（不同步）。
- [x] 只有最高档才出现阵列；只有最高档档位名才染品牌色。
- [x] 提交被拒 → 显示 `state.failed` 文案（不静默）。
- [x] 组件请求的每个文案 key 在 zh/en 两侧都存在。

**仍需真机人眼确认（我这边无浏览器）**
- [ ] 视觉观感：间距/圆角/阴影是否与自带模型菜单连贯。
- [ ] 明暗两套主题下的品牌蓝（`--dsw-alias-state-business-primary`）观感。
- [ ] `prefers-reduced-motion` 下闪烁停止、阵列仍在。
- [ ] 拖动跟手度与吸附过渡的"手感"（主观）。
- [ ] 面板从 composer 卡上方浮起、不与自带弹层打架。
- [ ] **未申报档位时**：轨道确实呈"预览态"（无滑块），页脚出现"申报档位"。
- [ ] **点"申报档位"**：写完 profile 后滑块自动恢复可拖（我这边无法发起这个 HTTP 请求——路由有 Host/Origin + 浏览器认证栅栏，`pwsh` 没有页面 cookie）。
- [ ] **host 半边是否需要重启**：`bundle/client.js` 由 `client-hmr` 自动重载，但 `bundle/index.js` 是 host 侧模块，Loader 是否重新 import 未经实测。若"申报档位"没出现、页脚显示"…且无法在此申报"，说明路由 404，**重启 DSH** 即可（这是自解释的失败，不会静默）。
- [ ] 申报后请求是否真的被 `r.unda.bot.cd` 接受：申报只保证 `reasoning_effort` **被发上线**，网关是否照做/是否 400 我无法预判。不接受就点"取消申报"（host 会先校验那份值确实是本插件写的，才允许删）。

---

## 10. 待核实项（**v1 已全部落地**，保留供后续维护参考）

- ~~**R1** `UseConversation` / `InputActions` / `InputState` 的精确形状~~ → 改用 `ctx.modelDirectories` + 槽位标准 props 里的 `sessionId`，不依赖这些 hook。
- ~~**R2** 客户端访问 `session.modelCatalog` / `selectModel` 的合法通道~~ → **完全不需要**：客户端半边直接 `ctx.inject(['slots','modelDirectories','locale'], ...)` 拿到服务，不走 host、不写 host 半边逻辑。
- ~~**R3** `ModelSelection` 的字段名~~ → `reasoningEffort`（`select()` 与 host schema 一致）；`selectModel` 确实会后台保存默认值，对 UI 无副作用。
- **R4** `--dsh-composer-model-*` 紧凑变量确实存在（`--dsh-composer-model-text-display` / `-icon-display`），但那是模型席位自己的内联变量，本插件**未复用**以免耦合。
- **R5** 思考流式事件怎么订 → v1 **未实现**"运行中呼吸"（需订阅 assistant-stream 帧），列为可选增强。

---

## 11. 环境（本轮已恢复）

1. `pwsh` 现在可用（此前沙箱给工作目录授权时 `SetNamedSecurityInfoW failed (Win32 5)`，F: 卷疑似不支持 ACL）。当前会话文件策略为 danger-full-access。
2. `E:\DeepSeek Harness\resources\app.asar\dsh` 不是可写 checkout，但 **`tools/asar.js` 能直接解析 asar 头并读出任意官方源码与 CSS**（`node tools/asar.js cat <path>` / `grep <re> <prefix>`）。这是本轮所有 API 结论的来源，后续维护请继续用它取真值，别猜。
3. 插件本体在工作区 `bundle/`，通过 `plugin_manager install_bundle` 以 `link:` 方式装入 profile；改 `bundle/client.js` 后 `client-hmr` 会重载客户端 bundle（本轮实测：改完文件后两个条目的 `active` 从 `false` 变回 `true`，无需刷新页面）。
   **但 host 半边不一样**：`bundle/index.js` 是 host 侧 ESM 模块，由 Loader 在启动时 `import` 一次，改文件**不会**被重新 import。本轮实测证据链：
   - `Invoke-WebRequest http://127.0.0.1:19387/thinking-effort/levels?...` → **404**（说明路由未注册；handler 自己在未认证时只会回 401/403）
   - 在 profile 目录里按 Loader 的方式解析：`import('@local/dsh-thinking-effort-rheostat')` → `apply.length === 1`（新半边；旧的空 `apply()` 是 0；v3.9 前的旧名 `@local/dsh-thinking-effort`）
   → 磁盘上是对的，跑着的是旧的 ⇒ **host 半边改动需要重启 DSH**。
   已实现在客户端侧的降级是自解释的：路由 404 时 GET 拿不到 JSON，状态落到 `unsupported`，页脚显示"…且无法在此申报"，不会静默假装成功。
4. **`web_fetch` 被网络策略挡住**（`registry.npmjs.org` / `registry.npmmirror.com` 都报 "resolves to a non-public IP"），所以无法查线上文档 —— 一切以本地 asar 内的官方源码为准。
3. **副作用（必须声明）**：因为跑不了浏览器，`rheostat-prototype.html` **未经真机渲染验证**——它是"逐条按 CSS 规范写出来的"，不是"跑过截图确认的"。几何/逻辑类错误我已在源码层面复算并修掉了 7 处（v1：亮度梯度被 opacity 动画冲掉、暗色焦点环被盖掉、切模型时阵列没熄灭；v2：轨道中心锚点错位导致滑块与刻度不同心、field 垂直溢出 1px、`is-max` 在 pointerdown 被误移除导致闪烁、工具行文案在档位名相同时不刷新）。但**像素级的美感最终必须靠你打开看一眼**。
4. ~~无法读到自带浮层 CSS~~ → **已读到**：`node tools/peek-css.js dsh-client-ui-model-selection trigger menu` 等可抽出官方内联 CSS，本插件已按真实值对齐（`--dsw-radius-sm`=8 / `-md`=12、`--dsw-alias-interactive-bg-hover`、`--dsw-elevation-prominent`、28px 触发器、13px/400 字重）。
5. 官方只读探针（`cordis_inspect_*`）工作正常 —— 这是本方案所有"现状"结论的来源，后续实现请继续用它取真值，别猜。

---

## 12. 交付物

- **已装插件**：`bundle/`（`@local/dsh-thinking-effort-rheostat`，v3.9 改名，已安装到 `desktop` profile）
  - `bundle/client.js` 浏览器半边（控制、面板、阵列、动效）
  - `bundle/index.js` host 半边（`/thinking-effort/levels` 路由）
  - `bundle/config-declare.js` host 侧纯函数（配置手术，可脱离 Cordis 测试）
- **无头测试**：
  - `tools/smoke.js` —— 70 项断言（含"申报"整条往返）
  - `tools/smoke-declare.mjs` —— 49 项断言（配置手术 + 跨文件不变量）
- **门禁**：`tools/audit-css.js`（含 `--dsw-*` 令牌存在性）、`tools/contrast.js`（12 组配对）
- **取证工具**：`tools/asar.js`、`tools/peek.js`（读 asar 内任意官方源码/CSS）
- 设计文档：`thinking-effort-rheostat.md`（本文）
- 视觉原型：`rheostat-prototype.html`（设计参考，非插件本体）
- 视觉原型：`rheostat-prototype.html`（零依赖单文件，双主题 + 拖拽/键盘 + 6/5 档自动适配 + 最高档方块阵列 + 自动检测演示；**这是设计稿，不是运行中的插件**）

---

## 13. v3 变更记录（自定义申报档位 + models.dev 预填 + 页脚修复）

### 13.1 自定义申报阶梯（可选择的档位）

申报不再是硬编码 `low/medium/high` 三档。词表对齐 pi-ai `THINKING_LEVELS` 的七档：
`off, minimal, low, medium, high, xhigh, max`。

- **选择器（ DeclareChooser ）**：点页脚"申报档位"不再直接写默认三档，而是打开选择器：7 个档位芯片 + 每个已选档位一条 `档位=值` 的接线行（`off` 固定 `null`，即"选择器语义：off = 不发参数"，笔记用 `cho.offHint` 说明）。申报写的是 `reasoningEfforts: { <所选档位>: <接线拼写> }`，非 off 档必须是**非空字符串**，否则拒绝（`why.bad-levels`）。
- **草稿提升（draft lift）**：选择器的当前选择会实时提升到上方轨道，把"申报后能拿到什么"的预览从固定 3 刻度换成当前草稿的刻度集合；取消则丢弃草稿恢复默认预览。
- **外语键兼容（managed-shape "ours" 语义）**：`"是否本插件申报的"`判定从"逐字节等于默认三档"放宽为**形状判定**：键全部在词表内、值合法（off→null，其余→非空串）、且至少一个非 off 键，即视为可撤销的 `ours`。这意味着手工改过配置（例如只留 `{high:"high"}`，或加了 `xhigh`）仍能安全撤销；而删除后手写的未知键/空值/`{}` 一律 `native` 不可动。客户端指纹与 host 的 `isManagedLadder` **必须保持一致**（`tools/smoke-declare.mjs` 有跨文件镜像断言防止两边漂移）。
- **危险操作的实际含义变了**：`planRevert` 现在保护的是"managed 形状"，被删的是整份 `reasoningEfforts`（返回到 `model-missing` 之前的原生状态）。逐字节数值校验由 `normalizeLevels` 完成：未知键拒绝、`off` 以外的空串/null 拒绝、重排到词表顺序、`off` 的 `""`/`undefined` 归一为 `null`。

### 13.2 models.dev 预填（裸模型名查询）

新增 host 路由 `GET /thinking-effort/modelsdev?name=<裸名>`：

- 客户端从 `provider/model` 的最后一个 `/` 之后取**裸模型名**去查（例如 `agentrouter/deepseek-v4-flash` → `deepseek-v4-flash`）。
- host 侧抓 `https://models.dev/api.json`（**模块级缓存 30 分钟**，超时 12s，`AbortSignal.timeout`）；匹配打分：裸名精确=0、id=1、≥4 字符子串=2、显示名=3，最多 6 条，去重，全无命中时回退裸名子串。
- 返回每个匹配的 `reasoning_options` 里 `type:"effort"` 的 `values`（裁剪后），客户端用 `match.efforts ∩ 词表` 预填芯片与接线，笔记显示命中条目的 `provider/model` 与它提供的档位。
- **降级自解释**：没有 fetch 载体 → `why.no-fetch`；models.dev 无此模型 → `why.no-fetch`（501）+ 笔记说明；上游抓取失败 → `why.fetch-failed`（502）。三种失败都**只影响预填**，手动选档照常可用。
- 路由与 `/thinking-effort/levels` 同一信任围栏（`connection.requestRejection`），只允许 GET（405）。

### 13.3 页脚空折叠修复

`.te-footDesc` 之前无条件 `min-height:32px`（加上 9px 外边距 = 无提示时白占 ~41px）。现在：没有描述时 `te-footDesc` 根本不渲染；选择器打开时整个页脚折叠为 `null`（错误则由选择器内联笔记 `te-choNoteErr` 承担，页脚不重复）。

### 13.4 测试面

- `tools/smoke.js`：129 项 —— 新增整条选择器往返（打开选择器不写、7 档词表、models.dev 查询用裸名、预填芯片/接线/预览、加档、取消丢弃、重开崭新草稿、apply POST 携带 `{levels:{low:'low',medium:'medium',high:'high'}}`、revert **不带** levels、chooser 内联拒绝 `te-choNoteErr`、页脚空折叠）。运行时为此扩展了**嵌套函数组件渲染**（子实例按树路径复用/卸载，真正重开 = 重新挂载）与 owner 绑定的 useState setter（子组件事件能更新父状态）。
- `tools/smoke-declare.mjs`：137 项 —— managed-shape 语义、自定义集申报/撤销往返、`normalizeLevels` 排序/拒绝矩阵、`declaredLadderKeys`、跨文件不变量（`MODELSDEV_ROUTE` 两半一致、`why.*` 双语 × 全码集合、词表/预览档镜像 LEVEL_IDS/DECLARED_LEVELS）。
- 门禁：`tools/audit-css.js`、`tools/contrast.js` 继续全绿（选择器新样式只用了主题令牌 + 焦点环 var 链）。

### 13.5 已知边界

- models.dev 预填只做"建议"，最终以接线行拼写为准；`agentrouter` 这类中转 provider 的裸名若在 models.dev 缺失，会回退到子串匹配，仍无则全部手动。
- host 半边（`bundle/index.js` + `bundle/config-declare.js`）需要**重启 DSH** 才生效；`bundle/client.js` 走 `client-hmr` 自动重载。重启前旧 host 会 404 新路由 → 客户端预填降级为 `why.no-fetch` 说明，不影响其余功能。

## 14. v3.4 变更记录（申报流程按"人类操作逻辑"重排：一键启用）

用户反馈：申报交互不符合人类操作逻辑——未申报模型点一下页脚，先弹出一个"芯片 + 逐档接线行 + 搜索框 + 双按钮"的表单，要求用户理解"申报"这个概念才能完成任务。重排原则：**默认路径一步到位，定制是显式绕路，专家字段默认不可见。**

- **页脚主操作 = 一键启用（`act.declare` = "一键启用"）**：点击 → 静默查 models.dev 裸名 → 命中则取 `efforts ∩ 词表`（≥2 档才算数），否则回落标准三档（`DEFAULT_PREVIEW_IDS` = host 侧 `DECLARED_EFFORTS` 镜像）→ 直接 POST `declare`。无表单、无确认：写完轨道自己亮起来。抽出的 `matchLadderIds()` 与选择器预填**共用同一判定**，两处建议不会分叉。
- **自定义降级为旁路（新 `act.custom` = "自定义…"）**：`te-footAlt` 弱化链接样式（tertiary 墨色，非 accent），只有它打开选择器——绕路不再是默认入口。
- **选择器减负**：① 搜索行只在查询**没**命中（none/empty/failed）时出现，命中时只剩一行笔记（命中 id × 提供档位）；② 逐档接线行折叠进 `te-choAdv`（"自定义发送值…"）展开开关，收起时拼写一律取档位 id，submit 照常组出合法 ladder，`cho.wireEmpty` 只在展开态可达；③ 文案全面去"申报"术语：`state.undeclared`="该模型没有思考档位"、`state.ours`="档位已由「思考强度」启用"、`act.revert`="撤销启用"、`cho.apply`="启用（{count} 档）"、接线往上"上报拼写"→"发送值"。
- **拒绝反馈改归属**：一键启用被拒绝 → 错误落在页脚自己的 `te-footErr`（`act.failed`：原因），**保留"一键启用"+"自定义…"两个按钮原地可重试**（action 先于文本分支计算，错误不再吃掉操作）；选择器内拒绝仍走 `te-choNoteErr` 内联，页脚在 `chooserOpen` 时照旧折叠。
- 无 fetch / `unsupported` / `native` 的守卫不变：按钮不出现，注释照说事实。

测试面：`tools/smoke.js` 重排申报套件为两条路径（137 项）——一键启用（查 models.dev 顺序在校验写入之前、POST levels 恰为 `{low,medium,high}`、不弹表单）、自定义旁路（te-footAlt 打开、无写入、7 芯片、预填、接线默认隐藏、te-choAdv 展开后接线行出现、加档→4/4/4、取消复位、重开崭新、POST levels、拒绝双表面）。`smoke-declare.mjs`（137 项）、`audit-css.js`、`contrast.js` 全绿。

## 15. v3.5 变更记录（格子阵列与滑块的"跟手收细"）

用户反馈：方块阵列原本"整块出现/整块消失"——滑块到最右才有格子，往左一拖右边残格还挂着，"粗糙、不够精细"。下一版试过"任何档位都挂载、剪裁线逐列裁掉"的方案，被用户否掉，最终定案：**格子只在最高档位亮起；细腻度全部做在最高档↔第二高档之间的过渡上。**

- **只挂载到可动**：`useFieldCells(open && !idle ? railWidth : 0)`——场域随活轨道挂载（拖拽过程需要它在场做渐变），不再与 `isMax` 绑定；idle 预览与关闭态照旧不挂。挂载≠可见：静止停在非最高档时场域定格为**全暗**（`--te-line` 归零 + opacity 0），感知上"非最高档无格子"（用户语）。
- **剪裁跟手（`--te-line`）**：场域 `clip-path:inset(0 calc(100% - var(--te-line,0px)) 0 0)`。拖拽时 `paint()` 原始写（`9 + value*travel`）——拇指右侧的列**当帧**消失，不逐档跳变；Max 停靠写 `railWidth - 8`（bleed 到轨内缘，防高分屏亚像素切边；被拇指右半遮住故无视觉差）。React style prop 不写该变量，两条命令式路径（park/paint）经 `writeVar()`（`try setProperty / catch 直写`）接入，防 re-render 覆盖/清除。
- **边界过渡（smoothstep 辉度）**：`latticeGlow(value)` 只在**最高两档之间的过渡区**（`zoneStart=(count-2)/(count-1)` 到 1）内插值，smoothstep `t²(3-2t)` 保证起止柔和：离开 Max 往下拖 → 剪裁线收线 + 辉度熔离，到第二高档时完全灭；反向拖回 → 指尖下面重新点亮、剪裁线重新展开；区外任何位置辉度恒 0。驻停 transition（`opacity .3s ease, clip-path .45s cubic-bezier(.4,0,.2,1)`）让键盘/换模型/申报落位同样"熔接"，拖拽态由 `.te-railDrag .te-field{transition:none}` 归零延迟。旧 `te-fieldIn` 入场动画删除——开场在 Max 的点亮由场域初始 `--te-line` 未写（=全裁）→首写全亮经 transition 自然扫入。
- **熄灭不烧 CPU**：`.te-cellBlink` 挂 `animation-play-state:var(--te-run,paused)`，park/paint 按辉度写 running/paused——整面不可见时闪烁动画暂停。
- 文档之外的两处配套：`audit-css.js` 的 INLINE 白名单收录 `--te-line`/`--te-run`（按"读取必须在 JS 有写入"的既有规则校验）；`contrast.js` 无涉。
- 测试面（147 项）：非最高档停靠线=0/辉度=0 双断言；Max 停靠 ≥ `RAIL_WIDTH-8` 且全亮；**边界驱动块**——落 Max 满亮(剪裁=223)、拖到第二高档已熄(辉度 0)、Zone 之下途中亦无、回进过渡区中点辉度恰 0.5(剪裁 201.6)、回到 Max 全亮、松手提交 'max'、乐观停靠持续全亮（fake store 滞留期的在屏真相；栅栏下暗停靠由停靠断言覆盖，`await flush` 不可用——CJS 顶层禁 await）。全部门禁绿：`client/smoke --check`、`smoke 147/147`、`smoke-declare 137`、`audit-css`、`contrast`。

## 16. v3.6 变更记录（换档要弹性，入场要从右往左）

用户反馈：上一版的换档动画"不好看"，要求两件事——**换档带弹性**（点击后快速弹过去，带一点回弹），以及**切到最高档位要有从右向左的展开动画**（用户记得旧版有方向性入场，本版恢复并定向）。

- **钥匙与进度条的弹性（`cubic-bezier(.3,1.3,.4,1)` × .45s）**：thumb 的 `transform` 从 .12s 快滑换成 .45s 弹性曲线（约 5% 过冲），fill 的 `width` 用**同曲线同时长**——两者合成一件、同步回弹。过冲幅度刻意压在 ~5%：满程跃迁时钥匙边缘仍不冲出轨道（不做 `overflow:hidden`，max 光晕本来就设计为溢出）；一档之内的短跳仍能看到肉眼可辨的小回弹。拖拽态维持一律无过渡：`.te-railDrag .te-field,.te-railDrag .te-fill{transition:none}`（thumb 本就只留 box-shadow），松手落位才弹。reduced-motion 三件套全关。
- **入 Max 的右→左扫开（两步写）**：停靠进入最高档时，park 改为**两步写入**——先 `transition:none` 写入 `clip-path:inset(0 0 0 100%)`（左折 100%，全隐），`void field.offsetWidth` 强刷一次样式，再恢复 transition 写 `inset(0 0 0 0)`——由"左内边距 100%→0"的过渡产生**从轨右缘向左铺开**的扫开，起点正好在停靠钥匙底下（配合场域自身的左淡 mask，能量"从右注入"的设计语言一致）。不做两步的话浏览器会在左锚与右锚两种 clip 表达式之间同时插值、双边模糊。拖拽中照旧走 `--te-line` 右锚剪裁（paint 先清 inline clip 覆盖，字段仍以 `field.style.clipPath = ""` 交还样式表，见 v3.5），扫开只在**驻停入 Max** 时播放。
- **扫开不重播（双 ref 判据）**：`fieldLitRef`（上次停靠是否已点亮的"驻停真相"）+ `fieldDippedRef`（本次拖拽途中是否曾低于顶档，pointerdown 复位、paint 写 glow<1 置真）。**仅在"从暗 newcomer 入 Max"时扫开**：在中途 dips 后回落 Max 的松手、或本就亮着时的重测/重渲染，只做就地 finalize——重扫已亮 hall 会闪。开场即 Max（挂载首驻停）视为"从暗新入"，推出入场扫开。
- **节奏**：场域 clip 过渡 .45s→.55s（扫开更有存在感；离开时的熔散也随之舒缓）。fill 的旧 `.3s .32,.72,0,1` 与 thumb 的 `.12s` 两条短过渡全部退役。
- 测试面新增 4 条（smoke 151 项）：停靠暗态将 clip 交还样式表（''）；Max 首驻停转出 `inset(0 0 0 0)`；拖拽中 inline clip 已被 paint 交还（''）；dips 后回落 Max 的松手最终仍是折叠打开的终态。`node --check` ×2、`smoke 151/151`、`smoke-declare 137`、`audit-css`、`contrast` 全绿。

## 17. v3.7 变更记录（干硬闪现→全程弹簧；点击与拖拽分离）

用户反馈：v3.6 的换档"显得非常卡、非常难看"，停下修正后又补了一句定性——"很干硬的闪现，希望类似弹簧弹过去"。

- **根因：按下即跳 + 类切换掐断**。旧 `onPointerDown` 在按下帧就 `paint(按下位置)`：此刻 `te-railDrag` 类尚未随 React 冲刷挂上，thumb 仍带 .45s 弹性过渡 → 弹簧刚起步；下一帧类挂上、`.te-railDrag .te-thumb` 把 transform 过渡隐式归零 → 刚起步的动画被掐死，钥匙**瞬移**到位。用户看到的"出发段"是零动画闪现，只剩落地前一点点过冲小抖——弹簧的观感全毁。
- **修正：点击与拖拽分离（`gestureRef` 三态手势）**。按下只记录 `{value, engaged:false}`、**不写任何 paint**；`onPointerMove` 里 |Δvalue| ≥ 0.02（约 2% 行程 ≈ 4px）才置 engaged 并开始原始跟手（阈值内的手指抖动不误触）；松手时未 engaged 的手势按**按下位置** `commit`——park 效应让钥匙从原档**全程弹到**目标档，弹簧完完整整播完，这正是 v3.6 要的"点击直接快速弹过去"的忠实实现。engaged 的拖拽照旧 raw 跟手、松手回弹落位。
- **`onPointerCancel` 独立成中止语义**：不再冒充松手提交（被触摸滚动抢走的指针不是一次档位决定）。清 `gestureRef`、丢掉已推的乐观档位，并新增 `cancelEpoch` 状态进 park 依赖——快速取消可能赶在 React 冲刷乐观 `setChosen` 之前到达，仅靠 dragging 翻转与 chosen 归零无法保证 park 重跑（依赖可能全等），纪元 +1 强制钥匙**回弹到 store 实际档位**，不会停在半路。
- 烟雾适配（156 项）：单击直跳顶档/点原档不发请求改名归入 click 语义；新增"按下不瞬移""阈值内抖动不动""越阈后跟手""被抢指针不提交且回弹 store 档"四组断言；拖拽用例改为"按下→越阈移动→再断言"的进场次序。另修 `shippedTrigger()`：出货模型选择器 css-module 哈希随宿主重建漂移（`wq12jW`→`_9r0rkG`），提取器改为**按类名后缀**（`_trigger{`/`_trigger:hover`/`_trigger:focus-visible`）定位规则，哈希无关。`node --check` ×2、`smoke 156/156`、`smoke-declare 137`、`audit-css`、`contrast` 全绿。
- DeepSeek V4.1 flash 档位问题（显示 3+off、应为五档）已定位到根因：`unda-router` 路由上该模型**未申报** `reasoningEfforts`，pi-ai 出货目录映射 `{minimal:null, low, medium:null, high, max}` 合成出 Off/Low/High/Max 四格；官方数据源（models.dev 与出货目录）均只声明 low/high/max。五档申报（写 profile patch）待用户定夺具体组合后另行处理——本轮按用户指示暂停。

## 18. v3.8 变更记录（撤销启用也弹簧回家）

用户反馈：撤销启用也要优化——"也是弹簧回到初始位置"。

- **撤销的干硬点在"活→预览"的硬切**。`declare.apply("revert")` 成功后申报态翻回 undeclared，轨道从活滑轨转 `te-railIdle` 预览；`.te-railIdle .te-thumb,.te-fill{display:none}` 让钥匙与进度条**当帧消失**（活→活梯子的撤销本有弹簧，唯独钥匙"蒸发"这条路没有动画）。
- **告别幽灵（ghost key + ghost fill）**。监视器布局效应在"open && travel>0 && idle 翻真"的渲染上、且**先于 park 效应**执行（趁 `visualRef` 还没被 idle 分数覆写）捕获钥匙最后停靠位，`setGhost({from})` 渲染两枚与真件同观感的幽灵节点（`.te-ghost`/`.te-ghostFill`，pointer-events:none、aria-hidden）；生成效应按 v3.6 同款两步写入——`transition:none` 落位旧停靠点 + 不透明度 1，`void offsetWidth` 强刷，恢复过渡后写 `translateX(0px)`+`opacity:0`（fill 同步收回 9px）——钥匙从旧档位**弹簧滑回最左初始位并淡出**，格场由 park 效应自然熔暗。620ms 后退役清节点；卸载清理兜底定时器。reduced-motion 下幽灵过渡随三件套一并关闭。
- 依赖与 hook 顺序：`[ghost, travel, railWidth]` 的生成效应与监视器都挂在 `if (!supported) return null` **之前**（#310 红线）；`wasIdleRef` 防重入（面板重开/重测不重播告别）。
- 烟雾适配（159 项）：撤销段新增"翻 idle 时幽灵在场""幽灵 fill 跨度有效""700ms 后退役净空"三条；弹簧两步写入在同步 draw 中不可观测（同 v3.5 经验，断言只读终值）。`node --check` ×2、`smoke 159/159`、`smoke-declare 137`、`audit-css`、`contrast` 全绿。

## 19. v3.9 变更记录（插件改名为 dsh-thinking-effort-rheostat）

用户要求：插件名改成目录名——`@local/dsh-thinking-effort` → **`@local/dsh-thinking-effort-rheostat`**。

- **代码面 5 处**：`bundle/package.json` 的 `name`；`bundle/cordis.patch.yml` insert 行的 `name`（槽位 id `thinking-effort` 不变，slot/样式字典命名空间不受影响）；`bundle/client.js` 的 `__ModuleLoader__.load({id})` 与 `PACKAGE` 常量（`PACKAGE` 派生 `STYLE_ID` 与样式标签 `data-plugin`，随之统一）；`tools/smoke.js` 的 bundle id 断言。
- **安装面 3 处**：profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 两处旧名改为新名（同一条 `link:F:/dsh-thinking-effort-rheostat/bundle`）；`node_modules/@local` 下的 junction 由 `dsh-thinking-effort` 换成 `dsh-thinking-effort-rheostat`（同指 `bundle/`）。`list_bundles` 确认：`availability:"profile"`、`installed:true`、`rows:[{rowId:"thinking-effort"}]` 正常解析，missing 报错消失。
- 遗留痕迹：profile 里 `thinking-effort-loaded.json` 是旧版（@hytime 时代）的 apply 标记，非当前安装机制的一部分，不动。`node --check`、`smoke 159/159`、`smoke-declare 137` 全绿。
