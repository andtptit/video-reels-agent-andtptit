/**
 * Generic tool-use agent loop, provider-agnostic in shape (any chat-completion
 * function that speaks the OpenAI tool_calls format works — currently only
 * DashScope is wired in providers/llm/).
 *
 * Loop: call model → if it returned tool_calls, run each via `tools.executors`
 * (sandboxed per-task, e.g. fs-tools.mjs scoped to one project dir) → feed the
 * results back as role:"tool" messages → repeat until the model stops calling
 * tools or `maxTurns` is hit.
 */
import { chatCompletion } from "../providers/llm/dashscope.mjs";

export async function runAgent({
  systemPrompt,
  userPrompt,
  tools,
  model = "qwen-plus",
  maxTurns = 12,
  onEvent = () => {},
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const transcript = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await chatCompletion({ model, messages, tools: tools.definitions });
    const message = response.choices[0].message;
    messages.push(message);
    transcript.push({ turn, role: "assistant", content: message.content, tool_calls: message.tool_calls });
    onEvent({ type: "assistant", turn, message });

    if (!message.tool_calls?.length) {
      return { finalMessage: message.content, transcript, turns: turn + 1 };
    }

    for (const call of message.tool_calls) {
      const fn = tools.executors[call.function.name];
      let result;
      if (!fn) {
        result = { ok: false, error: `Unknown tool: ${call.function.name}` };
      } else {
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          result = await fn(args);
        } catch (err) {
          result = { ok: false, error: err.message };
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      transcript.push({ turn, role: "tool", name: call.function.name, args: call.function.arguments, result });
      onEvent({ type: "tool", turn, name: call.function.name, result });
    }
  }

  throw new Error(`Agent exceeded maxTurns (${maxTurns}) without finishing`);
}
