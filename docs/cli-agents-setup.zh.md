# CLI ACP Agents 配置说明

## 概要
- 已在 README.org 与 README.zh.org 中补充 ACP agent 配置方式、示例与完整 agent 清单。

## 配置位置
- 默认路径：=~/.mobvibe/.config.json=
- 可通过 =MOBVIBE_HOME= 修改 CLI 家目录

## 配置结构
- =agents=：对外暴露的 agent 列表。每项支持：
  - =id=（必填，唯一）
  - =command=（必填）
  - =label=（可选）
  - =args=（可选）
  - =env=（可选，传给子进程的环境变量）
- =defaultAgentId=：可选，默认 agent 的 id

## 默认规则
- 未配置或 =agents= 为空时，使用内置 =opencode= 后端（执行 =opencode acp=）。
- 配置了 =agents= 但未包含 =opencode= 时，内置 =opencode= 会被自动添加到列表最前。
- 若显式配置 =id: "opencode"=，则使用你的列表并覆盖内置默认。
- =defaultAgentId= 必须匹配已有的 agent id。

## 使用示例

### OpenCode

安装并确保 =opencode= 在 PATH，默认无需配置。如需自定义参数或环境变量，可显式添加：

#+begin_src json
{
  "agents": [
    {
      "id": "opencode",
      "label": "OpenCode",
      "command": "opencode",
      "args": ["acp"]
    }
  ],
  "defaultAgentId": "opencode"
}
#+end_src

### Claude Code（Zed 适配器）

安装 =@zed-industries/claude-code-acp=，并提供 =ANTHROPIC_API_KEY=：

#+begin_src json
{
  "agents": [
    {
      "id": "claude-code",
      "label": "Claude Code",
      "command": "claude-code-acp",
      "env": {
        "ANTHROPIC_API_KEY": "<your-key>"
      }
    }
  ],
  "defaultAgentId": "claude-code"
}
#+end_src

### Codex（Zed 适配器）

安装 =codex-acp= 并提供 =OPENAI_API_KEY=（或 =CODEX_API_KEY=）：

#+begin_src json
{
  "agents": [
    {
      "id": "codex",
      "label": "Codex",
      "command": "codex-acp",
      "env": {
        "OPENAI_API_KEY": "<your-key>"
      }
    }
  ],
  "defaultAgentId": "codex"
}
#+end_src

## 参考
- ACP 文档索引：https://agentclientprotocol.com/llms.txt
