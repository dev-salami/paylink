import Link from "next/link";
import { publicPayPath } from "../lib/payer-link";
import { ShareLink } from "./share-link";

/** Sibling controls: the merchant customer link must never wrap these actions. */
export function PayerLinkActions({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2" role="group" aria-label={`Pay page actions for ${label}`}>
      {status !== "draft" ? <ShareLink id={id} label={label} /> : null}
      <Link className="btn btn-mint btn-small payer-link-control" href={publicPayPath(id)} aria-label={`Open pay page for ${label}`}>
        Open pay page <span aria-hidden>↗</span>
      </Link>
    </div>
  );
}
