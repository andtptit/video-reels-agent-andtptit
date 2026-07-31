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
};
