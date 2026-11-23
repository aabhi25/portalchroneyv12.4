import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, Check, KeyRound, Loader2 } from "lucide-react";
import { AI_JOBS, AI_JOB_INFO, MODEL_CLOSES, type AiJob, type JobMove, type ModelMoveSettings, type MoveMode } from "@shared/aiModelMove";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

const URL = "/api/super-admin/model-move";
const MODES: { value: MoveMode; label: string }[] = [
  { value: "old", label: "Old model" },
  { value: "accounts", label: "New, chosen accounts" },
  { value: "new", label: "New model" },
];

interface AccountLite { id: string; name: string }
interface KeyCheck { ready: number; missing: { name: string; models: string[] }[]; refused: string[]; withoutKey: number }

const closingDay = (job: AiJob) => {
  const day = MODEL_CLOSES[AI_JOB_INFO[job].from.split(" ")[0]];
  return day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
};

function AccountsPicker({ value, accounts, onChange }: { value: string[]; accounts: AccountLite[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(value);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Popover open={open} onOpenChange={(o) => { if (o) setPicked(value); else if (picked.join() !== value.join()) onChange(picked); setOpen(o); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between font-normal" data-testid="model-move-accounts">
          <span className="truncate">{value.length === 0 ? "Choose accounts" : value.length === 1 ? accounts.find((a) => a.id === value[0])?.name ?? "1 account" : `${value.length} accounts`}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Find an account" />
          <CommandList>
            <CommandEmpty>No account found</CommandEmpty>
            {accounts.map((a) => (
              <CommandItem key={a.id} value={`${a.name} ${a.id}`} onSelect={() => toggle(a.id)}>
                <Check className={cn("mr-2 h-4 w-4", picked.includes(a.id) ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{a.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Saved when this list closes.</p>
      </PopoverContent>
    </Popover>
  );
}

/** Super admin › AI providers: which jobs use the new OpenAI models (the old ones are closing). */
export function ModelMoveCard() {
  const { toast } = useToast();
  const [saving, setSaving] = useState<AiJob | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const { data, isError } = useQuery<{ settings: ModelMoveSettings }>({ queryKey: [URL], queryFn: () => apiRequest("GET", URL) });
  const needAccounts = !!data && AI_JOBS.some((j) => data.settings[j].mode === "accounts");
  const { data: accounts = [] } = useQuery<AccountLite[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const res = await fetch("/api/business-accounts?limit=1000", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch business accounts");
      const json = await res.json();
      return json.accounts || json;
    },
    enabled: needAccounts,
    staleTime: 60_000,
  });
  const sorted = useMemo(() => [...accounts].sort((a, b) => a.name.localeCompare(b.name)), [accounts]);

  const save = async (job: AiJob, next: JobMove) => {
    setSaving(job);
    try {
      const saved = await apiRequest<{ settings: ModelMoveSettings }>("PUT", URL, { settings: { [job]: next } });
      queryClient.setQueryData([URL], saved);
      toast({ title: `${AI_JOB_INFO[job].label}: ${MODES.find((m) => m.value === next.mode)?.label.toLowerCase()}`, description: "In use within half a minute." });
    } catch (e: any) {
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await apiRequest<KeyCheck>("POST", `${URL}/key-check`));
    } catch (e: any) {
      toast({ title: "Keys not checked", description: e.message, variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card data-testid="model-move-card">
      <CardHeader>
        <CardTitle className="text-base">New OpenAI models</CardTitle>
        <CardDescription>
          OpenAI is closing the old models. Move one job at a time; switching back works until the closing day.
          A key that can't use the new model is answered by the old one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {isError && <p className="text-sm text-destructive">The switches could not be loaded.</p>}
        {data && AI_JOBS.map((job) => {
          const info = AI_JOB_INFO[job];
          const move = data.settings[job];
          return (
            <div key={job} className="grid grid-cols-1 gap-2 border-b py-3 last:border-0 sm:grid-cols-[1fr_200px]" data-testid={`model-move-${job}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{info.label}</p>
                <p className="text-xs text-muted-foreground">{info.what}</p>
                <p className="mt-1 text-xs text-muted-foreground">{info.from} → <span className="text-foreground">{info.to}</span>, old one closes {closingDay(job)}</p>
              </div>
              <div className="space-y-2">
                <Select value={move.mode} onValueChange={(v) => save(job, { ...move, mode: v as MoveMode })} disabled={saving !== null}>
                  <SelectTrigger data-testid={`model-move-mode-${job}`}>
                    {saving === job ? <Loader2 className="h-4 w-4 animate-spin" /> : <SelectValue />}
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {move.mode === "accounts" && <AccountsPicker value={move.accounts} accounts={sorted} onChange={(ids) => save(job, { mode: "accounts", accounts: ids })} />}
              </div>
            </div>
          );
        })}
        <div className="pt-3">
          <Button variant="outline" size="sm" onClick={runCheck} disabled={checking} data-testid="model-move-check">
            {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            {checking ? "Checking keys…" : "Check which keys can use the new models"}
          </Button>
          {check && (
            <div className="mt-3 space-y-1 text-sm" data-testid="model-move-check-result">
              <p>{check.ready} {check.ready === 1 ? "account" : "accounts"} ready{check.withoutKey ? `, ${check.withoutKey} without an OpenAI key` : ""}.</p>
              {check.missing.length > 0 && <p className="text-amber-700 dark:text-amber-300">Can't use a new model yet: {check.missing.map((m) => `${m.name} (${m.models.join(", ")})`).join("; ")}</p>}
              {check.refused.length > 0 && <p className="text-amber-700 dark:text-amber-300">Key not accepted by OpenAI: {check.refused.join(", ")}</p>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
