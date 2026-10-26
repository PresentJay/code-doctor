# Code Doctor

[English](../../README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

帮助你理解代理修改的代码，并用简短指令调整工作方向。Claude Code 和 Codex 会把全部更改按行为或需要判断的问题分组，再按重要程度和理解顺序说明。你可以在原有对话或 diff 中阅读，然后一次反馈多条意见。切换已准备好的代码块不需要再次调用模型。

这是早期预览版，无需新增模型服务或 API 密钥。安装 skill 或连接 MCP 并不代表宿主会提供专用面板、自动高亮或自动消息发送。[已验证的能力与限制](../validation.md)。

## 安装

需要 Node.js 22 或更新版本及 Git。软件包正式发布前，请从可信源码安装。能否访问仓库取决于当前可见性设置。

```sh
git clone https://github.com/PresentJay/code-doctor.git
cd code-doctor
npm ci --ignore-scripts --no-fund
CODE_DOCTOR_HOME="$PWD"
mkdir -p "$HOME/.agents/skills" "$HOME/.claude/skills"
ln -s "$CODE_DOCTOR_HOME/skills/code-doctor" "$HOME/.agents/skills/"
ln -s "$CODE_DOCTOR_HOME/skills/code-doctor" "$HOME/.claude/skills/"
```

在 macOS/Linux 上，一次链接到用户的 skill 目录后，即可在多个项目中复用同一 CLI。只使用一个宿主时，只创建对应的链接。同名条目不会被覆盖，请先检查现有安装。保留源码目录及依赖，不要只复制 skill 文件。Windows 或其他宿主的方式请参考[英文安装说明](../../README.md#install-from-source)。

skill 会确认实际工作仓库并显式传入`--repo`，通过本地 Git 排除文件保护私有审阅数据。无需在每个项目内创建 MCP 配置或 skill。若宿主没有显示该 skill，请重启宿主。创建链接不代表运行中的代理已经加载它。

需要项目级 MCP 连接时，按[可选配置说明](../../README.md#optional-project-mcp-connection)操作。生成的文件含有本机绝对路径，可能出现在 Git 更改清单中；不要把已跟踪或共享的配置整体隐藏。CLI 的`capture`仅创建原始更改清单，当前代理准备好`plan`后，才能读取带解释的 guide。

## 使用

> 用 Code Doctor 整理这次更改。我想阅读代码后，一次反馈多条意见。

代理会先确认原始请求、任务类型和相关需求，再一次准备整体说明、阅读顺序、实际代码与完整更改清单。若当前宿主确实提供原生界面，就使用该界面；否则会在一个回复中展示全部代码块。你可以汇总多条行级意见后发送，或直接指明代码块，要求一并修改。

只有明确要求时才会打开 Web 查看器。界面支持英语、韩语、日语和简体中文。切换语言不会改动代码、代理说明、意见原文或正在输入的草稿。代理说明的语言由对话决定；服务器诊断与协议字段保持英语。

摘录只是代码的一部分。其他文件或更改前代码等未展示的范围也应明确说明，并在需要时读取原文。已展示行数不代表审阅完成率。意见绑定到准确的代码版本；保存、复制或查看不代表授权执行、部署或合并。

[CLI 与 MCP](../../README.md#cli-and-mcp) · [参与贡献](../../CONTRIBUTING.md) · [安全](../../SECURITY.md)

项目采用[Apache-2.0](../../LICENSE)许可证。依赖项保留各自的许可证与声明。
