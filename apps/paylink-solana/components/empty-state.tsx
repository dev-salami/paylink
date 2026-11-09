import Link from "next/link";

export function EmptyState({
  title,
  body,
  href,
  action,
}: {
  title: string;
  body: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-elev text-xl text-muted" aria-hidden>∅</span>
      <h2 className="t-h2">{title}</h2>
      <p className="t-small max-w-sm text-muted">{body}</p>
      {href && action ? (
        <Link href={href} className="btn btn-primary mt-2">
          {action}
        </Link>
      ) : null}
    </div>
  );
}
