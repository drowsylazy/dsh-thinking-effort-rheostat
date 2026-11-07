# 浏览器定位回归

本目录的依赖仅用于测试，不属于插件运行依赖，也不会给 Harness 页面打包第二份 React。

## 运行

在项目根目录：

```powershell
pnpm --dir tools/browser install --ignore-scripts
pnpm test
pnpm test:browser
```

测试默认使用 Windows 已安装的 Chrome。其他位置可通过 `DSH_TEST_BROWSER` 指定 Chromium 可执行文件；不下载浏览器、不读取用户浏览器 profile。

`fixture.mjs` 在真实 Chromium DOM 中用 React 挂载插件注册的组件，仅替代 Cordis/模型数据服务。它不是对已部署 GUI 的测试。覆盖：

- 新对话的普通祖先，以及旧对话的 `will-change: transform` 祖先；后者即使 `transform: none` 也改变 fixed containing block。
- `transform`、`filter`、`contain: layout` 祖先与非零容器偏移。
- 明暗主题、240px 窄视口、内部滚动、窗口 resize。
- 实际面板矩形与视口坐标一致，且面板属于 document body 的 Portal。
- 键盘换档、Escape 归还焦点、外部点击关闭、React 卸载无孤儿面板。

输出的 JSON 和截图默认写入被忽略的 `.verification/`；用 `--report <path>` 改位置。`--source <path>` 可测试另一份 bundle；`--before` 只用于确认原版确实复现偏移，**不表示原版已通过修复后的定位断言**。

## 当前 GUI 实测

`live.mjs` 接受一份 JSON 测试计划和通过 `DSH_TEST_URL` 环境变量传入的已授权应用 URL。只连接现有 Harness GUI，不启动替代服务器。测试上下文与用户浏览器隔离，不读取浏览器 cookie、凭据文件或个人 profile；URL 不写入报告。

实测时应对比已有非空白 Session（active）与同工作区的空白 Session（hero），检查真实祖先的 `will-change`、面板矩形、Portal 父层及浏览器错误。不要在用户已有 Session 中提交测试消息或修改模型档位。临时 Host 测试启动插件须在测试结束后卸载。
