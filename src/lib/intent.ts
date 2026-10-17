export function normalizeTr(s: string) {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cümlede olumsuzluk / vazgeçme var mı? ("evet ama girme", "evet, hayır demek istedim" → onay DEĞİL) */
const NEGATION = /\b(hayır|hayir|değil|degil|yok|girme|iptal)\b/;

/** Kesin onay: yalnızca açık "evet" ifadeleri işlem onayı sayılır. */
export function isYes(s: string) {
  const t = normalizeTr(s);
  if (!t || NEGATION.test(t)) return false;
  return /^(evet|evet gir|evet onaylıyorum|onaylıyorum|onayla|evet işleme gir|evet aç)$/.test(t) || /^evet\b/.test(t);
}

export function isNo(s: string) {
  const t = normalizeTr(s);
  return /^(hayır|hayir|reddet|iptal|vazgeç|girme|istemiyorum)\b/.test(t);
}
