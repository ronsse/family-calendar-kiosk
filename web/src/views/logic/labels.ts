/**
 * Unit H — text budgets.
 *
 * Each band declares its own budget in `bandTypography[band].maxLabelWords`; the
 * renderer applies it to the field its band is allowed to read.  The picture band
 * never calls anything in this module — its budget is zero words, which is not a
 * short string but the absence of the call.
 */

const WHITESPACE = /\s+/g;

/** First `maxWords` words, with an ellipsis when anything was dropped. */
export function truncateWords(text: string, maxWords: number): string {
  if (typeof text !== 'string') return '';
  const clean = text.trim().replace(WHITESPACE, ' ');
  if (clean.length === 0) return '';
  if (maxWords <= 0) return '';
  const words = clean.split(' ');
  if (words.length <= maxWords) return clean;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

/**
 * The label CHROME may show — the routine's own name in a panel header, say, which
 * is not one of the seven leaves and so has no band renderer of its own.
 *
 * Driven by `bandTypography[band].labelField` as DATA: no band is compared, and a
 * fourth band would get a correct header the moment it has a typography entry.
 * Leaves never call this; each one reads the single field its band is allowed to.
 */
export function bandLabel(
  view: { labelShort: string; labelFull: string },
  typo: { labelField: 'none' | 'labelShort' | 'labelFull'; maxLabelWords: number },
): string {
  if (typo.labelField === 'none') return '';
  const raw = typo.labelField === 'labelShort' ? view.labelShort : view.labelFull;
  return truncateWords(raw, typo.maxLabelWords);
}
