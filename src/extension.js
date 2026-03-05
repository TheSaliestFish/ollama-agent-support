const vscode = require('vscode');
const { execFile } = require('node:child_process');

const output = vscode.window.createOutputChannel('Ollama Agent Support');

function log(message) {
  output.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function normalizeBaseUrl(raw) {
  const value = String(raw || 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
  return value.replace(/\/(api|v1)$/i, '');
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('ollamaAgentSupport');
  return {
    baseUrl: normalizeBaseUrl(cfg.get('baseUrl', 'http://127.0.0.1:11434')),
    modelAllowlist: cfg.get('modelAllowlist', []),
    requestTimeoutMs: Number(cfg.get('requestTimeoutMs', 120000))
  };
}

function execFileAsync(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function listOllamaModels(timeoutMs) {
  const out = await execFileAsync('ollama', ['list'], timeoutMs);
  const lines = out.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  const models = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const firstSpace = line.indexOf(' ');
    if (firstSpace > 0) {
      models.push(line.slice(0, firstSpace).trim());
    }
  }
  return Array.from(new Set(models));
}

function mapToolsToOllama(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} }
    }
  }));
}

function toOllamaMessages(messages) {
  const mapped = [];
  for (const msg of messages) {
    const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
    const textChunks = [];
    const toolCalls = [];

    for (const part of msg.content || []) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textChunks.push(part.value);
        continue;
      }
      if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input || {})
          }
        });
        continue;
      }
      if (part instanceof vscode.LanguageModelToolResultPart) {
        let raw = '';
        try {
          raw = JSON.stringify(part.content);
        } catch {
          raw = String(part.content);
        }
        textChunks.push(`[tool_result:${part.callId}] ${raw}`);
        continue;
      }
      if (part instanceof vscode.LanguageModelDataPart) {
        textChunks.push(`[data:${part.mimeType}]`);
        continue;
      }
      if (part && typeof part === 'object' && 'value' in part && typeof part.value === 'string') {
        textChunks.push(part.value);
      }
    }

    const item = {
      role,
      content: textChunks.join('\n').trim()
    };
    if (toolCalls.length > 0) {
      item.tool_calls = toolCalls;
    }
    mapped.push(item);
  }
  return mapped;
}

async function ollamaChat({ baseUrl, model, messages, tools, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const attempts = [
      {
        url: `${baseUrl}/api/chat`,
        body: {
          model,
          messages,
          tools,
          stream: false
        },
        parse: data => data
      },
      {
        url: `${baseUrl}/v1/chat/completions`,
        body: {
          model,
          messages,
          tools,
          stream: false
        },
        parse: data => ({
          message: {
            role: 'assistant',
            content: data?.choices?.[0]?.message?.content || '',
            tool_calls: data?.choices?.[0]?.message?.tool_calls || []
          }
        })
      }
    ];

    let lastError = '';
    for (const attempt of attempts) {
      log(`POST ${attempt.url} model=${model}`);
      const resp = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(attempt.body),
        signal: controller.signal
      });

      if (!resp.ok) {
        const txt = await resp.text();
        lastError = `${resp.status} ${txt}`;
        log(`Failed ${attempt.url}: ${lastError}`);
        if (resp.status === 404) {
          continue;
        }
        throw new Error(`Ollama API error ${resp.status}: ${txt}`);
      }

      const json = await resp.json();
      return attempt.parse(json);
    }

    throw new Error(`All endpoints failed. Last error: ${lastError}`);
  } finally {
    clearTimeout(timer);
  }
}

class OllamaProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeLanguageModelChatInformation = this._onDidChange.event;
  }

  async refresh() {
    this._onDidChange.fire();
  }

  async provideLanguageModelChatInformation() {
    const { modelAllowlist, requestTimeoutMs } = getConfig();
    let models = [];
    try {
      models = await listOllamaModels(requestTimeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(`Ollama Agent Support: 无法读取模型列表: ${message}`);
      return [];
    }

    if (Array.isArray(modelAllowlist) && modelAllowlist.length > 0) {
      const allow = new Set(modelAllowlist.map(v => String(v).trim()).filter(Boolean));
      models = models.filter(m => allow.has(m));
    }

    return models.map(name => ({
      id: name,
      name: `[Ollama] ${name}`,
      family: 'support',
      version: 'local',
      maxInputTokens: 128000,
      maxOutputTokens: 8192,
      detail: 'Ollama local model (Ollama Agent Support)',
      tooltip: 'Registered by Support (local)',
      capabilities: {
        toolCalling: true,
        imageInput: false
      }
    }));
  }

  async provideTokenCount(_model, text) {
    const str = typeof text === 'string' ? text : JSON.stringify(text);
    return Math.ceil(str.length / 4);
  }

  async provideLanguageModelChatResponse(model, messages, options, progress, _token) {
    const { baseUrl, requestTimeoutMs } = getConfig();
    log(`Request start. model=${model.id}, baseUrl=${baseUrl}`);

    const ollamaMessages = toOllamaMessages(messages);
    const ollamaTools = mapToolsToOllama(options?.tools);

    const result = await ollamaChat({
      baseUrl,
      model: model.id,
      messages: ollamaMessages,
      tools: ollamaTools,
      timeoutMs: requestTimeoutMs
    });

    const message = result?.message || {};
    const content = typeof message.content === 'string' ? message.content : '';
    log(`Response received. contentChars=${content.length}, toolCalls=${Array.isArray(message.tool_calls) ? message.tool_calls.length : 0}`);

    if (content) {
      progress.report(new vscode.LanguageModelTextPart(content));
    }

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const c of calls) {
      const callId = c?.id || `call_${Math.random().toString(36).slice(2)}`;
      const name = c?.function?.name;
      if (!name) {
        continue;
      }
      let input = {};
      const args = c?.function?.arguments;
      if (typeof args === 'string' && args.trim()) {
        try {
          input = JSON.parse(args);
        } catch {
          input = { _raw: args };
        }
      } else if (args && typeof args === 'object') {
        input = args;
      }

      progress.report(new vscode.LanguageModelToolCallPart(callId, name, input));
    }
  }
}

let providerDisposable;
let refreshDisposable;
let selfTestDisposable;

function activate(context) {
  const provider = new OllamaProvider();

  providerDisposable = vscode.lm.registerLanguageModelChatProvider('support', provider);
  context.subscriptions.push(providerDisposable);

  const refreshCmd = vscode.commands.registerCommand('ollamaAgentSupport.refreshModels', async () => {
    await provider.refresh();
    vscode.window.showInformationMessage('Ollama Agent Support: 模型列表已刷新');
  });

  refreshDisposable = refreshCmd;
  context.subscriptions.push(refreshDisposable);

  const selfTestCmd = vscode.commands.registerCommand('ollamaAgentSupport.selfTest', async () => {
    try {
      const { requestTimeoutMs } = getConfig();
      const models = await listOllamaModels(requestTimeoutMs);
      const model = models[0];
      if (!model) {
        vscode.window.showWarningMessage('Ollama Agent Support: 未发现任何本地模型');
        return;
      }

      const result = await ollamaChat({
        ...getConfig(),
        model,
        messages: [{ role: 'user', content: 'ping' }],
        tools: [{ type: 'function', function: { name: 'echo_tool', description: 'echo', parameters: { type: 'object', properties: { text: { type: 'string' } } } } }],
        timeoutMs: requestTimeoutMs
      });

      const content = result?.message?.content || '';
      const toolCalls = Array.isArray(result?.message?.tool_calls) ? result.message.tool_calls.length : 0;
      log(`Self test ok. model=${model}, contentChars=${content.length}, toolCalls=${toolCalls}`);
      output.show(true);
      vscode.window.showInformationMessage(`Ollama Agent Support 自检通过: model=${model}, toolCalls=${toolCalls}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Self test failed: ${message}`);
      output.show(true);
      vscode.window.showErrorMessage(`Ollama Agent Support 自检失败: ${message}`);
    }
  });
  selfTestDisposable = selfTestCmd;
  context.subscriptions.push(selfTestDisposable);

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('ollamaAgentSupport')) {
      provider.refresh();
    }
  }));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
