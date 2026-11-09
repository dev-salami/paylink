"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-24">
      <p className="text-xs uppercase tracking-[0.16em] text-danger">Page unavailable</p>
      <h1 className="display text-5xl">We couldn’t load this page.</h1>
      <p className="mt-3 text-muted">Please try again. If you’ve already sent a payment, check its status before sending more funds.</p>
      <button type="button" className="btn btn-primary mt-6" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
