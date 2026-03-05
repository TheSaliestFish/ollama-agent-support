# Ollama Agent Support

把本地 `ollama list` 里的模型注册到 VS Code 语言模型下拉，并声明支持工具调用（Agent 模式能力）。

Register models from local `ollama list` into the VS Code language model picker, with tool-calling capability declared for Agent scenarios.

## 功能

- 启动时读取 `ollama list`
- 动态注册所有模型到语言模型下拉（Vendor: `support`）
- 模型能力声明 `toolCalling: true`
- 透传工具定义到 Ollama `/api/chat`
- 当 Ollama 返回 tool calls 时，向 VS Code 发出 `LanguageModelToolCallPart`

## Features

- Reads `ollama list` on activation
- Dynamically registers all models in the language model picker (Vendor: `support`)
- Declares model capability `toolCalling: true`
- Forwards tool definitions to Ollama `/api/chat`
- Emits `LanguageModelToolCallPart` to VS Code when Ollama returns tool calls

## 调试

1. 在此目录运行 `code .`
2. 按 `F5` 启动 Extension Development Host
3. 在新窗口打开聊天模型下拉，确认出现 `Ollama` 下模型
4. 切换到支持 tools 的模型并在 Agent 场景验证

## Debug

1. Run `code .` in this directory
2. Press `F5` to launch Extension Development Host
3. In the new window, open the chat model picker and confirm Ollama models appear
4. Switch to a tools-capable model and verify in Agent scenarios

## 设置

- `ollamaAgentSupport.baseUrl`：默认 `http://127.0.0.1:11434`
- `ollamaAgentSupport.modelAllowlist`：可选白名单
- `ollamaAgentSupport.requestTimeoutMs`：请求超时

## Settings

- `ollamaAgentSupport.baseUrl`: default `http://127.0.0.1:11434`
- `ollamaAgentSupport.modelAllowlist`: optional allowlist
- `ollamaAgentSupport.requestTimeoutMs`: request timeout
