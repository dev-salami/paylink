export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startReconciler } = await import("./lib/aurora/service");
    startReconciler();
  }
}
