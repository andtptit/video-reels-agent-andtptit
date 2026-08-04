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
import { chatCompletion, isQuotaOrRateLimitError } from "../providers/llm/dashscope.mjs";
import { nextFallbackModel } from "../lib/models.mjs";
import { CancelledError } from "../jobs/cancel-registry.mjs";

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
/**
 * @param {number} [params.stopAfterWrites] - end the run as soon as this many
 *   `write_file` calls have succeeded, instead of waiting for the model to also
 *   emit a final no-tool-call turn. For one-shot "write exactly N files" tasks
 *   (scene-writer/root-composer: 1 file) the model sometimes keeps calling
 *   write_file again and again after the task is already done instead of stopping
 *   — confirmed live on a real project: a scene was already lint-clean after its
 *   FIRST write, but the model called write_file 6 turns in a row and the run hit
 *   maxTurns and threw before ever producing a final message, burning 184k tokens
 *   on a task that needed maybe a tenth of that. Don't set this for tasks that
 *   legitimately need multiple different files (content-planner writes 2) unless
 *   you pass the true count.
 */
export async function runAgent({
  systemPrompt,
  userPrompt,
  tools,
  model = DEFAULT_MODEL,
  maxTurns = 12,
  onEvent = () => {},
  priorMessages = null,
  stopAfterWrites = null,
  timeoutMs,
  signal,
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
  // guessing from prompt size. `apiCalls` is our own count of chatCompletion
  // round-trips (not from the API) — added alongside the stopAfterWrites fix so a
  // runaway loop like the one above is visible in the UI as "N calls" instead of
  // only showing up after the fact as a surprising token total.
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };
  let successfulWrites = 0;
  let malformedRetries = 0;
  // Persists across turns once a fallback succeeds — a multi-turn conversation keeps
  // using whichever model actually worked instead of retrying the exhausted one
  // every single turn. Fallback chain is anchored to the ORIGINAL `model` (its tier),
  // not `currentModel`, so `triedModels` accumulates correctly across turns.
  let currentModel = model;
  const triedModels = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    let response;
    for (;;) {
      try {
        response = await chatCompletion({ model: currentModel, messages, tools: tools.definitions, signal, ...(timeoutMs ? { timeoutMs } : {}) });
        break;
      } catch (err) {
        if (err instanceof CancelledError) {
          err.usage = usage;
          throw err;
        }
        if (!isQuotaOrRateLimitError(err)) throw err;
        if (!triedModels.includes(currentModel)) triedModels.push(currentModel);
        const fallback = nextFallbackModel(model, triedModels);
        if (!fallback) throw err;
        onEvent({ type: "model-fallback", from: currentModel, to: fallback, reason: err.message });
        currentModel = fallback;
      }
    }
    usage.apiCalls += 1;
    if (response.usage) {
      usage.promptTokens += response.usage.prompt_tokens ?? 0;
      usage.completionTokens += response.usage.completion_tokens ?? 0;
      usage.totalTokens += response.usage.total_tokens ?? 0;
    }
    const message = response.choices[0].message;
    // Reasoning models (qwen3.x-*) return `reasoning_content` — their own hidden
    // scratchpad for that turn. Keep it in the emitted event (useful for
    // debugging/job-status logs) but never persist it into `messages`: resending a
    // model's own past reasoning as if it were context to react to isn't needed for
    // continuity (only role/content/tool_calls are) and compounds every later
    // turn/attempt — measured live on a 4.85s scene: ~6.7k reasoning tokens
    // generated, then echoed back repeatedly, was the dominant chunk of a 75k
    // prompt-token bill for one scene.
    const { reasoning_content, ...persistedMessage } = message;
    messages.push(persistedMessage);
    transcript.push({ turn, role: "assistant", content: message.content, tool_calls: message.tool_calls });
    onEvent({ type: "assistant", turn, message });

    if (!message.tool_calls?.length) {
      return { finalMessage: message.content, transcript, turns: turn + 1, messages, usage, finalModel: currentModel };
    }

    // Confirmed live: DashScope occasionally returns a tool_call whose
    // `function.arguments` is itself malformed JSON (e.g. trailing garbage past a
    // valid-looking prefix — a long-generation glitch, seen on a real project's
    // scenes.json write). Reporting that back as a normal `{ok:false}` tool result
    // (the old behavior) works for most providers, but here it's a dead end: the
    // malformed string stays embedded in `messages` as the assistant's own
    // `tool_calls[].function.arguments`, and DashScope's OWN server-side validation
    // then rejects the ENTIRE next request with a 400 ("function.arguments...must
    // be in JSON format") — the conversation can never recover because the poison
    // message gets resent every turn from then on. Instead: drop the poisoned
    // assistant message from history entirely and nudge a clean retry.
    const malformedCall = message.tool_calls.find((call) => {
      try {
        JSON.parse(call.function.arguments || "{}");
        return false;
      } catch {
        return true;
      }
    });
    if (malformedCall) {
      malformedRetries += 1;
      if (malformedRetries > 2) {
        const err = new Error(
          `Model liên tục trả về tool_call với JSON không hợp lệ (function.arguments) sau ${malformedRetries} lần thử — không tự phục hồi được.`
        );
        err.usage = usage;
        throw err;
      }
      messages.pop(); // drop the just-pushed poisoned assistant message
      messages.push({
        role: "user",
        content:
          "Lượt gọi tool vừa rồi có JSON không hợp lệ trong function.arguments (lỗi parse). Gọi lại ĐÚNG 1 tool call, đảm bảo arguments là JSON hợp lệ, không dư ký tự nào sau dấu đóng cuối cùng.",
      });
      onEvent({ type: "malformed-tool-call", turn, model: currentModel });
      continue;
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
      if (call.function.name === "write_file" && result.ok) successfulWrites += 1;
    }

    if (stopAfterWrites && successfulWrites >= stopAfterWrites) {
      return {
        finalMessage: message.content || `(dừng sớm sau ${stopAfterWrites} write_file thành công)`,
        transcript,
        turns: turn + 1,
        messages,
        usage,
        stoppedEarly: true,
        finalModel: currentModel,
      };
    }
  }

  const err = new Error(`Agent exceeded maxTurns (${maxTurns}) without finishing`);
  err.usage = usage; // still report what was actually spent before hitting the cap
  throw err;
}
