// sanitize.mjs — strip characters that render as nothing in the app but reach the model in full
// (MCP-PLAN §10 "Untrusted text"). Applied to every title, note and tag in results, and to text written
// through the connector. Legitimate emoji survive: ZWJ stays between two emoji, and tag characters stay
// inside a subdivision-flag sequence (🏴 + tags + cancel tag, e.g. England).

const PICTO = /\p{Extended_Pictographic}/u;
const EMOJI_TAIL = /[\p{Extended_Pictographic}\p{Emoji_Modifier}️]/u;
const BLACK_FLAG = 0x1f3f4, TAG_FIRST = 0xe0020, TAG_LAST = 0xe007e, CANCEL_TAG = 0xe007f;

const invisible = (c) =>
  (c < 0x20 && c !== 0x0a && c !== 0x09) || (c >= 0x7f && c <= 0x9f) ||   // C0/C1 controls, DEL
  (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) ||          // bidi embeddings, overrides, isolates
  c === 0x200e || c === 0x200f || c === 0x061c ||                           // bidi marks
  c === 0x200b || c === 0x200c || c === 0x2060 || c === 0xfeff;             // zero-width space/non-joiner, word joiner, BOM

/** text → { text, removed } where removed counts the code points dropped. Non-strings pass through. */
export function sanitize(text) {
  if (typeof text !== 'string') return { text, removed: 0 };
  // Fast path: nothing outside printable ASCII plus \n\t means nothing to remove.
  if (!/[^\x20-\x7e\n\t]/.test(text)) return { text, removed: 0 };
  const cp = [...text], out = [];
  let removed = 0;
  for (let i = 0; i < cp.length; i++) {
    const s = cp[i], c = s.codePointAt(0);
    if (invisible(c)) { removed++; continue; }
    if (c === 0x200d) { // zero-width joiner: only inside an emoji sequence
      if (out.length && EMOJI_TAIL.test(out[out.length - 1]) && i + 1 < cp.length && PICTO.test(cp[i + 1])) out.push(s);
      else removed++;
      continue;
    }
    if (c === BLACK_FLAG) { // a valid subdivision flag keeps its tag run
      let j = i + 1;
      while (j < cp.length && cp[j].codePointAt(0) >= TAG_FIRST && cp[j].codePointAt(0) <= TAG_LAST) j++;
      if (j > i + 1 && j < cp.length && cp[j].codePointAt(0) === CANCEL_TAG) { out.push(...cp.slice(i, j + 1)); i = j; continue; }
      out.push(s);
      continue;
    }
    if (c >= 0xe0000 && c <= 0xe007f) { removed++; continue; } // stray tag characters
    out.push(s);
  }
  return { text: removed ? out.join('') : text, removed };
}

export const clean = (text) => sanitize(text).text;
