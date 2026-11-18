import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Check, Heart, Loader2, Sparkles } from "lucide-react";
import type { VoteTally } from "@shared/designStudio";

/**
 * Design Studio "Share with family": the page a shopper's family and friends open from the link
 * they were sent. It shows the shopper's designs; each person taps a favourite (one vote each,
 * which they can move) and may add their first name. No login. The shopper sees the votes on
 * their designs in the chat; the brand sees them on the request.
 */

interface SharedDesigns {
  brand: string;
  website: string | null;
  label: string;
  summary: string;
  designs: { id: string; url: string; note: string; original: boolean }[];
  votes: Record<string, VoteTally>;
  myVote: string | null;
}

const VOTER_KEY = "chroney-design-voter";

/** This browser's voter id: the same person voting again moves their vote instead of adding one. */
function voterId(): string {
  try {
    const saved = localStorage.getItem(VOTER_KEY);
    if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved;
    const made = crypto.randomUUID();
    localStorage.setItem(VOTER_KEY, made);
    return made;
  } catch {
    return crypto.randomUUID();
  }
}

export default function DesignVote() {
  const [location] = useLocation();
  const token = location.split("/")[2]?.split("?")[0] || "";
  const voter = useMemo(voterId, []);
  const [data, setData] = useState<SharedDesigns | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [big, setBig] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Help choose a design";
    fetch(`/api/design-studio/public/share/${encodeURIComponent(token)}`, { headers: { "x-voter-id": voter } })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "This link isn't available any more.");
        setData(body);
      })
      .catch(e => setGone(e.message));
  }, [token, voter]);

  const vote = async (designId: string) => {
    setSaving(designId);
    setError(null);
    try {
      const res = await fetch(`/api/design-studio/public/share/${encodeURIComponent(token)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designId, voterId: voter, name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Your vote couldn't be saved. Please try again.");
      setData(body);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  if (gone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6 text-center">
        <p className="text-[15px] text-gray-600" data-testid="vote-gone">{gone}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  }

  const total = Object.values(data.votes).reduce((n, v) => n + v.count, 0);
  const top = Math.max(0, ...Object.values(data.votes).map(v => v.count));

  return (
    <div className="min-h-screen bg-stone-50" data-testid="page-design-vote">
      <div className="mx-auto max-w-xl px-4 pb-16 pt-8">
        <p className="text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-rose-700">{data.brand}</p>
        <h1 className="mt-2 text-center text-[26px] font-semibold leading-tight text-gray-900">Which one do you like best?</h1>
        <p className="mx-auto mt-2 max-w-sm text-center text-[14px] leading-snug text-gray-600">
          Someone close to you is designing a piece of jewellery and would love your opinion. Tap your favourite.
        </p>
        {data.summary && <p className="mx-auto mt-1.5 max-w-sm text-center text-[12.5px] text-gray-500" data-testid="vote-summary">{data.summary}</p>}

        <div className="mx-auto mt-5 max-w-xs">
          <input
            value={name} onChange={e => setName(e.target.value.slice(0, 30))} placeholder="Your first name (optional)" data-testid="vote-name"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-center text-[14px] outline-none focus:border-gray-400"
          />
        </div>

        <div className={`mt-5 grid gap-3 ${data.designs.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {data.designs.map((d, i) => {
            // Drawn designs are numbered from 1; the brand's own piece is "The original".
            const number = data.designs.slice(0, i + 1).filter(x => !x.original).length;
            const mine = data.myVote === d.id;
            const votes = data.votes[d.id];
            return (
              <div key={d.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${mine ? "border-rose-500 ring-2 ring-rose-200" : "border-gray-200"}`} data-testid="vote-design">
                <button type="button" onClick={() => setBig(d.url)} className="block w-full" aria-label="See it bigger">
                  <img src={d.url} alt={d.note} className="aspect-square w-full object-cover" />
                </button>
                <div className="p-2.5">
                  <p className="text-[12.5px] font-medium text-gray-800">{d.original ? "The original" : `Design ${number}`}</p>
                  {data.myVote && (
                    <p className="mt-0.5 flex items-center gap-1 text-[12px] text-gray-500" data-testid="vote-count">
                      <Heart className={`h-3 w-3 ${votes?.count && votes.count === top ? "fill-rose-500 text-rose-500" : ""}`} />
                      {votes?.count || 0} vote{votes?.count === 1 ? "" : "s"}
                      {votes?.names.length ? <span className="truncate">· {votes.names.slice(0, 3).join(", ")}</span> : null}
                    </p>
                  )}
                  <button
                    type="button" onClick={() => vote(d.id)} disabled={!!saving || mine} data-testid="vote-button"
                    className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-colors ${mine ? "bg-rose-50 text-rose-700" : "bg-gray-900 text-white hover:bg-gray-700"} disabled:cursor-default`}
                  >
                    {saving === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : mine ? <Check className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
                    {mine ? "Your pick" : data.myVote ? "Pick this instead" : "I like this one"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-center text-[13px] text-red-700" data-testid="vote-error">{error}</p>}
        {data.myVote && (
          <p className="mt-4 text-center text-[14px] font-medium text-gray-800" data-testid="vote-thanks">
            Thank you! {total} vote{total === 1 ? "" : "s"} so far. You can change your pick any time.
          </p>
        )}

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-4 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-rose-600" />
          <p className="mt-1.5 text-[14px] font-medium text-gray-900">Want to design your own?</p>
          <p className="mt-0.5 text-[13px] text-gray-600">These are design previews made with {data.brand}'s jewellery designer.</p>
          {data.website && /^https?:\/\//i.test(data.website) && (
            <a href={data.website} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-xl bg-rose-700 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-rose-800" data-testid="vote-design-your-own">
              {data.label} at {data.brand}
            </a>
          )}
        </div>
      </div>

      {big && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setBig(null)}>
          <img src={big} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}
