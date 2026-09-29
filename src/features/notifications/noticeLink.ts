/**
 * Where a notice opens. In FLEK Partner a notice about another of the person's venues opens that
 * venue: the shell selects the venue named by `?provozovna=` and drops the parameter again. Notices
 * written before their link named the venue get it here.
 */
export function noticeLink(href: string, noticeVenue: string | null, openVenue?: string): string {
  if (!noticeVenue || noticeVenue === openVenue || !href.startsWith('/partner') || /[?&]provozovna=/.test(href)) return href;
  return `${href}${href.includes('?') ? '&' : '?'}provozovna=${encodeURIComponent(noticeVenue)}`;
}
