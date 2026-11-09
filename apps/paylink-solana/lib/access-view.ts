import { safeNext, verifyAccessToken } from "./access";

/** Shared server-page decision; no cookie writes, renewal, or client-side token. */
export async function merchantAccessState(input: {
  token?: string;
  secret: string;
  enabled: boolean;
  next?: string;
  now?: number;
}) {
  const unlocked = !input.enabled || await verifyAccessToken(input.token, input.secret, input.now);
  const next = safeNext(input.next);
  return { unlocked, redirectTo: unlocked ? next : null };
}
