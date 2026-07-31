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

// Overridable via .env (DASHSCOPE_MODEL) so switching models for a test doesn't
// require editing code — content-planner/video-planner default to this (each runs
// once per video and drives the whole narrative/plan, worth paying for quality).
export const DEFAULT_MODEL = process.env.DASHSCOPE_MODEL || "qwen-plus";

// scene-writer/root-composer default to this instead — they run once per SCENE (so
// N times per video) and the job is mostly "follow the skill + worked example
// exactly", not open-ended reasoning; confirmed live that qwen-turbo works for plain
// chat + tool-calling. Separate knob from DEFAULT_MODEL so the two can be tuned
// independently (e.g. bump CHEAP_MODEL back to qwen-plus if turbo's output quality
// turns out too inconsistent, without touching planning-step cost).
export const CHEAP_MODEL = process.env.DASHSCOPE_MODEL_CHEAP || "qwen-turbo";

/**
 * @param {object[]} [params.priorMessages] - continue an existing conversation
 *   (e.g. a previous lint-fix attempt on the same file) instead of starting a new
 *   one. When set, `systemPrompt` is ignored (it's already the first message in
 *   `priorMessages`) and `userPrompt` is appended as the next turn — this is what
 *   lets scene-writer.mjs/root-composer.mjs's fix-retry loop send only the new lint
 *   findings on retries instead of re-sending the full skill + original task data
 *   every attempt. Confirmed live this was real waste: resending the ~7.6k-token
 *   hyperframes skill on every retry, when the model already had it in context from
 *   attempt 0.
 */
export async function runAgent({
  systemPrompt,
  userPrompt,
  tools,
  model = DEFAULT_MODEL,
  maxTurns = 12,
  onEvent = () => {},
  priorMessages = null,
}) {
  const messages = priorMessages
    ? [...priorMessages, { role: "user", content: userPrompt }]
    : [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
  const transcript = [];
  // DashScope's OpenAI-compatible response carries `usage: {prompt_tokens,
  // completion_tokens, total_tokens}` on every call (confirmed live) — summed across
  // every turn of this run so callers can report real cost per agent task instead of
  // guessing from prompt size.
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await chatCompletion({ model, messages, tools: tools.definitions });
    if (response.usage) {
      usage.promptTokens += response.usage.prompt_tokens ?? 0;
      usage.completionTokens += response.usage.completion_tokens ?? 0;
      usage.totalTokens += response.usage.total_tokens ?? 0;
    }
    const message = response.choices[0].message;
    messages.push(message);
    transcript.push({ turn, role: "assistant", content: message.content, tool_calls: message.tool_calls });
    onEvent({ type: "assistant", turn, message });

    if (!message.tool_calls?.length) {
      return { finalMessage: message.content, transcript, turns: turn + 1, messages, usage };
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

  const err = new Error(`Agent exceeded maxTurns (${maxTurns}) without finishing`);
  err.usage = usage; // still report what was actually spent before hitting the cap
  throw err;
}
