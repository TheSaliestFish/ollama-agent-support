# Ollama Agent Support

把本地 `ollama list` 里的模型注册到 VS Code 语言模型下拉，并声明支持工具调用（Agent 模式能力）。

## 功能

- 启动时读取 `ollama list`
- 动态注册所有模型到语言模型下拉（Vendor: `support`）
- 模型能力声明 `toolCalling: true`
- 透传工具定义到 Ollama `/api/chat`
- 当 Ollama 返回 tool calls 时，向 VS Code 发出 `LanguageModelToolCallPart`

## 调试

1. 在此目录运行 `code .`
2. 按 `F5` 启动 Extension Development Host
3. 在新窗口打开聊天模型下拉，确认出现 `Ollama` 下模型
4. 切换到支持 tools 的模型并在 Agent 场景验证

## 设置

- `ollamaAgentSupport.baseUrl`：默认 `http://127.0.0.1:11434`
- `ollamaAgentSupport.modelAllowlist`：可选白名单
- `ollamaAgentSupport.requestTimeoutMs`：请求超时
