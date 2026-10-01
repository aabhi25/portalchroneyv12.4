/**
 * Deterministic "what should the voice engine say" conversion for voice mode.
 *
 * The on-screen answer stays exactly what the model wrote (Markdown, LaTeX,
 * diagrams). This module derives the SPOKEN form of it with no model call, so
 * it adds no latency and can run sentence by sentence while the answer is
 * still streaming:
 *
 *   - Markdown structure (headings, bullets, tables, emphasis, links, images,
 *     code fences, block quotes) becomes plain sentences.
 *   - Maths is read out in words: "x^2" / "x²" → "x squared", "\frac{a}{b}" /
 *     "3/4" → "a over b", "√x" → "the square root of x", "≤" → "is less than
 *     or equal to", "H_2O" / "H2O" → "H 2 O", "9.8 m/s^2" → "9.8 metres per
 *     second squared", "50%" → "50 percent" …
 *   - Emojis are dropped.
 *   - Hindi (Devanagari) and Hinglish words pass through untouched; only the
 *     symbols around them are verbalised.
 *
 * Pure and synchronous — see server/services/__tests__/voiceSpeechText.test.ts.
 *
 * NOTE: written without regex lookbehind, named groups, or the `u`/`s` flags:
 * the project's TypeScript target rejects them in regex literals.
 */

const GREEK: Record<string, string> = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon',
  varepsilon: 'epsilon', zeta: 'zeta', eta: 'eta', theta: 'theta', vartheta: 'theta',
  iota: 'iota', kappa: 'kappa', lambda: 'lambda', mu: 'mu', nu: 'nu', xi: 'xi',
  pi: 'pi', rho: 'rho', sigma: 'sigma', tau: 'tau', upsilon: 'upsilon', phi: 'phi',
  varphi: 'phi', chi: 'chi', psi: 'psi', omega: 'omega',
  Gamma: 'gamma', Delta: 'delta', Theta: 'theta', Lambda: 'lambda', Xi: 'xi',
  Pi: 'pi', Sigma: 'sigma', Phi: 'phi', Psi: 'psi', Omega: 'omega',
};

const UNICODE_SYMBOLS: Array<[RegExp, string]> = [
  [/≤|⩽/g, ' is less than or equal to '],
  [/≥|⩾/g, ' is greater than or equal to '],
  [/≠/g, ' is not equal to '],
  [/≈|≅/g, ' is approximately '],
  [/≡/g, ' is identical to '],
  [/±/g, ' plus or minus '],
  [/∓/g, ' minus or plus '],
  [/×/g, ' times '],
  [/÷/g, ' divided by '],
  [/·|⋅/g, ' times '],
  [/−/g, ' minus '],
  [/∞/g, ' infinity '],
  [/∠/g, ' angle '],
  [/△|∆/g, ' triangle '],
  [/⊥/g, ' is perpendicular to '],
  [/∥/g, ' is parallel to '],
  [/∴/g, ' therefore '],
  [/∵/g, ' because '],
  [/⇒|⟹/g, ' which means '],
  [/⇌|⇄/g, ' is in equilibrium with '],
  [/→|⟶|➝|➔/g, ' gives '],
  [/∝/g, ' is proportional to '],
  [/∑/g, ' the sum of '],
  [/∫/g, ' the integral of '],
  [/π/g, ' pi '],
  [/θ/g, ' theta '],
  [/α/g, ' alpha '],
  [/β/g, ' beta '],
  [/γ/g, ' gamma '],
  [/[Δδ]/g, ' delta '],
  [/λ/g, ' lambda '],
  [/μ/g, ' mu '],
  [/σ/g, ' sigma '],
  [/ω/g, ' omega '],
  [/Ω/g, ' ohms '],
  [/φ|ϕ/g, ' phi '],
  [/ρ/g, ' rho '],
];

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7',
  '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', 'ⁿ': 'n', 'ˣ': 'x', 'ʸ': 'y',
};
const SUBSCRIPTS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7',
  '₈': '8', '₉': '9', '₊': '+', '₋': '-', 'ₙ': 'n', 'ₓ': 'x',
};

/** Unit symbols read after a number ("5 km" → "5 kilometres"). */
const UNITS: Record<string, string> = {
  km: 'kilometres', m: 'metres', cm: 'centimetres', mm: 'millimetres', nm: 'nanometres',
  kg: 'kilograms', g: 'grams', mg: 'milligrams',
  ml: 'millilitres', mL: 'millilitres', l: 'litres', L: 'litres',
  sec: 'seconds', secs: 'seconds', min: 'minutes', mins: 'minutes', hr: 'hours', hrs: 'hours',
  N: 'newtons', J: 'joules', kJ: 'kilojoules', W: 'watts', kW: 'kilowatts', kWh: 'kilowatt hours',
  V: 'volts', mA: 'milliamperes', Hz: 'hertz', kHz: 'kilohertz', Pa: 'pascals', kPa: 'kilopascals',
  K: 'kelvin', cal: 'calories', kcal: 'kilocalories', mol: 'moles',
};

/** Spoken power for an exponent: "2" → " squared", "n" → " to the power n". */
function speakPower(exponent: string): string {
  const e = exponent.trim().replace(/^\((.*)\)$/, '$1').trim();
  if (e === '2') return ' squared ';
  if (e === '3') return ' cubed ';
  if (e === '\\circ' || e === 'circ' || e === '°' || e === 'o') return ' degrees ';
  return ` to the power ${e} `;
}

/** "-1" → "minus 1" etc. inside an already-isolated maths fragment. */
function speakOperators(text: string): string {
  return text
    .replace(/<=/g, ' is less than or equal to ')
    .replace(/>=/g, ' is greater than or equal to ')
    .replace(/!=/g, ' is not equal to ')
    .replace(/\s*=\s*/g, ' equals ')
    .replace(/\s*\+\s*/g, ' plus ')
    .replace(/(^|[\s(=,])-\s*(?=[\dA-Za-z(\\])/g, '$1minus ')
    .replace(/(\w|\))\s*-\s*(?=[\w(\\])/g, '$1 minus ')
    .replace(/\s*\*\s*/g, ' times ')
    .replace(/\s*<\s*/g, ' is less than ')
    .replace(/\s*>\s*/g, ' is greater than ');
}

/**
 * Read one LaTeX fragment (the inside of $…$, $$…$$, \(…\), \[…\]) aloud.
 * Handles the commands a K-12 answer actually uses; anything unknown loses its
 * backslash and braces rather than being read as symbols.
 */
export function latexToSpeech(input: string): string {
  let s = ` ${input} `;

  // Wrappers whose content should simply be read.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathsf|operatorname|boldsymbol|bm|displaystyle|textstyle|underline|overline|vec|hat|bar)\s*\{([^{}]*)\}/g, ' $1 ');
    if (next === s) break;
    s = next;
  }

  // Fractions, innermost first so nesting resolves.
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 over $2 ');
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, ' $1 over $2 ');

  // Roots.
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/\\sqrt\s*\[\s*3\s*\]\s*\{([^{}]*)\}/g, ' the cube root of $1 ')
      .replace(/\\sqrt\s*\[\s*([^\]]+)\s*\]\s*\{([^{}]*)\}/g, ' the $1th root of $2 ')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' the square root of $1 ');
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\\sqrt\s*(\w)/g, ' the square root of $1 ');

  // Degrees before generic powers: 90^\circ, 90^{\circ}.
  s = s.replace(/\^\s*\{?\s*\\circ\s*\}?\s*([CF])\b/g, (_m, unit) => ` degrees ${unit === 'C' ? 'Celsius' : 'Fahrenheit'} `);
  s = s.replace(/\^\s*\{?\s*\\circ\s*\}?/g, ' degrees ');

  // Powers and subscripts.
  s = s.replace(/\^\s*\{([^{}]*)\}/g, (_m, e) => speakPower(e));
  s = s.replace(/\^\s*(-?\w)/g, (_m, e) => speakPower(e));
  s = s.replace(/_\s*\{([^{}]*)\}/g, ' $1 ');
  s = s.replace(/_\s*(\w)/g, ' $1 ');

  // Named operators / relations.
  const commands: Array<[RegExp, string]> = [
    [/\\times\b/g, ' times '],
    [/\\cdot\b/g, ' times '],
    [/\\div\b/g, ' divided by '],
    [/\\pm\b/g, ' plus or minus '],
    [/\\mp\b/g, ' minus or plus '],
    [/\\(?:leq|le|leqslant)\b/g, ' is less than or equal to '],
    [/\\(?:geq|ge|geqslant)\b/g, ' is greater than or equal to '],
    [/\\(?:neq|ne)\b/g, ' is not equal to '],
    [/\\approx\b/g, ' is approximately '],
    [/\\(?:equiv|cong)\b/g, ' is congruent to '],
    [/\\sim\b/g, ' is similar to '],
    [/\\propto\b/g, ' is proportional to '],
    [/\\(?:lt)\b/g, ' is less than '],
    [/\\(?:gt)\b/g, ' is greater than '],
    [/\\(?:longrightarrow|rightarrow)\b/g, ' gives '],
    [/\\(?:Rightarrow|implies)\b/g, ' which means '],
    [/\\(?:rightleftharpoons|leftrightarrow)\b/g, ' is in equilibrium with '],
    [/\\to\b/g, ' tends to '],
    [/\\therefore\b/g, ' therefore '],
    [/\\because\b/g, ' because '],
    [/\\infty\b/g, ' infinity '],
    [/\\angle\b/g, ' angle '],
    [/\\triangle\b/g, ' triangle '],
    [/\\perp\b/g, ' is perpendicular to '],
    [/\\parallel\b/g, ' is parallel to '],
    [/\\degree\b/g, ' degrees '],
    [/\\circ\b/g, ' degrees '],
    [/\\%/g, ' percent '],
    [/\\sum\b/g, ' the sum of '],
    [/\\int\b/g, ' the integral of '],
    [/\\lim\b/g, ' the limit '],
    [/\\log\b/g, ' log '],
    [/\\ln\b/g, ' natural log '],
    [/\\sin\b/g, ' sine '],
    [/\\cos\b/g, ' cos '],
    [/\\tan\b/g, ' tan '],
    [/\\cot\b/g, ' cot '],
    [/\\sec\b/g, ' sec '],
    [/\\csc\b/g, ' cosec '],
    [/\\(?:left|right|big|Big|bigg|Bigg)\b/g, ' '],
    [/\\(?:quad|qquad)\b/g, ' '],
    [/\\[,;:! ]/g, ' '],
    [/\\\\/g, ' '],
  ];
  for (const [re, word] of commands) s = s.replace(re, word);
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => (GREEK[name] ? ` ${GREEK[name]} ` : ` ${name} `));

  s = s.replace(/[{}]/g, ' ');
  s = s.replace(/&/g, ' ');
  // a/b inside maths is a fraction.
  s = s.replace(/\s*\/\s*/g, ' over ');
  s = speakOperators(s);
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Strip emoji and pictographs (surrogate-pair ranges, dingbats, modifiers). */
function stripEmoji(text: string): string {
  return text
    .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]/g, '')
    .replace(/[☀-➿]/g, '')
    .replace(/[⬀-⯿]/g, '')
    .replace(/[︎️‍⃣]/g, '');
}

function convertUnicodeScripts(text: string): string {
  // Runs of superscripts after a base: x² → x squared, 10⁻³ → 10 to the power -3.
  let out = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣʸ]+/g, (run) => {
    const e = run.split('').map((c) => SUPERSCRIPTS[c] ?? c).join('');
    return speakPower(e.replace(/^-/, 'minus '));
  });
  // Digit subscripts join their element (H₂O → H2O) so the chemical-formula
  // pass below reads them as "H 2 O"; letter subscripts (aₙ) are spaced.
  out = out.replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (run) => run.split('').map((c) => SUBSCRIPTS[c] ?? c).join(''));
  out = out.replace(/[₊₋ₙₓ]+/g, (run) => ` ${run.split('').map((c) => SUBSCRIPTS[c] ?? c).join('')} `);
  return out;
}

/** "H2SO4" → "H 2 S O 4"; leaves ordinary words, "A4", "Class10" alone. */
function speakChemicalFormula(token: string): string | null {
  if (!/\d/.test(token)) return null;
  if (!/^(?:\(?[A-Z][a-z]?\d*\)?\d*){2,}$/.test(token)) return null;
  const parts = token.match(/[A-Z][a-z]?|\d+/g);
  if (!parts || parts.filter((p) => /[A-Z]/.test(p)).length < 2) return null;
  return parts.map((p) => (/^\d+$/.test(p) ? p : p.split('').join(' '))).join(' ');
}

function convertProseMath(text: string): string {
  let s = text;

  // Unit compounds before anything splits them on "/" or "^".
  s = s.replace(/\bm\s*\/\s*s\s*(?:\^\s*\{?\s*2\s*\}?|²|2\b)/g, ' metres per second squared ');
  s = s.replace(/\bm\s*\/\s*s\b/g, ' metres per second ');
  s = s.replace(/\bkm\s*\/\s*h(?:r)?\b|\bkmph\b|\bkm\/hr\b/g, ' kilometres per hour ');
  s = s.replace(/\bg\s*\/\s*cm\s*(?:\^\s*\{?\s*3\s*\}?|³|3\b)/g, ' grams per cubic centimetre ');
  s = s.replace(/\bkg\s*\/\s*m\s*(?:\^\s*\{?\s*3\s*\}?|³|3\b)/g, ' kilograms per cubic metre ');
  s = s.replace(/(\d)\s?(k?m|cm|mm)\s*(?:\^\s*\{?\s*2\s*\}?|²)(?![\w])/g, (_m, d, u) => `${d} square ${UNITS[u] || u} `);
  s = s.replace(/(\d)\s?(k?m|cm|mm)\s*(?:\^\s*\{?\s*3\s*\}?|³)(?![\w])/g, (_m, d, u) => `${d} cubic ${UNITS[u] || u} `);
  s = s.replace(/°\s*C\b/g, ' degrees Celsius ');
  s = s.replace(/°\s*F\b/g, ' degrees Fahrenheit ');
  s = s.replace(/°/g, ' degrees ');

  // Chemical formulas with explicit subscripts: H_2O, CO_{2}.
  s = s.replace(/([A-Za-z)])_\{([^{}]*)\}/g, '$1 $2 ');
  s = s.replace(/([A-Za-z)])_(\d+)/g, '$1$2');
  s = s.replace(/([A-Za-z)])_([a-z])\b/g, '$1 $2 ');

  // Unicode super/subscripts.
  s = convertUnicodeScripts(s);

  // Caret powers in plain text: x^2, x^(n+1), x^{n}, 10^-3.
  s = s.replace(/\^\s*\{([^{}]*)\}/g, (_m, e) => speakPower(e));
  s = s.replace(/\^\s*\(([^()]*)\)/g, (_m, e) => speakPower(e));
  s = s.replace(/\^\s*(-?\s*\w+)/g, (_m, e) => speakPower(String(e).replace(/^-\s*/, 'minus ')));

  // Roots.
  s = s.replace(/∛\s*\(([^()]*)\)/g, ' the cube root of $1 ');
  s = s.replace(/∛\s*(\w+)/g, ' the cube root of $1 ');
  s = s.replace(/√\s*\(([^()]*)\)/g, ' the square root of $1 ');
  s = s.replace(/√\s*\{([^{}]*)\}/g, ' the square root of $1 ');
  s = s.replace(/√\s*([\w.]+)/g, ' the square root of $1 ');
  s = s.replace(/\bsqrt\s*\(([^()]*)\)/gi, ' the square root of $1 ');

  // Symbols.
  for (const [re, word] of UNICODE_SYMBOLS) s = s.replace(re, word);

  // Multiplication written with * or x between numbers.
  s = s.replace(/(\d)\s*\*\s*(?=\d)/g, '$1 times ');
  s = s.replace(/(\d)\s+[xX]\s+(?=\d)/g, '$1 times ');

  // Percent and rupees.
  s = s.replace(/(\d)\s*%/g, '$1 percent');
  s = s.replace(/₹\s*([\d,]+(?:\.\d+)?)/g, '$1 rupees');
  s = s.replace(/\bRs\.?\s*([\d,]+(?:\.\d+)?)/g, '$1 rupees');

  // Numbers followed by a unit symbol.
  s = s.replace(/(\d)\s?(kWh|kHz|kPa|kcal|kJ|kW|km|kg|cm|mm|nm|mg|mL|ml|mA|Hz|Pa|mol|cal|secs?|mins?|hrs?|[mgNJWVLK])(?![\w/])/g,
    (_m, d, unit) => `${d} ${UNITS[unit] || unit}`);

  // Ratios "3:1" (but not clock times "10:30").
  s = s.replace(/\b(\d+)\s*:\s*(\d+)\b/g, (m, a, b) => {
    if (/^\d{2}$/.test(b) && Number(a) <= 24) return m;
    return `${a} to ${b}`;
  });

  // Fractions: a lone "3/4" (not dates like 12/05/2024), and single-letter x/y.
  s = s.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(\s*\/\s*\d+)?/g, (m, a, b, third, offset: number, whole: string) => {
    if (third) return m;
    const before = whole.slice(Math.max(0, offset - 1), offset);
    if (before === '/') return m;
    return `${a} over ${b}`;
  });
  s = s.replace(/\b([a-zA-Z])\s*\/\s*([a-zA-Z0-9])\b/g, '$1 over $2');

  // Comparison and equality operators in prose.
  s = s.replace(/<=/g, ' is less than or equal to ');
  s = s.replace(/>=/g, ' is greater than or equal to ');
  s = s.replace(/!=/g, ' is not equal to ');
  s = s.replace(/(\w|\))\s*<\s*(?=[\w(-])/g, '$1 is less than ');
  s = s.replace(/(\w|\))\s*>\s*(?=[\w(-])/g, '$1 is greater than ');
  s = s.replace(/\s*=+\s*/g, ' equals ');

  // Plus between operands; minus only where it is clearly arithmetic.
  s = s.replace(/([\w)])\s*\+\s*(?=[\w(])/g, '$1 plus ');
  s = s.replace(/(\b(?:\d+(?:\.\d+)?|[a-zA-Z])\)?)\s+-\s+(?=\(?(?:\d|[a-zA-Z]\b))/g, '$1 minus ');
  s = s.replace(/(\d)-(?=\d)/g, (m, d, offset: number, whole: string) => {
    // "7-2" in an equation reads as a subtraction; dates/ranges keep the dash.
    const line = whole.slice(Math.max(0, offset - 20), offset + 20);
    return /equals|plus|times|over/.test(line) ? `${d} minus ` : m;
  });
  s = s.replace(/(^|[\s(,]|equals )-\s?(?=\d)/g, '$1minus ');

  // Chemical formulas written inline: H2O, CO2, C6H12O6.
  s = s.replace(/\(?[A-Z][A-Za-z0-9()]*\d[A-Za-z0-9()]*/g, (token) => speakChemicalFormula(token) ?? token);

  // Decimals: "3.14" → "3 point 1 4" (integer part stays as a number).
  s = s.replace(/(\d+)\.(\d+)(?!\d|\.\d)/g, (m, whole, frac, offset: number, str: string) => {
    const before = str.slice(Math.max(0, offset - 1), offset);
    if (before === '.') return m; // version numbers like 1.2.3
    return `${whole} point ${frac.split('').join(' ')}`;
  });

  return s;
}

/**
 * Convert one Markdown answer (or one streamed sentence of it) into the text
 * the voice engine should say.
 */
export function markdownToSpeech(markdown: string): string {
  if (!markdown) return '';
  let s = String(markdown).replace(/\r\n?/g, '\n');

  // Remove images first (never read a URL), then links → their text.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  s = s.replace(/\[\[IMAGE:\s*\d+\s*\]\]/g, ' ');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g, ' ');
  s = s.replace(/https?:\/\/\S+/g, ' ');

  // Code fences: keep the code text, drop the fences.
  s = s.replace(/```[^\n]*\n?/g, '');

  // Maths blocks, read via the LaTeX converter. Display maths first.
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex) => ` ${latexToSpeech(tex)}. `);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, tex) => ` ${latexToSpeech(tex)}. `);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, tex) => ` ${latexToSpeech(tex)} `);
  s = s.replace(/\$([^$\n]+?)\$/g, (_m, tex) => ` ${latexToSpeech(tex)} `);
  // Stray LaTeX commands outside delimiters (the model sometimes forgets them).
  if (/\\[A-Za-z]+/.test(s)) {
    s = s.replace(/\\[dt]?frac\s*\{[^{}]*\}\s*\{[^{}]*\}|\\sqrt\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}|\\[A-Za-z]+/g, (m) => ` ${latexToSpeech(m)} `);
  }

  // Common abbreviations read better expanded.
  s = s.replace(/\be\.\s?g\.(?=\s|,|$)/gi, 'for example');
  s = s.replace(/\bi\.\s?e\.(?=\s|,|$)/gi, 'that is');
  s = s.replace(/\s&\s/g, ' and ');

  // Multiplication with * between numbers must survive emphasis stripping.
  s = s.replace(/(\d)\s*\*\s*(?=\d)/g, '$1 times ');

  // Line-level Markdown structure. Each line becomes its own spoken sentence.
  const lines = s.split('\n');
  const spoken: string[] = [];
  for (const rawLine of lines) {
    let line = rawLine;
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue; // table divider
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) continue; // horizontal rule
    line = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    line = line.replace(/^\s*>+\s?/, '');
    line = line.replace(/^\s*[-*+•▪●◦]\s+/, '');
    line = line.replace(/^\s*\(?\d{1,3}[.)]\s+/, '');
    line = line.replace(/^\s*\(?(?:[a-h]|i{1,3}|iv|v|vi{1,3})\)\s+/, '');
    if (line.indexOf('|') !== -1 && /\|.*\|/.test(line)) {
      line = line.split('|').map((c) => c.trim()).filter(Boolean).join(', ');
    }
    line = line.trim();
    if (!line) continue;
    spoken.push(line);
  }
  s = spoken
    .map((line) => (/[.!?।॥…:;,]["'”’)\]*_]*$/.test(line) ? line : `${line}.`))
    .join(' ');

  // Inline emphasis / code markers.
  s = s.replace(/\*\*|__|~~/g, '');
  s = s.replace(/`+/g, '');
  s = s.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?;:]|$)/g, '$1$2');
  s = s.replace(/(^|\s)\*(?=\S)/g, '$1');
  s = s.replace(/(\S)\*(?=\s|$)/g, '$1');

  s = stripEmoji(s);
  s = convertProseMath(s);

  // Tidy: whitespace, spaces before punctuation, doubled punctuation.
  s = s
    .replace(/[{}\\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:।])/g, '$1')
    .replace(/([.!?।])(?:\s*[.])+/g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/:\s*\./g, '.')
    .trim();
  if (/^[.,;:!?\s]+$/.test(s)) return '';
  return s;
}
