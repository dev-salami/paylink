import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24">
      <p className="text-xs uppercase tracking-[0.16em] text-muted">404</p>
      <h1 className="display text-5xl">Page not found.</h1>
      <Link href="/dashboard" className="btn btn-primary mt-6">
        Back to invoices
      </Link>
    </div>
  );
}
