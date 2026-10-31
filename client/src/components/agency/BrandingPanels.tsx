import { useRef, useState } from "react";
import { CheckCircle2, Clock, Copy, Globe, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Panel } from "@/components/agency/agencyUi";

/** Logo and own web address panels, used on the super admin agency page and the agency's Brand page. */

export interface DomainInfo {
  name: string | null;
  status: string; // 'none' | 'pending' | 'verified'
  checkedAt: string | null;
  verifiedAt: string | null;
  message: string | null;
  target: string;
}

const LOGO_MAX = 300 * 1024;

export function LogoPanel({ logoUrl, onSave, saving, disabled }: {
  logoUrl: string | null;
  onSave: (dataUrl: string | null) => void;
  saving: boolean;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      toast({ title: "Use a PNG, JPG, WebP or SVG image", variant: "destructive" });
      return;
    }
    if (file.size > LOGO_MAX) {
      toast({ title: "The logo must be 300 KB or smaller", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onSave(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <Panel title="Logo" subtitle="Shown on the login page, in the menu, as the browser tab icon and as the chat's default picture. Square works best, up to 300 KB.">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-black/[0.06] bg-gray-50">
          {logoUrl ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" /> : <span className="text-[12px] text-gray-400">No logo</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-logo-file" />
          <Button variant="outline" onClick={() => input.current?.click()} disabled={saving || disabled}><Upload className="mr-1 h-4 w-4" />{logoUrl ? "Replace logo" : "Upload logo"}</Button>
          {logoUrl && <Button variant="ghost" onClick={() => onSave(null)} disabled={saving || disabled}>Remove</Button>}
        </div>
      </div>
      {!logoUrl && <p className="mt-3 text-[12px] text-gray-500">Without a logo, the brand's first letter is shown on its colour.</p>}
    </Panel>
  );
}

export function DomainPanel({ domain, onSave, onCheck, saving, checking, canEdit }: {
  domain: DomainInfo;
  onSave: (name: string | null) => void;
  onCheck: () => void;
  saving: boolean;
  checking: boolean;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(domain.name ?? "");
  const [copied, setCopied] = useState(false);
  const host = domain.name ?? "app.youragency.com";
  const sub = host.split(".")[0];
  const copy = () => navigator.clipboard?.writeText(domain.target).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  return (
    <Panel
      title="Own web address"
      subtitle="Clients log in at this address and the chat widget loads from it, with no mention of us."
    >
      <div className="space-y-4">
        {canEdit && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onSave(value.trim() || null); }}>
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label htmlFor="domain">Web address</Label>
              <Input id="domain" value={value} onChange={e => setValue(e.target.value)} placeholder="app.youragency.com" data-testid="input-domain" />
            </div>
            <Button type="submit" variant="outline" disabled={saving || value.trim() === (domain.name ?? "")} data-testid="button-save-domain">Save</Button>
            {domain.name && <Button type="button" variant="ghost" disabled={saving} onClick={() => { setValue(""); onSave(null); }}>Remove</Button>}
          </form>
        )}

        {domain.name ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Globe className="h-4 w-4 text-gray-500" />
              <span className="font-medium text-gray-900" data-testid="text-domain">{domain.name}</span>
              {domain.status === "verified" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Connected</span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-700"><Clock className="h-3.5 w-3.5" />Waiting for DNS</span>
              )}
              <Button size="sm" variant="outline" onClick={onCheck} disabled={checking} data-testid="button-check-domain">{checking ? "Checking…" : "Check now"}</Button>
            </div>
            {domain.message && <p className="text-[13px] text-gray-600" data-testid="text-domain-message">{domain.message}</p>}
            {domain.status !== "verified" && (
              <div className="rounded-xl bg-gray-50 p-4 text-[13px] text-gray-700">
                <p className="font-medium text-gray-900">Add this record where the domain is managed (GoDaddy, Cloudflare, Route 53…):</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-[420px] text-left">
                    <thead><tr className="text-[12px] text-gray-500"><th className="pr-6 font-medium">Type</th><th className="pr-6 font-medium">Name</th><th className="font-medium">Points to</th></tr></thead>
                    <tbody>
                      <tr className="font-mono">
                        <td className="pr-6">CNAME</td>
                        <td className="pr-6">{sub}</td>
                        <td>
                          <span className="select-all">{domain.target}</span>
                          <button type="button" onClick={copy} className="ml-2 align-middle text-gray-400 hover:text-gray-700" title="Copy"><Copy className="inline h-3.5 w-3.5" /></button>
                          {copied && <span className="ml-1 font-sans text-[12px] text-emerald-700">Copied</span>}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[12px] text-gray-500">DNS changes can take a few minutes to a few hours. The secure certificate is issued automatically once it's connected.</p>
              </div>
            )}
            {domain.status === "verified" && (
              <p className="text-[13px] text-gray-600">Clients can log in at <span className="select-all font-medium">https://{domain.name}</span>. New install codes load the widget from this address.</p>
            )}
          </>
        ) : (
          <p className="text-[13px] text-gray-500">{canEdit ? "No web address yet. Use a sub-domain the agency owns, such as app.agency.com." : "No web address yet. Your account manager can set one up."}</p>
        )}
      </div>
    </Panel>
  );
}
