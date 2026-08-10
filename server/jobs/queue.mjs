/**
 * In-process concurrency limiter, one instance per upstream provider. Scene-writer
 * agents run one-per-scene in parallel (see CLAUDE.md step 5), so without a cap the
 * API would fire N simultaneous DashScope/TTS calls per project — this bounds that
 * regardless of how many HTTP requests land at once.
 */
export class ConcurrencyQueue {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
  }

  run(fn) {
    return new Promise((resolveRun, rejectRun) => {
      const task = async () => {
        this.active++;
        try {
          resolveRun(await fn());
        } catch (err) {
          rejectRun(err);
        } finally {
          this.active--;
          this._dequeue();
        }
      };
      if (this.active < this.limit) task();
      else this.waiting.push(task);
    });
  }

  _dequeue() {
    if (this.waiting.length && this.active < this.limit) this.waiting.shift()();
  }
}

export const queues = {
  dashscope: new ConcurrencyQueue(Number(process.env.DASHSCOPE_CONCURRENCY) || 2),
  tts: new ConcurrencyQueue(Number(process.env.TTS_CONCURRENCY) || 3),
  // ffmpeg clip cutting for the "footage" template — CPU-bound local work, no
  // external API involved, but "Generate tất cả" firing every scene at once would
  // otherwise spawn unbounded parallel ffmpeg processes.
  ffmpeg: new ConcurrencyQueue(Number(process.env.FFMPEG_CONCURRENCY) || 2),
  // "Tạo từ audio có sẵn" (audio-import.mjs) — local Whisper inference is materially
  // heavier/longer than the footage template's short ffmpeg cuts (see hyperframes-cli
  // transcribe()'s own 5min default timeout), so it gets a separate, more conservative
  // queue instead of sharing `ffmpeg` and making unrelated footage-cut requests wait
  // behind it.
  audioImport: new ConcurrencyQueue(Number(process.env.AUDIO_IMPORT_CONCURRENCY) || 1),
};
