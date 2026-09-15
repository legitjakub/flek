/** "+420777123456" → "+420 777 123 456". Presentation only: the server normalises what it stores. */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const czech = /^\+420(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return czech ? `+420 ${czech[1]} ${czech[2]} ${czech[3]}` : e164;
}

/** A wa.me link that opens a chat with the number and the message typed in. The link itself sends nothing. */
export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
