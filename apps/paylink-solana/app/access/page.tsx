import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, accessGateEnabled, safeNext, sessionSecret } from "@/lib/access";
import { merchantAccessState } from "@/lib/access-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log in — PayLink" };

const errors: Record<string, string> = {
  wrong: "That code didn’t match. Try again.",
  locked: "Too many tries. Wait ten minutes and try again.",
};

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const jar = await cookies();
  const state = await merchantAccessState({ token: jar.get(ACCESS_COOKIE)?.value, secret: sessionSecret(), enabled: accessGateEnabled(), next });
  if (state.redirectTo) redirect(state.redirectTo);
  const error = params.error ? errors[params.error] : undefined;

  return (
    <div className="min-h-screen bg-bg p-3 sm:p-5">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-6xl gap-3 sm:min-h-[calc(100vh-2.5rem)] lg:grid-cols-[1.05fr_0.95fr]">
        {/* dark art panel */}
        <section className="card-dark relative hidden overflow-hidden p-8 lg:flex lg:flex-col lg:justify-between">
          <Link href="/" className="flex items-center gap-2 text-lg">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4f5f7] text-sm font-bold text-[#181C25]">P</span>
            <span className="bold">PayLink</span>
          </Link>
          <img src="/art/armillary-dark.webp" alt="" aria-hidden className="mix-blend-lighten [mask-image:radial-gradient(closest-side,#000_70%,transparent)] floaty-slow mx-auto w-full max-w-[420px]" />
          <div>
            <span className="eyebrow text-[#9a9ea8]">Your workspace</span>
            <p className="mt-4 text-[clamp(2rem,3.4vw,3rem)] leading-[0.98]">
              The books, the agent, <span className="bold">and the wallet.</span>
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs text-[#9a9ea8]">
              <span className="rounded-full border border-[#313744] px-3 py-1.5">Solana Pay</span>
              <span className="rounded-full border border-[#313744] px-3 py-1.5">USDC payments</span>
              <span className="rounded-full border border-[#313744] px-3 py-1.5">Spending controls</span>
            </div>
          </div>
        </section>

        {/* form panel */}
        <section className="paper flex flex-col p-6 sm:p-10">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-lg lg:invisible">
              <span className="k-logo h-9 w-9 text-sm">P</span>
              <span className="bold">PayLink</span>
            </Link>
            <Link href="/" className="t-small text-muted hover:text-ink">← Back to site</Link>
          </div>

          <div className="mx-auto my-auto w-full max-w-sm py-12">
            <span className="eyebrow">Private beta</span>
            <h1 className="mt-4 text-[clamp(2.4rem,6vw,3.4rem)] leading-[0.95]">
              Enter your <span className="bold">access code</span>
            </h1>
            <p className="mt-4 text-muted">
              Use your access code to manage invoices and payments. Clients can open their payment links and receipts without a code.
            </p>

            <form method="post" action="/api/access" className="mt-8 grid gap-3">
              <input type="hidden" name="next" value={next} />
              <label className="t-micro text-muted" htmlFor="code">Access code</label>
              <input
                id="code"
                name="code"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="••••••"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "code-error" : undefined}
                className={`field text-lg tracking-[0.2em] ${error ? "border-[var(--danger)]" : ""}`}
              />
              {error ? (
                <p id="code-error" role="alert" className="t-small text-danger">{error}</p>
              ) : null}
              <button type="submit" className="btn btn-primary mt-2 w-full">
                Continue ↗
              </button>
            </form>

            <div className="mt-8 flex items-center gap-3 rounded-2xl bg-elev p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#71FC8F] text-[#0b1a10]" aria-hidden>✓</span>
              <p className="t-small text-muted">
                Paying an invoice? Open the link you were sent. No code needed.
              </p>
            </div>
          </div>

          <p className="t-micro text-center text-muted">You stay signed in on this device for 30 days.</p>
        </section>
      </div>
    </div>
  );
}
