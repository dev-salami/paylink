export type PollResult = "ok" | "error" | "stop";

/** One request at a time, no background-tab work, exponential error cooldown. */
export function startVisibilityPolling(task: () => Promise<PollResult>, interval: number, maxInterval = 15_000, page: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document,
  wake: Pick<Window, "addEventListener" | "removeEventListener"> | undefined = typeof window === "undefined" ? undefined : window) {
  let stopped = false;
  let running = false;
  let delay = interval;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requested = false;
  const wakeEvents = ["focus", "pageshow", "online"] as const;
  function clear() { clearTimeout(timer); timer = undefined; }
  function stop() { stopped = true; clear(); page.removeEventListener("visibilitychange", visibility); for (const event of wakeEvents) wake?.removeEventListener(event, visibility); }
  async function tick() {
    clear();
    if (stopped || page.hidden || running) return;
    running = true;
    let result: PollResult;
    try { result = await task(); } catch { result = "error"; }
    running = false;
    if (stopped) return;
    if (result === "stop") { stop(); return; }
    if (requested && !page.hidden) { requested = false; void tick(); return; }
    requested = false;
    delay = result === "error" ? Math.min(maxInterval, delay * 2) : interval;
    if (!page.hidden) timer = setTimeout(() => void tick(), delay);
  }
  function visibility() {
    clear();
    if (!page.hidden && !stopped) {
      if (running) requested = true;
      else void tick();
    }
  }
  page.addEventListener("visibilitychange", visibility);
  for (const event of wakeEvents) wake?.addEventListener(event, visibility);
  void tick();
  return stop;
}
