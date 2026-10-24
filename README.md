<div align="center">

![dsh-thinking-effort-rheostat](https://socialify.git.ci/drowsylazy/dsh-thinking-effort-rheostat/image?description=1&font=Inter&language=1&name=1&pattern=Plus&theme=Auto)

**DeepSeek Harness 的思考强度滑块**<br>
模仿 Claude Desktop 的推理强度控件，为每一个模型调出它的全部档位。

[![License](https://img.shields.io/badge/license-MIT-2563eb)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-296%20passing-0ea5e9)](#安装)

**[安装](#安装)** &nbsp;·&nbsp; **[使用](#使用)**

</div>

---

## 特性

- 🎚️ **档位来自模型本身** —— 刻度、档位名、默认档都读模型申报，换模型自动适配
- ⚡ **没有档位？一键启用** —— 按 [models.dev](https://models.dev) 推荐组合写入配置，可自定义 7 档（Off → Max）与发送值，随时撤销
- 🌀 **弹簧动效** —— 钥匙弹到目标档、最高档格子从右向左点亮、撤销时弹回原位；拖拽零延迟跟手
- 🌗 **跟随主题** —— 只用 DSH 主题变量，明暗双主题过对比度检查

## 安装

**从 GitHub 安装：**

```powershell
dsh plugin --profile demo add github:drowsylazy/dsh-thinking-effort-rheostat
```

把 `demo` 换成实际 profile 名。本插件无构建脚本，不需要构建授权；建议锁定 commit（`github:drowsylazy/dsh-thinking-effort-rheostat#<sha>`）。

**本地源码安装：**

```powershell
git clone https://github.com/drowsylazy/dsh-thinking-effort-rheostat.git
dsh plugin --profile demo add link:.\dsh-thinking-effort-rheostat
```

`link:` 是软链安装，源码改动即时生效（装好后不要移动目录）。桌面端也可以在会话里让 Agent 用内置 plugin_manager 装，效果相同。

**卸载：** `dsh plugin --profile <profile> remove @local/dsh-thinking-effort-rheostat`

## 使用

| 操作 | 效果 |
| :-- | :-- |
| 拖动 / 点击刻度 / 点击轨道 | 换档——越高越慢，推理越多，复杂任务上通常更准 |
| ← →（或 ↑ ↓）/ Home End | 键盘逐档 / 直达两端 |
| 底部「一键启用 · 自定义…」 | 给没有档位的模型开档 |
| 底部「撤销启用」 | 还原，钥匙弹回初始位 |

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。
