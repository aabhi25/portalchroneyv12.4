/**
 * Meta's limits for the WhatsApp messages a journey step turns into (developers.facebook.com,
 * interactive reply buttons / list messages, checked 2026-10-26). Over a limit Meta either cuts
 * the text on the customer's phone ("Explore MBA specialisati") or rejects the whole message.
 * The journey editor counts against these; the server shortens anything still over them.
 */
export const WA_LIMITS = {
  buttonsMax: 3,
  buttonTitle: 20,
  buttonBody: 1024,
  listRows: 10,
  listButton: 20,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  textBody: 4096,
} as const;

/** Room kept in a dropdown message for the "(Page 2 of 3)" line added to long lists. */
const PAGE_NOTE_ROOM = 24;

/** Characters as Meta counts them (UTF-16 units, so an emoji counts as 2, never under-counted). */
export function waLength(text: string | null | undefined): number {
  return (text || "").length;
}

/** The text cut to `limit` with "…" at the end, never splitting an emoji. */
export function shortenForWhatsapp(text: string, limit: number): string {
  const t = (text || "").trim();
  if (t.length <= limit) return t;
  let out = "";
  for (const ch of Array.from(t)) {
    if (out.length + ch.length > limit - 1) break;
    out += ch;
  }
  return out.trimEnd() + "…";
}

/** Option labels as sent: shortened to `limit` and kept different from each other. */
export function whatsappOptionTitles(titles: string[], limit: number): string[] {
  const seen = new Set<string>();
  return titles.map(title => {
    let shown = shortenForWhatsapp(title, limit);
    for (let n = 2; seen.has(shown.toLowerCase()); n++) {
      shown = shortenForWhatsapp(title, limit - String(n).length - 1) + " " + n;
    }
    seen.add(shown.toLowerCase());
    return shown;
  });
}

/**
 * Index of the option a WhatsApp tap picked when the tap carries a shortened label (WhatsApp
 * sends back the label as shown). Covers both label sizes (a button question with more than 3
 * buttons goes out as a list) and the plain cut used before 2026-10-26. -1 when none matches.
 */
export function matchShortenedOption(titles: string[], tapped: string): number {
  const t = (tapped || "").trim().toLowerCase();
  if (!t) return -1;
  if (titles.some(title => (title || "").trim().toLowerCase() === t)) return -1;
  for (const limit of [WA_LIMITS.buttonTitle, WA_LIMITS.rowTitle]) {
    const shown = whatsappOptionTitles(titles, limit);
    const i = shown.findIndex(s => s.toLowerCase() === t);
    if (i >= 0) return i;
  }
  for (const limit of [WA_LIMITS.buttonTitle, WA_LIMITS.rowTitle]) {
    const i = titles.findIndex(title => {
      const full = (title || "").trim();
      return full.length > limit && full.substring(0, limit).toLowerCase() === t;
    });
    if (i >= 0) return i;
  }
  return -1;
}

export type WhatsappStepProblem = {
  /** Which field: "prompt", "button:0", "item:2", "fallback:1", "cond:<key>:0", "followUp:2". */
  field: string;
  kind: "tooLong" | "duplicate" | "tooMany";
  message: string;
};

type StepLike = { type: string; prompt?: string | null; options?: any };

/** Most characters the step's message may have on WhatsApp. */
export function promptLimitFor(stepType: string): number {
  if (stepType === "buttons") return WA_LIMITS.buttonBody;
  if (stepType === "dropdown") return WA_LIMITS.textBody - PAGE_NOTE_ROOM;
  return WA_LIMITS.textBody;
}

/** Everything in a journey step that is over a WhatsApp limit (empty when it fits). */
export function whatsappStepProblems(step: StepLike): WhatsappStepProblem[] {
  const problems: WhatsappStepProblem[] = [];
  const opts = step.options || {};
  const tooLong = (field: string, what: string, text: string, limit: number) => {
    const len = waLength(text?.trim());
    if (len > limit) problems.push({ field, kind: "tooLong", message: `${what} is ${len} characters; WhatsApp allows ${limit}.` });
  };

  const promptLimit = promptLimitFor(step.type);
  tooLong("prompt", "The message", step.prompt || "", promptLimit);

  if (step.type === "buttons") {
    const buttons: { title: string }[] = Array.isArray(opts.buttons) ? opts.buttons : [];
    if (buttons.length > WA_LIMITS.buttonsMax) {
      problems.push({ field: "buttons", kind: "tooMany", message: `WhatsApp allows ${WA_LIMITS.buttonsMax} buttons; this question has ${buttons.length}. Use a dropdown for more.` });
    }
    const seen = new Map<string, number>();
    buttons.forEach((b, i) => {
      tooLong(`button:${i}`, `Button "${(b.title || "").trim()}"`, b.title || "", WA_LIMITS.buttonTitle);
      const key = (b.title || "").trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) problems.push({ field: `button:${i}`, kind: "duplicate", message: `Two buttons say "${(b.title || "").trim()}"; WhatsApp needs each button to be different.` });
      else seen.set(key, i);
    });
  }

  if (step.type === "dropdown" || step.type === "list") {
    const items = (list: any, prefix: string) => {
      (Array.isArray(list) ? list : []).forEach((item: any, i: number) => {
        tooLong(`${prefix}:${i}`, `Option "${(item?.title || "").trim()}"`, item?.title || "", WA_LIMITS.rowTitle);
        if (item?.followUpPrompt) tooLong(`followUp:${prefix}:${i}`, "The follow-up message", item.followUpPrompt, WA_LIMITS.textBody);
      });
    };
    items(opts.dropdownItems, "item");
    items(opts.fallbackOptions, "fallback");
    if (opts.conditionalOptions && typeof opts.conditionalOptions === "object") {
      for (const [key, list] of Object.entries(opts.conditionalOptions)) items(list, `cond:${key}`);
    }
    if (Array.isArray(opts.sections)) {
      opts.sections.forEach((s: any, si: number) => {
        (s?.rows || []).forEach((r: any, ri: number) => {
          tooLong(`row:${si}:${ri}`, `Option "${(r?.title || "").trim()}"`, r?.title || "", WA_LIMITS.rowTitle);
          if (r?.description) tooLong(`rowDesc:${si}:${ri}`, "An option's description", r.description, WA_LIMITS.rowDescription);
        });
      });
    }
    if (step.type === "list" && opts.buttonText) tooLong("buttonText", "The list button", opts.buttonText, WA_LIMITS.listButton);
  }

  return problems;
}
