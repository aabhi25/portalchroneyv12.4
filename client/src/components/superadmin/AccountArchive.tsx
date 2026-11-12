import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArchiveRestore, Loader2, Lock, LockOpen } from "lucide-react";
import type { BusinessAccountDto } from "@shared/dto/businessAccount";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Archived accounts (super admin): accounts hidden behind a separate Archive password.
 * Server side: server/routes/accountArchive.ts and server/services/accountArchive.ts.
 */

export interface ArchiveStatus {
  passwordSet: boolean;
  unlocked: boolean;
  unlockedUntil: string | null;
  lockedOutMinutes: number;
}

export const archiveStatusKey = ["/api/super-admin/archive/status"];
const archivedListKey = ["/api/super-admin/archive/accounts"];
const MIN_LENGTH = 8;

/** Where the Archived list stands; refetches by itself the moment an unlock runs out. */
export function useArchiveStatus() {
  const status = useQuery<ArchiveStatus>({ queryKey: archiveStatusKey, staleTime: 0 });
  const until = status.data?.unlockedUntil;
  useEffect(() => {
    if (!until) return;
    const ms = new Date(until).getTime() - Date.now();
    const t = setTimeout(() => refreshArchive(), Math.max(ms, 0) + 500);
    return () => clearTimeout(t);
  }, [until]);
  return status;
}

/** After archive / unarchive / lock: every account list, report and the archive itself. */
function refreshArchive() {
  queryClient.invalidateQueries({ queryKey: archiveStatusKey });
  queryClient.invalidateQueries({ queryKey: archivedListKey });
  queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] });
  queryClient.invalidateQueries({ queryKey: ["/api/super-admin/mis"] });
  queryClient.invalidateQueries({ queryKey: ["/api/super-admin/usage"] });
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? <p className="text-sm text-red-600" role="alert">{text}</p> : null;
}

/**
 * Set the Archive password (first time: confirmed with the login password) or change it
 * (with the current one). Used in My account and, the first time, before archiving or unlocking.
 */
export function ArchivePasswordForm({ passwordSet, onDone }: { passwordSet: boolean; onDone?: () => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiRequest("POST", "/api/super-admin/archive/password", passwordSet
      ? { currentPassword: current, newPassword: next }
      : { loginPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent(""); setNext(""); setConfirm(""); setError(null);
      refreshArchive();
      toast({ title: passwordSet ? "Archive password changed" : "Archive password set", description: passwordSet ? "The Archived list is locked; unlock it with the new password." : undefined });
      onDone?.();
    },
    onError: (e: Error) => setError(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters`);
    if (next !== confirm) return setError("The two new passwords don't match");
    setError(null);
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
      <div>
        <Label htmlFor="archive-current">{passwordSet ? "Current Archive password" : "Your login password"}</Label>
        <Input id="archive-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="mt-1.5" required data-testid="input-archive-current" />
        {!passwordSet && <p className="mt-1 text-xs text-gray-500">To confirm it's you.</p>}
      </div>
      <div>
        <Label htmlFor="archive-new">New Archive password</Label>
        <Input id="archive-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="mt-1.5" required placeholder={`At least ${MIN_LENGTH} characters`} data-testid="input-archive-new" />
      </div>
      <div>
        <Label htmlFor="archive-confirm">Type it again</Label>
        <Input id="archive-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1.5" required data-testid="input-archive-confirm" />
      </div>
      <ErrorLine text={error} />
      <Button type="submit" disabled={save.isPending} data-testid="button-archive-password-save">
        {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        {passwordSet ? "Change Archive password" : "Set Archive password"}
      </Button>
      <p className="text-xs text-gray-500">Keep it somewhere safe: there is no "forgot password". If it's lost, it can only be cleared from the server.</p>
    </form>
  );
}

/** One password box: unlock the Archived list, or confirm archiving an account. Sets the password first if there is none. */
function PasswordDialog({ open, onOpenChange, title, description, actionLabel, run, onDone }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; actionLabel: string;
  run: (password: string) => Promise<unknown>; onDone: () => void;
}) {
  const status = useArchiveStatus();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!open) { setPassword(""); setError(null); } }, [open]);
  const go = useMutation({
    mutationFn: () => run(password),
    onSuccess: () => { refreshArchive(); onOpenChange(false); onDone(); },
    onError: (e: Error) => { setError(e.message); setPassword(""); },
  });
  const needsPassword = status.data && !status.data.passwordSet;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4 text-gray-500" />{needsPassword ? "Set your Archive password" : title}</DialogTitle>
          <DialogDescription>
            {needsPassword
              ? "Archived accounts are locked with their own password. Set it once; you'll use it to archive accounts and to open the Archived list."
              : description}
          </DialogDescription>
        </DialogHeader>
        {status.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : needsPassword ? (
          <ArchivePasswordForm passwordSet={false} />
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (password) go.mutate(); }} className="space-y-3">
            <div>
              <Label htmlFor="archive-password">Archive password</Label>
              <Input id="archive-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" data-testid="input-archive-password" />
            </div>
            <ErrorLine text={error ?? (status.data?.lockedOutMinutes ? `Too many wrong passwords. Try again in ${status.data.lockedOutMinutes} minute${status.data.lockedOutMinutes === 1 ? "" : "s"}.` : null)} />
            <Button type="submit" className="w-full" disabled={!password || go.isPending} data-testid="button-archive-password-submit">
              {go.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{actionLabel}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveUnlockDialog({ open, onOpenChange, onUnlocked }: { open: boolean; onOpenChange: (open: boolean) => void; onUnlocked: () => void }) {
  return (
    <PasswordDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open the Archived list"
      description="Enter the Archive password. The list locks again after 15 minutes."
      actionLabel="Unlock"
      run={(password) => apiRequest("POST", "/api/super-admin/archive/unlock", { password })}
      onDone={onUnlocked}
    />
  );
}

export function ArchiveAccountDialog({ account, onOpenChange, onArchived }: {
  account: { id: string; name: string } | null; onOpenChange: (open: boolean) => void; onArchived?: () => void;
}) {
  const { toast } = useToast();
  return (
    <PasswordDialog
      open={!!account}
      onOpenChange={onOpenChange}
      title={`Archive ${account?.name ?? "account"}?`}
      description="It disappears from every super admin screen until you open the Archived list with the Archive password. The business itself keeps working: chat, WhatsApp, calls and its logins are not affected."
      actionLabel="Archive account"
      run={(password) => apiRequest("POST", `/api/business-accounts/${account!.id}/archive`, { password })}
      onDone={() => { toast({ title: `${account?.name ?? "Account"} archived`, description: "Find it under Archived." }); onArchived?.(); }}
    />
  );
}

export async function unarchiveAccount(id: string) {
  await apiRequest("POST", `/api/super-admin/archive/accounts/${id}/unarchive`);
  refreshArchive();
}

/** The Archived list on the Accounts page (only shown while unlocked). */
export function ArchivedAccountsView({ status, onOpen }: { status: ArchiveStatus; onOpen: (id: string) => void }) {
  const { toast } = useToast();
  const list = useQuery<{ accounts: BusinessAccountDto[] }>({ queryKey: archivedListKey, enabled: status.unlocked, staleTime: 0 });
  const lock = useMutation({
    mutationFn: () => apiRequest("POST", "/api/super-admin/archive/lock"),
    onSuccess: refreshArchive,
  });
  const unarchive = useMutation({
    mutationFn: (a: BusinessAccountDto) => unarchiveAccount(a.id),
    onSuccess: (_d, a) => { toast({ title: `${a.name} unarchived`, description: "It's back in the Accounts list." }); },
    onError: (e: Error) => toast({ title: "Couldn't unarchive", description: e.message, variant: "destructive" }),
  });
  const accounts = list.data?.accounts ?? [];
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white" data-testid="archived-accounts">
      <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-5 py-3">
        <LockOpen className="h-4 w-4 text-amber-600" />
        <span className="text-[13.5px] font-medium text-gray-900">Archived accounts</span>
        {status.unlockedUntil && (
          <span className="text-[12.5px] text-gray-500">· locks again at {format(new Date(status.unlockedUntil), "h:mm a")}</span>
        )}
        <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => lock.mutate()} disabled={lock.isPending} data-testid="button-archive-lock">
          <Lock className="mr-1.5 h-3.5 w-3.5" />Lock now
        </Button>
      </div>
      {list.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : accounts.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">No archived accounts. Use "Archive account" in an account's ⋯ menu to add one.</p>
      ) : (
        <ul className="divide-y divide-black/[0.05]">
          {accounts.map(a => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid={`archived-account-${a.id}`}>
              <div className="min-w-0 flex-1">
                <button type="button" className="text-left text-[14.5px] font-medium text-gray-900 hover:text-violet-700" onClick={() => onOpen(a.id)}>{a.name}</button>
                <p className="truncate text-[12.5px] text-gray-500">
                  {a.website ? a.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "No website"}
                  {a.archivedAt && ` · archived ${format(new Date(a.archivedAt), "d MMM yyyy")}`}
                  {a.status !== "active" && " · disabled"}
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-8" onClick={() => onOpen(a.id)}>Open</Button>
              <Button variant="outline" size="sm" className="h-8" onClick={() => unarchive.mutate(a)} disabled={unarchive.isPending} data-testid={`button-unarchive-${a.id}`}>
                <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />Unarchive
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** My account › Archive password. */
export function ArchivePasswordCard() {
  const status = useArchiveStatus();
  return (
    <section className="rounded-xl border bg-white p-6" data-testid="card-archive-password">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><Lock className="h-5 w-5 text-purple-600" />Archive password</h3>
      <p className="mb-4 mt-1 text-sm text-gray-500">
        {status.data?.passwordSet
          ? "Locks the Archived accounts list. Separate from your login password."
          : "Not set yet. Set it to archive accounts and lock them away from the Accounts list and reports."}
      </p>
      {status.data && <ArchivePasswordForm passwordSet={status.data.passwordSet} />}
    </section>
  );
}
