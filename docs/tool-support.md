# 工具适配与实际验证

Sprite 只生成所选工具的项目文件。角色正文来自本包的一份 Markdown；可选 Skill 随自身参考一起复制，不修改宿主全局配置。安装后在目标项目开始新会话或刷新宿主发现。

## 官方发现路径

| 工具 | 项目角色 | 项目 Skill |
| --- | --- | --- |
| Codex | `.codex/agents/sprite-<角色>.toml` | `.agents/skills/<Skill>/SKILL.md` |
| Claude Code | `.claude/agents/sprite-<角色>.md` | `.claude/skills/<Skill>/SKILL.md` |
| GitHub Copilot | `.github/agents/sprite-<角色>.agent.md` | `.github/skills/<Skill>/SKILL.md` |

Codex 独立角色文件包含 `name`、`description`、`developer_instructions`；Claude 与 Copilot 使用 YAML frontmatter 和 Markdown 正文。依据：[Codex 子代理](https://developers.openai.com/codex/subagents/)、[Codex Skills](https://developers.openai.com/codex/skills/)、[Claude 子代理](https://code.claude.com/docs/en/sub-agents)、[Claude Skills](https://code.claude.com/docs/en/skills)、[Copilot 代理调用](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents)、[Copilot Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)。

## 本轮实际结果

验证日期：2026-09-05，macOS、Node.js 25.8.0。文件格式、宿主发现和模型实际运行分别验证，不能相互替代。

| 检查 | 结果 |
| --- | --- |
| 三工具的八个角色输出 | 安装、正文一致性与 TOML/YAML 解析验证 |
| 三工具的全部实践与桥接文件 | 完整复制、入口及本地引用验证 |
| Codex CLI 0.144.1 的 Skill 发现 | `skills/list` 实际发现 architect 两项实践，项目范围、启用状态正常，无发现错误 |
| Codex 原生自定义子角色运行 | 本轮未成功；指定独立角色时返回不可用，不能记为原生调用通过 |
| Codex 显式读取角色指令 | 已读取安装后的 PM / BA 指令，实际输出收藏切换的两条可观察验收；属于主代理使用指令 |
| Claude Code 2.1.206 的角色发现 | 启动事件实际列出 `sprite-pm-ba`；模型调用因未登录失败，未验证角色任务完成 |
| Copilot CLI 0.0.421 | ACP 能初始化；指定角色的任务运行超时，未验证实际角色加载与任务完成 |
| Claude / Copilot 的 Skill 发现 | 路径和文件格式已验证，未验证宿主实际发现 |

没有修改用户全局配置、自动登录或更换宿主版本。官方文档可能领先于本机 CLI；本机 Codex 0.144.1 不接受文档中的 `agents.enabled` 配置形式，不要为本包直接加入该设置。项目是否受信任也影响配置层加载；本轮临时项目层被禁用，命令级信任覆盖没有解除，未据此推断所有环境的支持情况。Windows、Linux、IDE 内的代理调用尚未实际验收。

## 如何使用已安装内容

Claude Code 可在目标项目使用 `claude --agent sprite-designer`；Copilot CLI 可使用 `copilot --agent=sprite-designer`。需要宿主已经登录并允许项目使用；本轮验证限制见上表。

Codex 支持对应原生角色能力时，可以指明 `sprite-designer`。若当前版本未发现，可显式请求：

> 请读取 `.codex/agents/sprite-designer.toml` 的 `developer_instructions`，在当前任务中按该角色工作，沿用项目现有约定。

这个方式由主代理采用角色指令，不宣称创建了独立子代理。

Skill 可以在任务中明确请求使用名称；若宿主没有自动发现，可明确给出安装后的 `SKILL.md` 路径，按需读取同目录参考。角色缺少某项可选实践，不妨碍处理依据充分的工作。

桥接 Skill 自带 `scripts/read.mjs`，即使宿主发现受限，也能按 README 的 Node.js 命令直接运行；这只验证脚本使用，不代表宿主已加载 Skill。
