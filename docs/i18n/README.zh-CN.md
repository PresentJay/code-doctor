# Code Doctor

[English](../../README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

帮助你理解代理修改的代码，并用简短指令调整工作方向。Claude Code 和 Codex 会把全部更改按行为或需要判断的问题分组，再按重要程度和理解顺序说明。你可以在原有对话或 diff 中阅读，然后一次反馈多条意见。切换已准备好的代码块不需要再次调用模型。

这是早期预览版，无需新增模型服务或 API 密钥。安装 skill 或连接 MCP 并不代表宿主会提供专用面板、自动高亮或自动消息发送。[已验证的能力与限制](../validation.md)。

## 安装

需要 Node.js 22 或更新版本及 Git。在 macOS/Linux 上安装一次即可。

```sh
git clone https://github.com/PresentJay/code-doctor.git
cd code-doctor
npm ci --ignore-scripts --no-fund
node bin/code-doctor.mjs install --host both
```

安装程序会保留已有设置，注册用户级 hook 和 skill。只使用一个代理时，指定 `--host codex` 或 `--host claude`。请保留源码目录和依赖。已被手动修改的安装内容不会被覆盖。

请开启新会话。Codex 首次需要在 `/hooks` 中确认并信任该 hook。激活后，正常提出开发需求即可在 Git 仓库中获得自动说明，无需每次点名 Code Doctor，也无需逐个仓库安装。Conductor 等工具仅在加载代理用户级 hook 时自动生效。暂不支持 Windows 自动安装。

可以说“在这个仓库关闭 Code Doctor”“在这个会话关闭”或“全部关闭”，也可以在相同范围重新开启。“这次任务跳过”只影响当前任务。直接控制使用 `node bin/code-doctor.mjs disable --repo PATH` 或 `enable --repo PATH`。全局使用 `--scope global`，查询状态使用 `status --repo PATH`。更大范围的关闭设置优先，偏好保存在用户目录中。

需要项目级 MCP 连接时，按[可选配置说明](../../README.md#optional-project-mcp-connection)操作。生成的文件含有本机绝对路径，可能出现在 Git 更改清单中；不要把已跟踪或共享的配置整体隐藏。CLI 的`capture`仅创建原始更改清单，当前代理准备好`plan`后，才能读取带解释的 guide。

## 使用

照常提出开发需求，例如：“修复购物车为空时的总价计算。”工作中会说明重要的范围变化，完成后一次展示解释和实际代码。

代理会先确认原始请求、任务类型和相关需求，再一次准备整体说明、阅读顺序、实际代码与完整更改清单。若当前宿主确实提供原生界面，就使用该界面；否则会在一个回复中展示全部代码块。你可以汇总多条行级意见后发送，或直接指明代码块，要求一并修改。

只有明确要求时才会打开 Web 查看器。界面支持英语、韩语、日语和简体中文。切换语言不会改动代码、代理说明、意见原文或正在输入的草稿。代理说明的语言由对话决定；服务器诊断与协议字段保持英语。

摘录只是代码的一部分。其他文件或更改前代码等未展示的范围也应明确说明，并在需要时读取原文。已展示行数不代表审阅完成率。意见绑定到准确的代码版本；保存、复制或查看不代表授权执行、部署或合并。

[CLI 与 MCP](../../README.md#cli-and-mcp) · [参与贡献](../../CONTRIBUTING.md) · [安全](../../SECURITY.md)

项目采用[Apache-2.0](../../LICENSE)许可证。依赖项保留各自的许可证与声明。
