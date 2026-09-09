const KEY = 'flek.referral.pending';

/**
 * A referral has to survive the whole gap between opening a link and having an account:
 * browsing, signing up, leaving for an e-mail confirmation, and coming back in a new tab.
 * Only the opaque code is kept — never a user id, which the browser has no business
 * asserting. The server decides whether the code means anything.
 */
export function rememberReferral(code: string) {
  try {
    localStorage.setItem(KEY, code.toUpperCase());
  } catch {
    // Private mode: attribution is lost, which is strictly better than a crash.
  }
}

export function pendingReferral(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearReferral() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}
