import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ImagePlus, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  MAX_CUSTOM_MOTIFS, MAX_STYLE_PHOTOS, OCCASIONS, PIECES, TIERS, estimatePrice, formatPriceRange,
  type DesignStudioSettings, type Motif, type PieceId,
} from "@shared/designStudio";

/**
 * Design Studio › Set-up: the brand's design kit (shared/designStudio.ts). What it makes, the
 * motifs, metals and stones on offer, its price rules, photos of its own style, and the limits.
 * Shoppers see estimated prices only once "Show estimated prices" is on.
 */

interface SettingsResponse {
  settings: DesignStudioSettings;
  imageAi: { ready: boolean; provider: "google" | "openai" | null };
  library: Motif[];
}

const KEY = ["/api/design-studio/settings"];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-5">
      <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
      {hint && <p className="mt-0.5 text-[13px] text-gray-500">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

async function uploadPhoto(file: File): Promise<string> {
  const body = new FormData();
  body.append("photo", file);
  const res = await fetch("/api/design-studio/upload", { method: "POST", body, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || "The photo couldn't be uploaded.");
  return data.url;
}

export default function DesignStudioSetup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<SettingsResponse>({ queryKey: KEY });
  const [form, setForm] = useState<DesignStudioSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const styleInput = useRef<HTMLInputElement>(null);
  const motifInput = useRef<HTMLInputElement>(null);
  const motifTarget = useRef<number | null>(null);

  useEffect(() => { if (data && !dirty) setForm(data.settings); }, [data, dirty]);

  const save = useMutation({
    mutationFn: (settings: DesignStudioSettings) => apiRequest<SettingsResponse>("PUT", "/api/design-studio/settings", { settings }),
    onSuccess: (saved) => {
      queryClient.setQueryData(KEY, saved);
      setForm(saved.settings);
      setDirty(false);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !form) {
    return error
      ? <div className="rounded-2xl border border-black/[0.07] bg-white p-6 text-sm text-gray-600">The Design Studio set-up couldn't be loaded. {error instanceof Error ? error.message : ""}</div>
      : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  }

  const set = (patch: Partial<DesignStudioSettings>) => { setForm(f => (f ? { ...f, ...patch } : f)); setDirty(true); };
  const number = (v: string) => (v.trim() === "" ? 0 : Math.max(0, Number(v) || 0));
  const hidden = new Set(form.hiddenMotifs);
  const missingRates = form.metals.filter(m => m.enabled && !(m.ratePerGram > 0)).map(m => m.name);
  const sample = (() => {
    const metal = form.metals.find(m => m.enabled && m.ratePerGram > 0);
    const piece = form.pieces[0];
    if (!metal || !piece) return null;
    const range = estimatePrice({ ...form, ratesConfirmed: true }, { piece, metalId: metal.id, stoneId: "none", tier: "classic" });
    return range ? `A ${TIERS[1].name.toLowerCase()} ${PIECES.find(p => p.id === piece)!.name.toLowerCase()} in ${metal.name} with no stones would show as ${formatPriceRange(form.currencySymbol, range)}.` : null;
  })();

  const addPhoto = async (file: File | undefined, where: "style" | "motif") => {
    if (!file) return;
    setUploading(where);
    try {
      const url = await uploadPhoto(file);
      if (where === "style") set({ stylePhotos: [...form.stylePhotos, url].slice(0, MAX_STYLE_PHOTOS) });
      else if (motifTarget.current !== null) {
        set({ customMotifs: form.customMotifs.map((m, i) => (i === motifTarget.current ? { ...m, imageUrl: url } : m)) });
      }
    } catch (e: any) {
      toast({ title: "Photo not added", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const setMotif = (index: number, patch: Partial<Motif>) =>
    set({ customMotifs: form.customMotifs.map((m, i) => (i === index ? { ...m, ...patch } : m)) });

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24" data-testid="page-design-studio-setup">
      <div className={`flex items-start gap-2 rounded-2xl border p-4 text-[13.5px] ${data!.imageAi.ready ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`} data-testid="text-design-image-ai">
        {data!.imageAi.ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {data!.imageAi.ready
            ? `Ready: designs are drawn with your ${data!.imageAi.provider === "openai" ? "OpenAI" : "Google Gemini"} key.`
            : "Designs can't be drawn yet: this account has no Google Gemini (or OpenAI) key. Ask your AI Chroney contact to add one."}
        </span>
      </div>

      <Section title="What shoppers see" hint="The card on your chat's welcome screen and the button in the chat.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Button name</Label><Input value={form.label} maxLength={40} onChange={e => set({ label: e.target.value })} data-testid="input-design-label" /></div>
          <div><Label>Line under it</Label><Input value={form.tagline} maxLength={90} onChange={e => set({ tagline: e.target.value })} data-testid="input-design-tagline" /></div>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="text-[13.5px] text-gray-700">Show the card on the chat's welcome screen</span>
          <Switch checked={form.showOnWelcome} onCheckedChange={v => set({ showOnWelcome: v })} data-testid="switch-design-welcome" />
        </label>
      </Section>

      <Section title="What you make" hint="Shoppers can only design the pieces you tick.">
        <div className="flex flex-wrap gap-2">
          {PIECES.map(p => {
            const on = form.pieces.includes(p.id);
            return (
              <button
                key={p.id} type="button" data-testid={`toggle-design-piece-${p.id}`}
                onClick={() => {
                  const next = on ? form.pieces.filter(x => x !== p.id) : [...form.pieces, p.id];
                  if (next.length) set({ pieces: PIECES.map(x => x.id).filter(id => next.includes(id)) as PieceId[] });
                }}
                className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600"}`}
              >
                {p.emoji} {p.name}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Motifs" hint="The AI suggests from these. Switch off the ones you don't make, and add your own signature motifs with a photo.">
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {data!.library.map(m => (
            <label key={m.id} className="flex items-center justify-between gap-3 text-[13.5px] text-gray-700">
              <span>{m.emoji} {m.name}</span>
              <Switch
                checked={!hidden.has(m.id)} data-testid={`switch-design-motif-${m.id}`}
                onCheckedChange={v => set({ hiddenMotifs: v ? form.hiddenMotifs.filter(x => x !== m.id) : [...form.hiddenMotifs, m.id] })}
              />
            </label>
          ))}
        </div>
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <p className="text-[13px] font-medium text-gray-800">Your own motifs</p>
          {form.customMotifs.map((m, i) => (
            <div key={i} className="flex gap-3 rounded-xl border border-gray-200 p-3">
              <button
                type="button" onClick={() => { motifTarget.current = i; motifInput.current?.click(); }}
                className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-400"
                aria-label="Add a photo of this motif"
              >
                {m.imageUrl ? <img src={m.imageUrl} alt="" className="h-full w-full object-cover" /> : uploading === "motif" && motifTarget.current === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <Input value={m.name} maxLength={40} placeholder="Name (e.g. Jaipur jaali)" onChange={e => setMotif(i, { name: e.target.value })} data-testid={`input-design-own-motif-${i}`} />
                <Input value={m.meaning} maxLength={120} placeholder="One line shoppers read (what it stands for)" onChange={e => setMotif(i, { meaning: e.target.value })} />
                <div className="flex flex-wrap gap-1.5">
                  {OCCASIONS.map(o => {
                    const on = m.occasions.includes(o);
                    return (
                      <button
                        key={o} type="button" onClick={() => setMotif(i, { occasions: on ? m.occasions.filter(x => x !== o) : [...m.occasions, o] })}
                        className={`rounded-full border px-2 py-0.5 text-[11.5px] ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600"}`}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => set({ customMotifs: form.customMotifs.filter((_, x) => x !== i) })} aria-label="Remove motif"><Trash2 className="h-4 w-4 text-gray-500" /></Button>
            </div>
          ))}
          {form.customMotifs.length < MAX_CUSTOM_MOTIFS && (
            <Button variant="outline" size="sm" onClick={() => set({ customMotifs: [...form.customMotifs, { id: "", name: "", meaning: "", occasions: [] }] })} data-testid="button-design-add-motif">
              <Plus className="mr-1.5 h-4 w-4" /> Add a motif
            </Button>
          )}
          <input ref={motifInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { addPhoto(e.target.files?.[0], "motif"); e.target.value = ""; }} />
        </div>
      </Section>

      <Section title="Metals, stones and prices" hint="Used to estimate a price range for each design. Shoppers see no prices until you switch them on below.">
        <div>
          <div className="mb-1 grid grid-cols-[1fr_130px_44px] gap-2 text-[11.5px] font-medium uppercase tracking-wide text-gray-500"><span>Metal</span><span>Price per gram</span><span>On</span></div>
          {form.metals.map((m, i) => (
            <div key={m.id} className="grid grid-cols-[1fr_130px_44px] items-center gap-2 py-1">
              <span className="text-[13.5px] text-gray-800">{m.name}</span>
              <Input
                type="number" min={0} value={m.ratePerGram || ""} placeholder="0" data-testid={`input-design-rate-${m.id}`}
                onChange={e => set({ metals: form.metals.map((x, xi) => (xi === i ? { ...x, ratePerGram: number(e.target.value) } : x)) })}
              />
              <Switch checked={m.enabled} onCheckedChange={v => set({ metals: form.metals.map((x, xi) => (xi === i ? { ...x, enabled: v } : x)) })} />
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 grid grid-cols-[1fr_130px_44px] gap-2 text-[11.5px] font-medium uppercase tracking-wide text-gray-500"><span>Stone</span><span>Price per small stone</span><span>On</span></div>
          {form.stones.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[1fr_130px_44px] items-center gap-2 py-1">
              <span className="text-[13.5px] text-gray-800">{s.name}</span>
              <Input
                type="number" min={0} value={s.pricePerStone || ""} placeholder="0" data-testid={`input-design-stone-${s.id}`}
                onChange={e => set({ stones: form.stones.map((x, xi) => (xi === i ? { ...x, pricePerStone: number(e.target.value) } : x)) })}
              />
              <Switch checked={s.enabled} onCheckedChange={v => set({ stones: form.stones.map((x, xi) => (xi === i ? { ...x, enabled: v } : x)) })} />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><Label>Making charge %</Label><Input type="number" min={0} max={100} value={form.makingChargePercent} onChange={e => set({ makingChargePercent: number(e.target.value) })} /></div>
          <div><Label>Smallest order</Label><Input type="number" min={0} value={form.minOrderValue || ""} placeholder="0" onChange={e => set({ minOrderValue: number(e.target.value) })} /></div>
          <div><Label>Made in (days, from)</Label><Input type="number" min={1} value={form.makingDays.min} onChange={e => set({ makingDays: { ...form.makingDays, min: number(e.target.value) || 1 } })} /></div>
          <div><Label>to</Label><Input type="number" min={1} value={form.makingDays.max} onChange={e => set({ makingDays: { ...form.makingDays, max: number(e.target.value) || 1 } })} /></div>
        </div>
        <details className="rounded-xl border border-gray-200 p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-gray-800">Typical weights (grams)</summary>
          <p className="mt-1 text-[12.5px] text-gray-500">The lightest and heaviest you usually make of each piece. Delicate, Classic and Statement split this range into three.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PIECES.filter(p => form.pieces.includes(p.id)).map(p => (
              <div key={p.id} className="grid grid-cols-[1fr_80px_80px] items-center gap-2">
                <span className="text-[13.5px] text-gray-800">{p.name}</span>
                <Input type="number" min={0} step="0.5" value={form.pieceWeights[p.id].min} onChange={e => set({ pieceWeights: { ...form.pieceWeights, [p.id]: { ...form.pieceWeights[p.id], min: number(e.target.value) } } })} />
                <Input type="number" min={0} step="0.5" value={form.pieceWeights[p.id].max} onChange={e => set({ pieceWeights: { ...form.pieceWeights, [p.id]: { ...form.pieceWeights[p.id], max: number(e.target.value) } } })} />
              </div>
            ))}
          </div>
        </details>
        <div className="rounded-xl bg-gray-50 p-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[13.5px] font-medium text-gray-900">Show estimated prices to shoppers</span>
              <span className="block text-[12.5px] text-gray-500">Off: designs say "Quoted by our designer". Switch on once the prices above are yours.</span>
            </span>
            <Switch checked={form.ratesConfirmed} onCheckedChange={v => set({ ratesConfirmed: v })} data-testid="switch-design-prices" />
          </label>
          {form.ratesConfirmed && missingRates.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-amber-700"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No price per gram yet for {missingRates.join(", ")}: designs in {missingRates.length === 1 ? "it" : "them"} show no estimate.</p>
          )}
          {sample && <p className="mt-2 text-[12.5px] text-gray-600" data-testid="text-design-sample-price">{sample}</p>}
        </div>
      </Section>

      <Section title="Your style" hint={`Up to ${MAX_STYLE_PHOTOS} photos of pieces you've made. Designs follow their finish and taste, so they look like your work.`}>
        <div className="flex flex-wrap gap-2">
          {form.stylePhotos.map(url => (
            <div key={url} className="group relative h-24 w-24 overflow-hidden rounded-xl border border-gray-200">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => set({ stylePhotos: form.stylePhotos.filter(u => u !== url) })} aria-label="Remove photo" className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {form.stylePhotos.length < MAX_STYLE_PHOTOS && (
            <button type="button" onClick={() => styleInput.current?.click()} className="grid h-24 w-24 place-items-center rounded-xl border border-dashed border-gray-300 text-gray-400 hover:border-gray-400" data-testid="button-design-add-style-photo">
              {uploading === "style" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            </button>
          )}
          <input ref={styleInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { addPhoto(e.target.files?.[0], "style"); e.target.value = ""; }} />
        </div>
        <div>
          <Label>Your style in a few words</Label>
          <Textarea rows={2} maxLength={200} value={form.styleNote} placeholder="e.g. minimal and delicate, everyday wear, fine pavé work" onChange={e => set({ styleNote: e.target.value })} data-testid="input-design-style-note" />
        </div>
      </Section>

      <Section title="Limits" hint="Every design image costs a little on your AI key. These keep it in check.">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[13.5px] text-gray-800">Ask for name and mobile number before changes</span>
            <span className="block text-[12.5px] text-gray-500">The first three designs are free to see. Changing one needs the shopper's details, which also become a lead.</span>
          </span>
          <Switch checked={form.contactBeforeChanges} onCheckedChange={v => set({ contactBeforeChanges: v })} data-testid="switch-design-contact" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Images per shopper</Label><Input type="number" min={3} max={40} value={form.maxRendersPerSession} onChange={e => set({ maxRendersPerSession: number(e.target.value) })} /></div>
          <div><Label>Images per day (all shoppers)</Label><Input type="number" min={3} value={form.dailyRenderCap} onChange={e => set({ dailyRenderCap: number(e.target.value) })} /></div>
          <div>
            <Label>Image AI</Label>
            <Select value={form.imageProvider} onValueChange={v => set({ imageProvider: v as "google" | "openai" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="google">Google Gemini (recommended)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={() => save.mutate(form)} disabled={!dirty || save.isPending} className="shadow-lg" data-testid="button-design-save">
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
        </Button>
      </div>
    </div>
  );
}
