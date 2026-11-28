/**
 * Text normalisation shared by every rule in the qualifier, so patterns can be written once
 * instead of covering every spelling / keyboard variant.
 *
 * - lower-case
 * - Arabic-Indic (U+0660-0669) and Persian (U+06F0-06F9) digits -> ASCII;
 *   Arabic decimal / thousands separators and the Arabic comma -> "." and ","
 * - strip Arabic diacritics (tashkeel) and tatweel
 * - unify alef forms (hamza above/below, madda, wasla -> bare alef), alef maqsura -> ya, ta marbuta -> ha
 * - unify dashes (en/em/minus...) to "-" and collapse whitespace
 *
 * Build patterns with {@link rx}: it applies the same Arabic folding to the regex source,
 * so rules can be written with natural spelling ("إلى", "غرفة", "أكثر").
 */
export function normalize(input: string): string {
  return arabicFold(
    input
      .toLowerCase()
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // U+0660-0669 Arabic-Indic digits
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // U+06F0-06F9 Persian digits
      .replace(/٫/g, '.') // U+066B Arabic decimal separator
      .replace(/[٬،]/g, ','), // U+066C thousands separator, U+060C Arabic comma
  )
    .replace(/[‐-―−]/g, '-') // U+2010-2015 dashes, U+2212 minus
    .replace(/\s+/g, ' ')
    .trim();
}

/** The Arabic-only part of {@link normalize}. Safe on regex sources (never touches escapes like \D). */
export function arabicFold(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '') // U+064B-065F tashkeel, U+0670 superscript alef, U+0640 tatweel
    .replace(/[آأإٱ]/g, 'ا') // alef with madda / hamza above / hamza below / wasla -> bare alef
    .replace(/ى/g, 'ي') // alef maqsura -> ya
    .replace(/ة/g, 'ه'); // ta marbuta -> ha
}

/** Regex for normalised text; Arabic in the source is folded like the input. Always unicode-aware. */
export function rx(source: string, flags = ''): RegExp {
  return new RegExp(arabicFold(source), flags.includes('u') ? flags : `${flags}u`);
}
