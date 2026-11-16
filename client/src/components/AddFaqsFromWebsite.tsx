import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChannelPicker } from "@/components/ChannelPicker";
import { useToast } from "@/hooks/use-toast";
import type { KnowledgeChannel } from "@shared/knowledgeChannels";
import { AlertCircle, AlertTriangle, ArrowLeft, Globe, Loader2, Sparkles } from "lucide-react";

/** POST /api/faqs/from-website/pages and /suggest (server/services/websiteFaqs.ts). */
interface FoundPage { url: string; kind: string; label: string; picked: boolean }
interface PageList { pages: FoundPage[]; source: "sitemap" | "links"; defaultPick: number; maxPick: number }
interface Suggestion { question: string; answer: string; category: string; source: "exact" | "ai"; pageUrl: string; duplicateOf?: string }
interface Suggestions { suggestions: Suggestion[]; pagesRead: number; pagesFailed: { url: string; reason: string }[]; aiUnavailable?: boolean }

type Draft = Suggestion & { keep: boolean };

const pathOf = (url: string) => { try { return new URL(url).pathname || "/"; } catch { return url; } };

/**
 * Training › FAQs › "Add from website": pick the website's pages, get FAQ suggestions (the website's own
 * questions word for word, or written by AI from a page's text), review / edit them, add the ticked ones.
 */
export default function AddFaqsFromWebsite({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [channels, setChannels] = useState<KnowledgeChannel[] | null>(null);

  const pagesMutation = useMutation({
    mutationFn: () => apiRequest<PageList>("POST", "/api/faqs/from-website/pages"),
    onSuccess: (r) => setChosen(new Set(r.pages.filter(p => p.picked).map(p => p.url))),
  });
  const suggestMutation = useMutation({
    mutationFn: (pages: string[]) => apiRequest<Suggestions>("POST", "/api/faqs/from-website/suggest", { pages }),
    onSuccess: (r) => setDrafts(r.suggestions.map(s => ({ ...s, keep: !s.duplicateOf }))),
  });
  const addMutation = useMutation({
    mutationFn: (faqs: { question: string; answer: string; category: string; channels: KnowledgeChannel[] | null }[]) =>
      apiRequest<{ count: number }>("POST", "/api/faqs/bulk", { faqs }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/faqs"] });
      toast({ title: "FAQs added", description: `${r.count} ${r.count === 1 ? "FAQ was" : "FAQs were"} added from the website.` });
      close(false);
    },
    onError: (e: Error) => toast({ title: "Couldn't add the FAQs", description: e.message, variant: "destructive" }),
  });

  // Opening starts over: look through the website again.
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setDrafts(null);
      setChannels(null);
      pagesMutation.reset();
      suggestMutation.reset();
    }
  };
  useEffect(() => {
    if (open && pagesMutation.isIdle) pagesMutation.mutate();
  }, [open, pagesMutation.isIdle]);

  const toggle = (url: string) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(url)) next.delete(url); else next.add(url);
    return next;
  });
  const edit = (i: number, patch: Partial<Draft>) => setDrafts(prev => prev && prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const list = pagesMutation.data;
  const result = suggestMutation.data;
  const kept = (drafts ?? []).filter(d => d.keep && d.question.trim() && d.answer.trim());
  const tooMany = !!list && chosen.size > list.maxPick;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col" data-testid="dialog-faqs-from-website">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Globe className="h-5 w-5 text-purple-600" /> Add FAQs from your website</DialogTitle>
          <DialogDescription>
            {drafts
              ? "Check the suggestions, edit any wording, untick what you don't want, then add them."
              : "Questions the website already lists are copied word for word. For pages without a question list (like a returns or shipping policy), AI writes short questions and answers from that page only."}
          </DialogDescription>
        </DialogHeader>

        {!drafts && (pagesMutation.isPending ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking through the website…</div>
        ) : pagesMutation.isError ? (
          <p className="flex items-start gap-2 py-6 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{pagesMutation.error.message}</p>
        ) : suggestMutation.isPending ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Reading {chosen.size} {chosen.size === 1 ? "page" : "pages"} and writing suggestions… this can take a minute.
          </div>
        ) : list ? (
          <>
            {suggestMutation.isError && <p className="flex items-start gap-2 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{suggestMutation.error.message}</p>}
            <p className="text-sm font-medium text-gray-700">Pages to read for FAQs</p>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-2 space-y-0.5">
              {list.pages.length === 0 && <p className="p-3 text-sm text-gray-500">No question, policy or contact pages were found on the website.</p>}
              {list.pages.map(p => (
                <div key={p.url} onClick={() => toggle(p.url)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50" data-testid={`row-faq-page-${p.kind}`}>
                  <Checkbox checked={chosen.has(p.url)} onCheckedChange={() => toggle(p.url)} onClick={(e) => e.stopPropagation()} aria-label={p.url} />
                  <span className="hidden w-32 shrink-0 sm:block"><Badge variant="outline" className="text-[11px] font-medium">{p.label}</Badge></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800" title={p.url}>{pathOf(p.url)}</span>
                    <span className="block text-[11px] text-gray-500 sm:hidden">{p.label}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {tooMany && <span className="mr-auto text-xs text-red-600">Tick at most {list.maxPick} pages.</span>}
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button
                onClick={() => suggestMutation.mutate(Array.from(chosen))}
                disabled={chosen.size === 0 || tooMany}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white"
                data-testid="button-faq-find"
              >
                <Sparkles className="mr-2 h-4 w-4" /> Find FAQs in {chosen.size} {chosen.size === 1 ? "page" : "pages"}
              </Button>
            </div>
          </>
        ) : null)}

        {drafts && result && (
          <>
            <div className="space-y-1 text-sm text-gray-600">
              <p data-testid="text-faq-suggestion-count">
                {drafts.length} {drafts.length === 1 ? "suggestion" : "suggestions"} from {result.pagesRead} {result.pagesRead === 1 ? "page" : "pages"}
                {drafts.some(d => d.duplicateOf) && <> · {drafts.filter(d => d.duplicateOf).length} you already have (unticked)</>}
              </p>
              {result.aiUnavailable && <p className="text-amber-700">This account has no AI key, so only questions the website lists itself were read.</p>}
              {result.pagesFailed.length > 0 && (
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer">{result.pagesFailed.length} {result.pagesFailed.length === 1 ? "page" : "pages"} gave no questions</summary>
                  <ul className="mt-1 list-disc pl-5">{result.pagesFailed.map(f => <li key={f.url}>{pathOf(f.url)}: {f.reason}</li>)}</ul>
                </details>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
              {drafts.length === 0 && <p className="rounded-lg border p-4 text-sm text-gray-500">No questions were found on these pages. Try other pages, or add FAQs by hand.</p>}
              {drafts.map((d, i) => (
                <div key={i} className={`rounded-lg border p-3 ${d.keep ? "border-purple-200 bg-white" : "bg-gray-50 opacity-70"}`} data-testid="card-faq-suggestion">
                  <div className="flex items-start gap-3">
                    <Checkbox className="mt-2" checked={d.keep} onCheckedChange={(v) => edit(i, { keep: v === true })} aria-label="Keep this FAQ" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input value={d.question} onChange={(e) => edit(i, { question: e.target.value })} className="font-medium" aria-label="Question" />
                      <Textarea value={d.answer} onChange={(e) => edit(i, { answer: e.target.value })} rows={2} aria-label="Answer" />
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Input value={d.category} onChange={(e) => edit(i, { category: e.target.value })} className="h-7 w-44 text-xs" aria-label="Category" />
                        {d.source === "exact"
                          ? <Badge className="border-0 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">From the website</Badge>
                          : <Badge className="border-0 bg-purple-50 text-purple-700 hover:bg-purple-50">Written by AI</Badge>}
                        <a href={d.pageUrl} target="_blank" rel="noreferrer" className="truncate text-gray-500 underline">{pathOf(d.pageUrl)}</a>
                      </div>
                      {d.duplicateOf && (
                        <p className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> You already have: “{d.duplicateOf}”</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <ChannelPicker value={channels} onChange={setChannels} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" className="mr-auto" onClick={() => { setDrafts(null); suggestMutation.reset(); }}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Pages
              </Button>
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button
                onClick={() => addMutation.mutate(kept.map(d => ({ question: d.question.trim(), answer: d.answer.trim(), category: d.category.trim() || "General", channels })))}
                disabled={kept.length === 0 || addMutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white"
                data-testid="button-faq-add-selected"
              >
                {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add {kept.length} {kept.length === 1 ? "FAQ" : "FAQs"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
