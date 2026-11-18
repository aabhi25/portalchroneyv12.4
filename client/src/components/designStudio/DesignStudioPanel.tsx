import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, ChevronRight, Copy, Download, ExternalLink, Heart, Loader2, RefreshCw, Send, Share2, Sparkles, User, X } from "lucide-react";
import type { DesignChoices, DesignImage, DesignStudioPublicConfig, MotifSuggestion, PieceId, PriceRange, TierId, VoteTally } from "@shared/designStudio";

/**
 * Design Studio in the website chat (shared/designStudio.ts): the shopper picks a piece, who it is
 * for, a motif (with the AI's advice), the metal, stones and size, then sees three design previews,
 * changes one by describing the change, and asks the brand to make it.
 *
 * "Customise this" on a product card opens it on that product instead: the product's photo is
 * the starting point and the shopper says what to change.
 *
 * Extras the brand can switch off: "Try it on" (the design on the shopper's own photo, never
 * kept) and "Share with family" (a link where family vote; the votes show on the designs).
 *
 * It covers the chat while open. The session is kept for the browser tab, so closing the panel and
 * coming back carries on from the designs.
 */

interface Session {
  id: string;
  choices: DesignChoices;
  designs: DesignImage[];
  price: PriceRange | null;
  priceText: string | null;
  hasContact: boolean;
  requested: boolean;
  chosenDesignId: string | null;
  rendersLeft: number;
  shareToken: string | null;
  votes: Record<string, VoteTally>;
}

interface SimilarProduct { id: string; name: string; price: string | null; imageUrl: string | null; productUrl: string | null }

type Step = "piece" | "who" | "motif" | "material" | "designs" | "done";
const STEPS: Step[] = ["piece", "who", "motif", "material", "designs"];

interface Props {
  businessAccountId: string;
  visitorToken?: string | null;
  conversationId?: string | null;
  pageUrl?: string | null;
  chatColor: string;
  chatColorEnd?: string;
  onClose: () => void;
  /** The shopper asked for a design to be made: the chat shows it. */
  onRequested: (design: { url: string; summary: string }) => void;
  /** "Customise this": the product the shopper tapped. */
  product?: { id: string; name: string } | null;
}

const sessionKey = (accountId: string) => `chroney-design-session-${accountId}`;
const remember = (accountId: string, id: string | null) => {
  try {
    if (id) sessionStorage.setItem(sessionKey(accountId), id);
    else sessionStorage.removeItem(sessionKey(accountId));
  } catch { /* private window: the session just isn't remembered */ }
};
const remembered = (accountId: string) => {
  try { return sessionStorage.getItem(sessionKey(accountId)); } catch { return null; }
};

export function DesignStudioPanel({ businessAccountId, visitorToken, conversationId, pageUrl, chatColor, chatColorEnd, onClose, onRequested, product }: Props) {
  const [config, setConfig] = useState<DesignStudioPublicConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState<Step>("piece");
  const [choices, setChoices] = useState<DesignChoices>({});
  const [advice, setAdvice] = useState<{ intro: string; suggestions: MotifSuggestion[] } | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [showAllMotifs, setShowAllMotifs] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The contact form: why it is open, and what to do once the details are in. */
  const [contactFor, setContactFor] = useState<null | { kind: "change"; text: string } | { kind: "again" } | { kind: "request" } | { kind: "tryon"; photo: File }>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "", note: "" });
  const [similar, setSimilar] = useState<SimilarProduct[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  /** Try-on: the picture for each design tried (kept only while the panel is open), and the one on show. */
  const [tryOns, setTryOns] = useState<Record<string, string>>({});
  const [tryOnBusy, setTryOnBusy] = useState(false);
  const [showTryOn, setShowTryOn] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const selfieInput = useRef<HTMLInputElement>(null);
  const changeInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const gradient = `linear-gradient(135deg, ${chatColor}, ${chatColorEnd || chatColor})`;

  const call = useCallback(async <T,>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetch(`/api/design-studio/public/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessAccountId, visitorToken: visitorToken || null, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || "Something went wrong. Please try again."), { code: data?.code });
    return data as T;
  }, [businessAccountId, visitorToken]);

  // Open: the brand's design kit, then this tab's earlier session (if any) or a new one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/design-studio/public/config?businessAccountId=${encodeURIComponent(businessAccountId)}`);
        const cfg = await res.json();
        if (cancelled) return;
        if (!res.ok || !cfg?.enabled) { setLoadError("Designing isn't available right now."); return; }
        setConfig(cfg);
        const open = (s: Session) => {
          setSession(s);
          setChoices(s.choices || {});
          if (s.designs.length > 0) {
            setStep("designs");
            setSelectedId([...s.designs].reverse().find(d => d.status === "ready")?.id ?? null);
          }
        };
        const earlier = remembered(businessAccountId);
        if (earlier) {
          try {
            const { session: s } = await call<{ session: Session }>(`sessions/${earlier}/state`);
            if (cancelled) return;
            // Carry on, unless it was sent already or the shopper has now tapped a different product.
            if (!s.requested && (!product || s.choices?.base?.productId === product.id)) return open(s);
          } catch { /* gone: start a new one */ }
        }
        const { session: s } = await call<{ session: Session }>("sessions", { conversationId: conversationId || null, pageUrl: pageUrl || null, productId: product?.id || null });
        if (cancelled) return;
        remember(businessAccountId, s.id);
        open(s);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.code === "not_customisable" ? e.message : "Designing isn't available right now. Please try again in a moment.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessAccountId]);

  // While a design is being drawn, ask for the session every few seconds.
  const drawing = !!session?.designs.some(d => d.status === "pending");
  useEffect(() => {
    if (!drawing || !session) return;
    const timer = setInterval(async () => {
      try {
        const { session: s } = await call<{ session: Session }>(`sessions/${session.id}/state`);
        const before = sessionRef.current;
        setSession(s);
        // A design just finished: a change the shopper asked for opens straight away; in a new set the
        // first design opens, unless the shopper has already tapped one.
        const justReady = s.designs.filter(d => d.status === "ready" && before?.designs.find(b => b.id === d.id)?.status === "pending");
        const changed = justReady.filter(d => d.parentId).pop();
        if (changed) setSelectedId(changed.id);
        else if (justReady.length) setSelectedId(current => current ?? s.designs.find(d => d.round === justReady[0].round && d.status === "ready")!.id);
      } catch { /* try again on the next tick */ }
    }, 2500);
    return () => clearInterval(timer);
  }, [drawing, session?.id, call]);

  // Shared with family: look for new votes now and then.
  const shared = !!session?.shareToken && step === "designs";
  useEffect(() => {
    if (!shared || drawing || !session) return;
    const timer = setInterval(() => {
      call<{ session: Session }>(`sessions/${session.id}/state`).then(r => setSession(r.session)).catch(() => undefined);
    }, 20000);
    return () => clearInterval(timer);
  }, [shared, drawing, session?.id, call]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);

  const set = (patch: Partial<DesignChoices>) => setChoices(c => ({ ...c, ...patch }));
  const motifOf = (id?: string) => config?.motifs.find(m => m.id === id);
  const pieceOf = (id?: PieceId) => config?.pieces.find(p => p.id === id);

  const askAdvice = async (next: DesignChoices) => {
    if (!session) return;
    setAdviceLoading(true);
    setAdvice(null);
    try {
      setAdvice(await call(`sessions/${session.id}/motifs`, { choices: next }));
    } catch {
      setAdvice({ intro: "Pick a motif you like:", suggestions: [] });
      setShowAllMotifs(true);
    } finally {
      setAdviceLoading(false);
    }
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const drawDesigns = () => run(async () => {
    if (!session) return;
    try {
      const { session: s } = await call<{ session: Session }>(`sessions/${session.id}/designs`, { choices });
      setSession(s);
      setSelectedId(null);
      setSimilar(null);
      setStep("designs");
    } catch (e: any) {
      if (e?.code === "contact_required") { setError(null); setContactFor({ kind: "again" }); return; }
      throw e;
    }
  }).catch(() => undefined);

  const askChange = (text: string) => run(async () => {
    if (!session || !selectedId || text.trim().length < 3) return;
    try {
      const { session: s } = await call<{ session: Session }>(`sessions/${session.id}/change`, { designId: selectedId, change: text.trim() });
      setSession(s);
      setChange("");
      bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      if (e?.code === "contact_required") { setError(null); setContactFor({ kind: "change", text: text.trim() }); return; }
      throw e;
    }
  }).catch(() => undefined);

  const submitContact = () => run(async () => {
    if (!session || !contactFor) return;
    if (contactFor.kind === "request") {
      const design = session.designs.find(d => d.id === selectedId);
      const { session: s } = await call<{ session: Session }>(`sessions/${session.id}/request`, {
        designId: selectedId, note: contact.note,
        ...(session.hasContact ? {} : { name: contact.name, phone: contact.phone, email: contact.email }),
      });
      setSession(s);
      setContactFor(null);
      setStep("done");
      remember(businessAccountId, null);
      if (design?.url) onRequested({ url: design.url, summary: summaryText });
      return;
    }
    const { session: s } = await call<{ session: Session }>(`sessions/${session.id}/contact`, { name: contact.name, phone: contact.phone, email: contact.email });
    setSession(s);
    const then = contactFor;
    setContactFor(null);
    if (then.kind === "change") await askChange(then.text);
    else if (then.kind === "tryon") await tryOn(then.photo);
    else await drawDesigns();
  }).catch(() => undefined);

  /** The selected design on the shopper's photo. The photo is sent once and not kept. */
  const tryOn = async (photo: File | undefined) => {
    if (!session || !selectedId || !photo) return;
    const designId = selectedId;
    setTryOnBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("businessAccountId", businessAccountId);
      body.append("visitorToken", visitorToken || "");
      body.append("designId", designId);
      body.append("selfie", photo);
      const res = await fetch(`/api/design-studio/public/sessions/${session.id}/try-on`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data?.code === "contact_required") { setContactFor({ kind: "tryon", photo }); return; }
      if (!res.ok || !data.image) throw new Error(data?.error || "Try-on isn't available right now. Please try again in a little while.");
      setTryOns(t => ({ ...t, [designId]: data.image }));
      setShowTryOn(designId);
      setSession(s => (s ? { ...s, rendersLeft: Math.max(0, s.rendersLeft - 1) } : s));
    } catch (e: any) {
      setError(e?.message || "Try-on isn't available right now.");
    } finally {
      setTryOnBusy(false);
    }
  };

  const shareLink = session?.shareToken ? `${window.location.origin}/design-vote/${session.shareToken}` : "";
  const shareText = `Help me choose my jewellery design 💍 Tap to see them and vote: ${shareLink}`;
  const openShare = () => run(async () => {
    if (!session) return;
    if (!session.shareToken) setSession((await call<{ session: Session }>(`sessions/${session.id}/share`)).session);
    setShareOpen(true);
    setCopied(false);
  }).catch(() => undefined);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); } catch { setCopied(false); }
  };

  const loadSimilar = async () => {
    if (!session) return;
    setSimilarLoading(true);
    try {
      setSimilar((await call<{ products: SimilarProduct[] }>(`sessions/${session.id}/similar`)).products);
    } catch {
      setSimilar([]);
    } finally {
      setSimilarLoading(false);
    }
  };

  const summaryText = useMemo(() => {
    const c = session?.choices || choices;
    if (c.base) return `Customised ${c.base.name}`;
    const tier = config?.tiers.find(t => t.id === c.tier)?.name;
    return [
      [tier, pieceOf(c.piece)?.name].filter(Boolean).join(" "),
      motifOf(c.motifId)?.name,
      config?.metals.find(m => m.id === c.metalId)?.name,
      c.stoneId && c.stoneId !== "none" ? config?.stones.find(s => s.id === c.stoneId)?.name : null,
    ].filter(Boolean).join(" · ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.choices, choices, config]);

  const stepIndex = STEPS.indexOf(step);
  const base = session?.choices?.base ?? null;
  const back = () => {
    setError(null);
    if (contactFor) return setContactFor(null);
    // A product being customised has no earlier steps to go back to.
    if (step === "piece" || step === "done" || (step === "designs" && base)) return onClose();
    setStep(STEPS[stepIndex - 1]);
  };

  const selected = session?.designs.find(d => d.id === selectedId) ?? null;
  const totalVotes = Object.values(session?.votes || {}).reduce((n, v) => n + v.count, 0);
  const canShare = !!config?.familyVote && !!session?.designs.some(d => d.status === "ready" && !d.original);
  const latestRound = Math.max(0, ...(session?.designs.map(d => d.round) ?? [0]));
  const days = config ? (config.makingDays.min === config.makingDays.max ? `${config.makingDays.min} days` : `${config.makingDays.min}–${config.makingDays.max} days`) : "";

  // ── pieces of the screen ────────────────────────────────────────────────

  const guide = (text: string) => (
    <div className="mb-3 flex items-start gap-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ background: gradient }}>
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <p className="rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2 text-[13.5px] leading-snug text-gray-800" data-testid="design-guide">{text}</p>
    </div>
  );

  const chip = (label: string, active: boolean, onClick: () => void, testId?: string) => (
    <button
      key={label} type="button" onClick={onClick} data-testid={testId}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? "border-transparent text-white" : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"}`}
      style={active ? { background: chatColor } : undefined}
    >
      {label}
    </button>
  );

  const primary = (label: string, onClick: () => void, disabled = false, testId?: string) => (
    <button
      type="button" onClick={onClick} disabled={disabled || busy} data-testid={testId}
      className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold text-white shadow-sm transition-opacity disabled:opacity-50"
      style={{ background: gradient }}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  );

  const voteBadge = (designId: string) => {
    const votes = session?.votes[designId]?.count;
    return votes ? (
      <span className="absolute right-1 top-1 flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 text-[10.5px] font-semibold shadow-sm" style={{ color: chatColor }}>
        <Heart className="h-2.5 w-2.5 fill-current" />{votes}
      </span>
    ) : null;
  };

  const motifTile = (id: string, why?: string) => {
    const m = motifOf(id);
    if (!m) return null;
    const active = choices.motifId === id;
    return (
      <button
        key={id} type="button" onClick={() => set({ motifId: id })} data-testid={`design-motif-${id}`}
        className={`flex items-center gap-3 rounded-xl border bg-white p-2.5 text-left transition-all ${active ? "shadow-sm" : "border-gray-200 hover:border-gray-400"}`}
        style={active ? { borderColor: chatColor, boxShadow: `0 0 0 1px ${chatColor}` } : undefined}
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-gray-50 text-2xl">
          {m.imageUrl ? <img src={m.imageUrl} alt="" className="h-full w-full object-cover" /> : m.emoji || "✨"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-gray-900">{m.name}</span>
          <span className="block text-[12px] leading-snug text-gray-600">{why || m.meaning}</span>
        </span>
        {active && <Check className="h-4 w-4 shrink-0" style={{ color: chatColor }} />}
      </button>
    );
  };

  const renderStep = () => {
    if (!config || !session) return null;
    if (step === "piece") {
      return (
        <>
          {guide("Let's design something that's only yours. What would you like to make?")}
          <div className="grid grid-cols-3 gap-2">
            {config.pieces.map(p => (
              <button
                key={p.id} type="button" data-testid={`design-piece-${p.id}`}
                onClick={() => { set({ piece: p.id }); setStep("who"); }}
                className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-4 transition-all hover:border-gray-400 hover:shadow-sm active:scale-[0.97]"
                style={choices.piece === p.id ? { borderColor: chatColor } : undefined}
              >
                <span className="text-2xl">{p.emoji}</span>
                <span className="text-[13px] font-medium text-gray-800">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      );
    }
    if (step === "who") {
      return (
        <>
          {guide(`Lovely. Who is the ${pieceOf(choices.piece)?.name.toLowerCase() || "piece"} for, and what's the occasion? I'll suggest motifs that suit.`)}
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">It's for</p>
          <div className="mb-4 flex flex-wrap gap-1.5">{config.recipients.map(r => chip(r, choices.recipient === r, () => set({ recipient: r }), `design-for-${r}`))}</div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Occasion</p>
          <div className="flex flex-wrap gap-1.5">{config.occasions.map(o => chip(o, choices.occasion === o, () => set({ occasion: o }), `design-occasion-${o}`))}</div>
        </>
      );
    }
    if (step === "motif") {
      const suggested = advice?.suggestions ?? [];
      const others = config.motifs.filter(m => !suggested.some(s => s.motifId === m.id));
      return (
        <>
          {guide(adviceLoading ? "Thinking about what would suit…" : advice?.intro || "Pick a motif you like:")}
          {adviceLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
          <div className="grid gap-2">{suggested.map(s => motifTile(s.motifId, s.why))}</div>
          {!adviceLoading && others.length > 0 && (
            showAllMotifs || suggested.length === 0
              ? <div className="mt-2 grid gap-2">{others.map(m => motifTile(m.id))}</div>
              : <button type="button" onClick={() => setShowAllMotifs(true)} className="mt-2 flex items-center gap-1 text-[13px] font-medium" style={{ color: chatColor }} data-testid="design-more-motifs">See all motifs <ChevronRight className="h-3.5 w-3.5" /></button>
          )}
          <p className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Your own idea (optional)</p>
          <textarea
            value={choices.idea || ""} onChange={e => set({ idea: e.target.value.slice(0, 200) })} rows={2}
            placeholder={'e.g. "the letter A with a tiny star"'} data-testid="design-idea"
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-[13.5px] outline-none focus:border-gray-400"
          />
        </>
      );
    }
    if (step === "material") {
      return (
        <>
          {guide("Almost there. Choose the metal, any stones, and how bold you'd like it.")}
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Metal</p>
          <div className="mb-4 flex flex-wrap gap-1.5">{config.metals.map(m => chip(m.name, choices.metalId === m.id, () => set({ metalId: m.id }), `design-metal-${m.id}`))}</div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Stones</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {chip("No stones", choices.stoneId === "none", () => set({ stoneId: "none" }), "design-stone-none")}
            {config.stones.map(s => chip(s.name, choices.stoneId === s.id, () => set({ stoneId: s.id }), `design-stone-${s.id}`))}
          </div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Size</p>
          <div className="grid gap-2">
            {config.tiers.map(t => {
              const active = choices.tier === t.id;
              return (
                <button
                  key={t.id} type="button" onClick={() => set({ tier: t.id as TierId })} data-testid={`design-tier-${t.id}`}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition-all hover:border-gray-400"
                  style={active ? { borderColor: chatColor, boxShadow: `0 0 0 1px ${chatColor}` } : undefined}
                >
                  <span>
                    <span className="block text-[13.5px] font-semibold text-gray-900">{t.name}</span>
                    <span className="block text-[12px] text-gray-600">{t.line}</span>
                  </span>
                  {active && <Check className="h-4 w-4" style={{ color: chatColor }} />}
                </button>
              );
            })}
          </div>
        </>
      );
    }
    if (step === "done") {
      return (
        <div className="flex flex-col items-center pt-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full text-white" style={{ background: gradient }}><Check className="h-7 w-7" /></span>
          <h3 className="mt-3 text-[17px] font-semibold text-gray-900" data-testid="design-done">Your design is with our designers</h3>
          <p className="mt-1.5 max-w-[280px] text-[13.5px] leading-snug text-gray-600">
            We'll call you to confirm the final design and price. Once you approve it, making it takes about {days}.
          </p>
          {selected?.url && <img src={selected.url} alt="Your design" className="mt-4 w-40 rounded-xl border border-gray-200" />}
          <div className="mt-5 w-full space-y-2">
            {similarBlock()}
            <button type="button" onClick={onClose} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-[13.5px] font-medium text-gray-700 hover:border-gray-400" data-testid="design-back-to-chat">Back to chat</button>
          </div>
        </div>
      );
    }
    // designs
    const round = session.designs.filter(d => d.round === latestRound);
    const earlier = session.designs.filter(d => d.round !== latestRound && d.status === "ready");
    const failedAll = round.length > 0 && round.every(d => d.status === "failed");
    return (
      <>
        {guide(
          drawing ? "Sketching your designs… this takes about half a minute."
            : failedAll ? "Sorry, I couldn't draw that. Please try again."
              : selected?.original ? `What would you like to change about this ${pieceOf(session.choices.piece)?.name.toLowerCase() || "piece"}? Pick one below, or tell me in your own words.`
                : selected ? "Like it? I can change anything: just tell me what. When it feels right, tap “Make this for me”."
                  : "Here are your designs. Tap one to see it bigger.",
        )}
        {/* One finished design on its own is already shown big below: no need for its tile too. */}
        {!(round.length === 1 && round[0].status === "ready" && selectedId === round[0].id) && <div className={`grid gap-2 ${round.length > 1 ? "grid-cols-3" : "grid-cols-1"}`}>
          {round.map(d => (
            <button
              key={d.id} type="button" disabled={d.status !== "ready"} onClick={() => { setSelectedId(d.id); setError(null); }} data-testid={`design-tile-${d.status}`}
              className={`relative overflow-hidden rounded-xl border bg-gray-50 ${round.length > 1 ? "aspect-square" : "mx-auto aspect-square w-2/3"} ${selectedId === d.id ? "" : "border-gray-200"}`}
              style={selectedId === d.id ? { borderColor: chatColor, boxShadow: `0 0 0 2px ${chatColor}` } : undefined}
            >
              {d.status === "ready" && d.url && <img src={d.url} alt={d.note} className="h-full w-full object-cover" />}
              {d.status === "pending" && (
                <span className="absolute inset-0 grid animate-pulse place-items-center bg-gradient-to-br from-gray-100 to-gray-200">
                  <Sparkles className="h-6 w-6" style={{ color: chatColor }} />
                </span>
              )}
              {d.status === "failed" && <span className="absolute inset-0 grid place-items-center px-2 text-center text-[11px] text-gray-500">Couldn't draw this one</span>}
              {voteBadge(d.id)}
            </button>
          ))}
        </div>}
        {failedAll && <div className="mt-3">{primary("Try again", drawDesigns, false, "design-retry")}</div>}

        {selected?.url && (
          <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
            <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              <img src={selected.url} alt={selected.note} className="w-full" data-testid="design-selected" />
              <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white">{selected.original ? "The original" : "Design preview"}</span>
            </div>
            <p className="mt-2 text-[13px] text-gray-700">{selected.note}</p>
            {!selected.original && <p className="mt-0.5 text-[12px] text-gray-500">{summaryText}</p>}
            {session.votes[selected.id] && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: chatColor }} data-testid="design-votes">
                <Heart className="h-3.5 w-3.5 fill-current" />
                {session.votes[selected.id].count} family vote{session.votes[selected.id].count === 1 ? "" : "s"}
                {session.votes[selected.id].names.length > 0 && <span className="font-normal text-gray-500">· {session.votes[selected.id].names.slice(0, 4).join(", ")}</span>}
              </p>
            )}
            {selected.original ? (
              base?.price && (
                <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2">
                  <span className="block text-[11px] uppercase tracking-wide text-gray-500">Price as it is</span>
                  <span className="block text-[14px] font-semibold text-gray-900">{config.currencySymbol}{Number(base.price).toLocaleString("en-IN")}</span>
                </div>
              )
            ) : (
              <>
                <div className="mt-2 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                  <span>
                    <span className="block text-[11px] uppercase tracking-wide text-gray-500">{session.priceText ? "Estimated price" : "Price"}</span>
                    <span className="block text-[14px] font-semibold text-gray-900" data-testid="design-price">{session.priceText || "Quoted by our designer"}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[11px] uppercase tracking-wide text-gray-500">Made in</span>
                    <span className="block text-[14px] font-semibold text-gray-900">{days}</span>
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-gray-500">This is a preview. Our designer finalises the details{session.priceText ? " and the exact price" : ""} with you before anything is made.</p>
                <div className="mt-3">{primary("Make this for me", () => { setError(null); setContactFor({ kind: "request" }); }, drawing, "design-make-this")}</div>
              </>
            )}

            {(config.tryOn || (canShare && !selected.original)) && (
              <div className="mt-2 flex gap-2">
                {config.tryOn && (
                  <button
                    type="button" disabled={tryOnBusy || busy} data-testid="design-try-on"
                    onClick={() => (tryOns[selected.id] ? setShowTryOn(selected.id) : selfieInput.current?.click())}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
                  >
                    {tryOnBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                    {tryOnBusy ? "Putting it on you…" : tryOns[selected.id] ? "See it on you" : "Try it on"}
                  </button>
                )}
                {canShare && !selected.original && (
                  <button
                    type="button" disabled={busy} onClick={openShare} data-testid="design-share"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
                  >
                    <Share2 className="h-4 w-4" />
                    {totalVotes > 0 ? `Family votes (${totalVotes})` : "Share with family"}
                  </button>
                )}
              </div>
            )}
            {tryOnBusy && <p className="mt-1 text-[11px] text-gray-500">This takes about half a minute. Your photo isn't kept.</p>}

            <p className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Change something</p>
            <div className="flex flex-wrap gap-1.5">
              {(base ? config.customiseChanges : config.quickChanges).map(q => chip(q, false, () => {
                // "Add my initial" needs the letter: it goes in the box for the shopper to finish.
                if (/initial$/i.test(q)) { setChange("Add the initial "); changeInput.current?.focus(); } else askChange(q);
              }, `design-quick-${q}`))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={changeInput} value={change} onChange={e => setChange(e.target.value.slice(0, 200))} placeholder="Describe a change…" data-testid="design-change-input"
                onKeyDown={e => { if (e.key === "Enter" && change.trim().length >= 3 && !busy && !drawing) askChange(change); }}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[13.5px] outline-none focus:border-gray-400"
              />
              <button
                type="button" disabled={busy || drawing || change.trim().length < 3} onClick={() => askChange(change)} aria-label="Send change" data-testid="design-change-send"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white disabled:opacity-40" style={{ background: chatColor }}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            {session.rendersLeft <= 3 && <p className="mt-1 text-[11px] text-gray-500">{session.rendersLeft === 0 ? "You've used all the designs for this session." : `${session.rendersLeft} more design${session.rendersLeft === 1 ? "" : "s"} left in this session.`}</p>}

            <div className="mt-4">{similarBlock()}</div>
          </motion.div>
        )}

        {earlier.length > 0 && (
          <>
            <p className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Earlier designs</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {earlier.map(d => (
                <button key={d.id} type="button" onClick={() => setSelectedId(d.id)} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200" style={selectedId === d.id ? { borderColor: chatColor } : undefined}>
                  <img src={d.url} alt={d.note} className="h-full w-full object-cover" />
                  {voteBadge(d.id)}
                </button>
              ))}
            </div>
          </>
        )}
        {!drawing && (
          <button type="button" onClick={() => setStep("piece")} className="mt-4 flex items-center gap-1.5 text-[12.5px] font-medium text-gray-600 hover:text-gray-900" data-testid="design-start-over">
            <RefreshCw className="h-3.5 w-3.5" /> {base ? "Design something from scratch" : "Start a different design"}
          </button>
        )}
      </>
    );
  };

  function similarBlock() {
    if (similar === null) {
      return (
        <button type="button" onClick={loadSimilar} disabled={similarLoading} className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-[13.5px] font-medium text-gray-700 hover:border-gray-400" data-testid="design-similar">
          {similarLoading && <Loader2 className="h-4 w-4 animate-spin" />} See ready pieces like this
        </button>
      );
    }
    if (similar.length === 0) return <p className="text-center text-[12.5px] text-gray-500">No ready pieces quite like this one, which makes yours all the more special.</p>;
    return (
      <div>
        <p className="mb-1.5 text-left text-[12px] font-semibold uppercase tracking-wide text-gray-500">Ready pieces like this</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {similar.map(p => (
            <a key={p.id} href={p.productUrl || undefined} target="_blank" rel="noopener noreferrer" className="w-28 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white text-left" data-testid="design-similar-product">
              {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" className="aspect-square w-full object-cover" />}
              <span className="block px-2 pt-1.5 text-[11.5px] font-medium leading-tight text-gray-800 line-clamp-2">{p.name}</span>
              <span className="flex items-center justify-between px-2 pb-1.5 pt-0.5 text-[11.5px] text-gray-600">
                {p.price ? `${config?.currencySymbol || ""}${Number(p.price).toLocaleString("en-IN")}` : ""}
                {p.productUrl && <ExternalLink className="h-3 w-3" />}
              </span>
            </a>
          ))}
        </div>
      </div>
    );
  }

  const nextButton = () => {
    if (step === "who") {
      return primary("Suggest motifs", () => { setShowAllMotifs(false); setStep("motif"); askAdvice(choices); }, !choices.recipient || !choices.occasion, "design-next-who");
    }
    if (step === "motif") return primary("Next", () => setStep("material"), !choices.motifId && !(choices.idea && choices.idea.trim().length >= 3), "design-next-motif");
    if (step === "material") return primary(busy ? "Starting…" : "Show my designs", drawDesigns, !choices.metalId || !choices.stoneId || !choices.tier, "design-draw");
    return null;
  };

  const contactForm = () => {
    if (!contactFor || !session || !config) return null;
    const isRequest = contactFor.kind === "request";
    const needDetails = !session.hasContact || !isRequest;
    const sizeHint = pieceOf(session.choices.piece)?.needsSize;
    const ready = !needDetails || (contact.name.trim().length >= 2 && contact.phone.replace(/\D/g, "").length >= 10);
    const field = (key: "name" | "phone" | "email", label: string, type: string, auto: string) => (
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-gray-600">{label}</span>
        <input
          type={type} autoComplete={auto} value={contact[key]} onChange={e => setContact(c => ({ ...c, [key]: e.target.value }))} data-testid={`design-contact-${key}`}
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[14px] outline-none focus:border-gray-400"
        />
      </label>
    );
    return (
      <div className="absolute inset-0 z-10 flex items-end bg-black/40" onClick={() => !busy && setContactFor(null)}>
        <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="max-h-[92%] w-full overflow-y-auto rounded-t-2xl bg-white p-4" onClick={e => e.stopPropagation()}>
          <h3 className="text-[16px] font-semibold text-gray-900">{isRequest ? "Make this for me" : contactFor.kind === "tryon" ? "Try it on" : "Keep designing"}</h3>
          <p className="mt-1 text-[13px] leading-snug text-gray-600">
            {isRequest
              ? needDetails ? "Share your details and our designer will call you with the final design and price." : "Our designer will call you with the final design and price."
              : contactFor.kind === "tryon" ? "Share your name and mobile number to try it on. We'll save your design for you."
                : "Share your name and mobile number to keep changing your design. We'll save it for you."}
          </p>
          <div className="mt-3 space-y-2.5">
            {needDetails && field("name", "Your name", "text", "name")}
            {needDetails && field("phone", "Mobile number", "tel", "tel")}
            {needDetails && isRequest && field("email", "Email (optional)", "email", "email")}
            {isRequest && (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-gray-600">{sizeHint ? `${sizeHint}, or anything else we should know` : "Anything else we should know? (optional)"}</span>
                <textarea
                  rows={2} value={contact.note} onChange={e => setContact(c => ({ ...c, note: e.target.value.slice(0, 300) }))} data-testid="design-contact-note"
                  className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-[14px] outline-none focus:border-gray-400"
                />
              </label>
            )}
          </div>
          {error && <p className="mt-2 text-[12.5px] text-red-600" data-testid="design-error">{error}</p>}
          <div className="mt-3">{primary(isRequest ? "Send my design" : "Continue", submitContact, !ready, "design-contact-submit")}</div>
        </motion.div>
      </div>
    );
  };

  function shareSheet() {
    if (!shareOpen || !session?.shareToken) return null;
    return (
      <div className="absolute inset-0 z-10 flex items-end bg-black/40" onClick={() => setShareOpen(false)}>
        <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-full rounded-t-2xl bg-white p-4" onClick={e => e.stopPropagation()} data-testid="design-share-sheet">
          <h3 className="text-[16px] font-semibold text-gray-900">Share with family</h3>
          <p className="mt-1 text-[13px] leading-snug text-gray-600">Send this link to family and friends. They see your designs and vote for their favourite. Their votes show up here on each design.</p>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" data-testid="design-share-whatsapp"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-[14px] font-semibold text-white"
          >
            <Share2 className="h-4 w-4" /> Send on WhatsApp
          </a>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={shareLink} onFocus={e => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700" data-testid="design-share-link" />
            <button type="button" onClick={copyLink} className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-[12.5px] font-medium text-gray-700" data-testid="design-share-copy">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {totalVotes > 0 && <p className="mt-2 text-[12.5px] text-gray-600">{totalVotes} vote{totalVotes === 1 ? "" : "s"} so far.</p>}
        </motion.div>
      </div>
    );
  }

  function tryOnView() {
    const picture = showTryOn ? tryOns[showTryOn] : null;
    if (!picture) return null;
    return (
      <div className="absolute inset-0 z-20 flex flex-col bg-black/95" onClick={() => setShowTryOn(null)} data-testid="design-try-on-view">
        <div className="flex items-center justify-between px-3 py-3 text-white">
          <p className="text-[15px] font-semibold">How it looks on you</p>
          <button type="button" aria-label="Close" onClick={() => setShowTryOn(null)} className="rounded-full p-1 hover:bg-white/20"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center px-3" onClick={e => e.stopPropagation()}>
          <img src={picture} alt="The design on you" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
        <div className="flex gap-2 px-3 py-3" onClick={e => e.stopPropagation()}>
          <a href={picture} download="my-design-try-on.jpg" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-[13.5px] font-semibold text-gray-900"><Download className="h-4 w-4" /> Save photo</a>
          <button type="button" onClick={() => { setShowTryOn(null); selfieInput.current?.click(); }} className="flex-1 rounded-xl border border-white/50 px-3 py-2.5 text-[13.5px] font-medium text-white">Try another photo</button>
        </div>
        <p className="px-3 pb-3 text-center text-[11px] text-white/70">A preview made by AI. Your photo isn't kept.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col bg-white" style={{ zIndex: 100000 }} data-testid="design-studio-panel">
      <div className="flex items-center gap-2 px-3 py-3 text-white" style={{ background: gradient }}>
        <button type="button" onClick={back} aria-label="Back" className="rounded-full p-1 hover:bg-white/20" data-testid="design-back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{base ? "Customise this piece" : config?.label || "Design your own jewellery"}</p>
          {step !== "done" && stepIndex >= 0 && !base && (
            <div className="mt-1 flex gap-1">
              {STEPS.map((s, i) => <span key={s} className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-white" : "bg-white/35"}`} />)}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-white/20" data-testid="design-close"><X className="h-5 w-5" /></button>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loadError
          ? <p className="pt-10 text-center text-[13.5px] text-gray-600">{loadError}</p>
          : !config || !session
            ? <div className="flex justify-center pt-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            : renderStep()}
        {error && !contactFor && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700" data-testid="design-error">{error}</p>}
      </div>

      {config && session && !loadError && nextButton() && <div className="border-t border-gray-100 px-3 py-3">{nextButton()}</div>}
      {contactForm()}
      {shareSheet()}
      {tryOnView()}
      <input
        ref={selfieInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid="design-selfie-input"
        onChange={e => { const photo = e.target.files?.[0]; e.target.value = ""; tryOn(photo); }}
      />
    </motion.div>
  );
}
