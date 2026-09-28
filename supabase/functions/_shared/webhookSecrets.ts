/**
 * Stripe signs a webhook with the secret of the endpoint that sent it. FLEK has two endpoints on the same
 * URL: the platform's (payments, refunds) and the Connect one (events of the businesses' accounts, such as
 * `account.updated`). The event is accepted when either secret verifies it; a missing secret is skipped.
 */
export async function verifyWithAnySecret<T>(
  secrets: (string | null | undefined)[],
  verify: (secret: string) => Promise<T>,
): Promise<T | null> {
  for (const secret of secrets) {
    if (!secret) continue;
    try {
      return await verify(secret);
    } catch {
      // Not signed with this secret; try the next one.
    }
  }
  return null;
}
