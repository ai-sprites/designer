# designer

独立设计角色：完成用户流程、界面状态与清晰的设计交接。

这是可单独安装到业务项目的角色。它从当前请求、已有项目约定、代码和资料开始工作。没有其他角色、旧工作流安装记录或技术目录，也可以使用；待确定项只暂停真正依赖答案的部分。

## 安装

需要 Node.js 20 或更高版本。从源码运行，不需要安装运行依赖：

```bash
git clone https://github.com/ai-sprites/designer.git
cd designer
node bin/cli.js init ../my-project --tool codex
```

工具可选 `codex`、`claude`、`copilot`。省略目标目录表示当前目录；请确认它是要安装角色的项目。有终端且缺少必要工具选择时会简短询问，完整参数可直接用于脚本。

也可从 GitHub 的明确版本运行：

```bash
npx --yes --package=github:ai-sprites/designer#v0.1.0 sprite-designer init ./my-project --tool codex
```

本项目通过 GitHub 发布；上述命令不表示包已发布到 npm registry。

## 使用

安装后在目标项目打开对应 AI 工具，开始新会话，再明确指定角色：

> 请用 sprite-designer，沿用现有界面风格完成这次用户流程，覆盖实际会出现的状态，并说明需要验证的设计细节。

角色说明位于 [templates/agent.md](templates/agent.md)。实际宿主的发现机制和验证边界见 [工具适配说明](docs/tool-support.md)。在 Claude Code 可用 `claude --agent sprite-designer`；Copilot CLI 可用 `copilot --agent=sprite-designer`；Codex 的原生角色调用与当前安装版本有关；本轮未验证成功，可按工具适配说明显式读取角色指令。

需要保留或交接时再写文档，不因安装就创建业务产物。项目名称、简介和技术选择不作为安装必答项。

## 可选实践

本角色没有附带可选实践。角色本体可以独立使用。

## 生成内容与共存

| 工具 | 角色文件 | 已选实践 |
| --- | --- | --- |
| Codex | `.codex/agents/sprite-designer.toml` | `.agents/skills/<实践>/` |
| Claude | `.claude/agents/sprite-designer.md` | `.claude/skills/<实践>/` |
| Copilot | `.github/agents/sprite-designer.agent.md` | `.github/skills/<实践>/` |

仅生成所选工具的文件，以及 `.sprite/installations/designer.<工具>.json` 中本包的文件归属与版本。不会修改项目的 README、AGENTS.md、CLAUDE.md、应用配置或业务文档。多个角色可按任意顺序安装；重复安装未修改的组件保持原样。

## 更新与用户修改

先获取本包需要采用的新版本，再对目标项目运行更新：

```bash
node bin/cli.js update ../my-project
node bin/cli.js update ../my-project --role
node bin/cli.js preview ../my-project --role
```

普通 `update` 更新本包已安装组件；`--role` 只更新角色。存在唯一的本包工具记录时会复用，有多种工具记录时需明确 `--tool`。另一工具的安装不替换已有工具。

更新前检查所有选定目标。用户改过的文件会报告冲突并保持原样，`preview` 可查看新版生成内容。可以继续手动维护自定义文件；若需要恢复自动更新，先另存自己的规则，再从安装记录中该组件的 `version` 对应包版本恢复原始生成内容，最后运行新版 `update`。直接复制新版 `preview` 的内容仍可能与旧记录的校验值不符；不要手改记录来接管自定义文件。工具不会自动把人工合并的自定义内容登记为下次可覆盖的模板。

不要删除安装记录来绕过冲突。没有本包受支持的归属记录时，先备份自己的文件，再在干净目标安装并比较；旧 create-ai-native-sdlc 的安装记录不自动迁移。执行失败时仅恢复本次安全修改，其他角色与用户内容保持原样。


## 路径与中断恢复

安装目录及其父目录需要是真实目录；安装器拒绝符号链接和硬链接目标。若项目通过链接路径打开，先进入项目执行 `pwd -P`，再使用输出的真实绝对路径。macOS 临时目录请使用 `/private/tmp`，不要使用指向它的 `/tmp`。

普通命令失败会尝试恢复本次安全替换，仅删除本次创建且仍未改变的文件。进程被强制终止或断电后无法承诺自动恢复；若留下 `.json.lock` 或 `.sprite-backup-*`，先确认没有命令仍在运行，备份并比较内容，再清理明确的残留。用户同时修改导致不能安全恢复时，工具会报告保留位置。

## 共享产品资料

如果需求、设计或接口在共享 Git 资料仓库，可以另外安装 [artifact-bridge](https://github.com/ai-sprites/artifact-bridge)，按功能读取明确版本并比较变化。不安装桥接也可以直接使用当前请求和本地资料。角色源码仓库、业务产品资料仓库和业务代码仓库分别维护。

## 开发与验证

```bash
npm test
npm pack --dry-run
```

只用 Node.js 标准库。安装器、角色和实践都随本仓库发布，不依赖其他角色包。测试涵盖组件共存、版本更新和文件保护；宿主加载结果单独记录，不把格式检查说成实际使用成功。

本项目从 [create-ai-native-sdlc](https://github.com/davych/my-sdlc-workflow) 提取并收敛职责。使用 MIT 许可，保留 Davy Chen 的原有版权，详见 [LICENSE](LICENSE)。
