// Customer text can reach human reviewers, who must never see contact or card details.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const CARD_OR_LONG_NUMBER = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export function redactContactDetails(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(CARD_OR_LONG_NUMBER, "[number removed]")
    .replace(PHONE, "[phone removed]");
}
