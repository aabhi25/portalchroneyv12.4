import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Plus, Trash2, Globe, Pencil, Download, FileSpreadsheet } from "lucide-react";
import { ImportContactsDialog } from "@/components/whatsapp/ImportContactsDialog";
import { downloadContactSampleWorkbook } from "@/lib/contactSampleWorkbook";

interface Contact {
  id: string;
  phone: string;
  name: string;
  attributes: Record<string, string>;
}

const COUNTRY_CODE_OPTIONS: { code: string; label: string }[] = [
  { code: "91", label: "🇮🇳 India (+91)" },
  { code: "1", label: "🇺🇸 US / 🇨🇦 Canada (+1)" },
  { code: "44", label: "🇬🇧 UK (+44)" },
  { code: "971", label: "🇦🇪 UAE (+971)" },
  { code: "966", label: "🇸🇦 Saudi Arabia (+966)" },
  { code: "65", label: "🇸🇬 Singapore (+65)" },
  { code: "61", label: "🇦🇺 Australia (+61)" },
  { code: "60", label: "🇲🇾 Malaysia (+60)" },
  { code: "62", label: "🇮🇩 Indonesia (+62)" },
  { code: "63", label: "🇵🇭 Philippines (+63)" },
  { code: "880", label: "🇧🇩 Bangladesh (+880)" },
  { code: "94", label: "🇱🇰 Sri Lanka (+94)" },
  { code: "92", label: "🇵🇰 Pakistan (+92)" },
  { code: "977", label: "🇳🇵 Nepal (+977)" },
  { code: "49", label: "🇩🇪 Germany (+49)" },
  { code: "33", label: "🇫🇷 France (+33)" },
  { code: "39", label: "🇮🇹 Italy (+39)" },
  { code: "34", label: "🇪🇸 Spain (+34)" },
  { code: "55", label: "🇧🇷 Brazil (+55)" },
  { code: "52", label: "🇲🇽 Mexico (+52)" },
];
const MIXED_VALUE = "__mixed__";

export default function WhatsAppContactGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editName, setEditName] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);

  const { data: group } = useQuery<any>({ queryKey: [`/api/whatsapp/contact-groups/${id}`] });
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: [`/api/whatsapp/contact-groups/${id}/contacts`],
  });

  const addMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/whatsapp/contact-groups/${id}/contacts`, { phone: newPhone, name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}/contacts`] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}`] });
      setAddOpen(false); setNewPhone(""); setNewName("");
      toast({ title: "Contact added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async () =>
      apiRequest("PATCH", `/api/whatsapp/contact-groups/${id}/contacts/${editContact!.id}`, {
        phone: editPhone,
        name: editName,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}/contacts`] });
      setEditOpen(false);
      setEditContact(null);
      toast({ title: "Contact updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (contactId: string) => apiRequest("DELETE", `/api/whatsapp/contact-groups/${id}/contacts/${contactId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}/contacts`] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}`] });
    },
  });

  const countryMutation = useMutation({
    mutationFn: async (defaultCountryCode: string | null) =>
      apiRequest("PATCH", `/api/whatsapp/contact-groups/${id}`, { defaultCountryCode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/contact-groups"] });
      toast({ title: "Default country code updated" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const currentCode: string | null = group?.defaultCountryCode ?? null;
  const isMixed = !currentCode;
  const onCountryChange = (val: string) => {
    countryMutation.mutate(val === MIXED_VALUE ? null : val);
  };
  const minPhoneDigits = isMixed ? 11 : 1;
  const phoneDigits = newPhone.replace(/\D/g, "").length;
  const phoneInvalid = newPhone.trim().length > 0 && phoneDigits < minPhoneDigits;

  const editPhoneDigits = editPhone.replace(/\D/g, "").length;
  const editPhoneInvalid = editPhone.trim().length > 0 && editPhoneDigits < minPhoneDigits;

  const openEdit = (c: Contact) => {
    setEditContact(c);
    setEditPhone(c.phone);
    setEditName(c.name || "");
    setEditOpen(true);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => setLocation("/admin/whatsapp-contact-groups")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Groups
      </Button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{group?.name || "Loading..."}</h1>
          {group?.description && <p className="text-sm text-gray-600 mt-1">{group.description}</p>}
          <p className="text-xs text-gray-500 mt-1">{contacts.length} contacts loaded</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-contacts">
            <Upload className="h-4 w-4 mr-1" /> Import contacts
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-contact">
            <Plus className="h-4 w-4 mr-1" /> Add Contact
          </Button>
        </div>
      </div>

      <ImportContactsDialog
        groupId={id!}
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultCountryCode={currentCode || null}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}/contacts`] });
          queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}`] });
          queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/contact-groups"] });
        }}
      />

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-500" /> Default country code
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <Select
              value={currentCode || MIXED_VALUE}
              onValueChange={onCountryChange}
              disabled={countryMutation.isPending}
            >
              <SelectTrigger className="w-72" data-testid="select-default-country-code">
                <SelectValue placeholder="Choose a default country code" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MIXED_VALUE}>Mixed (numbers must include country code)</SelectItem>
                {COUNTRY_CODE_OPTIONS.map(opt => (
                  <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isMixed ? (
            <p className="text-xs text-amber-700">
              Mixed mode: every phone in this group must include its country code (e.g. <code className="bg-gray-100 px-1 rounded">919810560800</code>). Recipients without a country code will be marked failed at send time instead of being delivered.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Local phones in this group are sent as <code className="bg-gray-100 px-1 rounded">+{currentCode}&lt;number&gt;</code>. You can paste numbers with or without the country code — short numbers will be auto-prefixed at send time.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-gray-500" /> File format
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-3">
          <p>
            Upload an Excel file (<code className="bg-gray-100 px-1 rounded">.xlsx</code>) or a CSV. First row = headers.
            Required column: <code className="bg-gray-100 px-1 rounded">phone</code> (also accepts <code className="bg-gray-100 px-1 rounded">mobile</code>, <code className="bg-gray-100 px-1 rounded">number</code>, <code className="bg-gray-100 px-1 rounded">whatsapp</code>). Optional: <code className="bg-gray-100 px-1 rounded">name</code>. Any other columns become per-contact details (e.g. city, plan) usable as <code className="bg-gray-100 px-1 rounded">{`{{city}}`}</code> placeholders in campaign templates, and readable by the AI when it replies.
            {isMixed
              ? " Each phone must include its country code in Mixed mode."
              : ` Phones may be entered with or without the +${currentCode} country code.`}
          </p>
          <p className="text-xs text-gray-500">
            You'll see a full review — what will be imported, what will be skipped and why — before anything is saved.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadContactSampleWorkbook(currentCode || null)}
            data-testid="button-download-sample-format"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" /> Download sample Excel file
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : contacts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No contacts yet. Import an Excel or CSV file, or add one manually.</div>
          ) : (
            <div className="divide-y">
              {contacts.map(c => (
                <div key={c.id} className="px-4 py-3 flex items-center gap-3" data-testid={`row-contact-${c.id}`}>
                  <div className="flex-1">
                    <div className="font-mono text-sm">{c.phone}</div>
                    {c.name && <div className="text-sm text-gray-700">{c.name}</div>}
                    {Object.keys(c.attributes || {}).length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {Object.entries(c.attributes).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)} data-testid={`button-edit-${c.id}`}>
                    <Pencil className="h-4 w-4 text-gray-500" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c)} data-testid={`button-remove-${c.id}`}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Contact Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder={isMixed ? "919810560800 (must include country code)" : "9810560800 — auto-prefixed with +" + currentCode}
                data-testid="input-new-phone"
              />
              {phoneInvalid && (
                <p className="text-xs text-red-600 mt-1" data-testid="text-phone-validation">
                  Mixed mode requires the country code. Enter at least 11 digits (e.g. 919810560800).
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Name (optional)</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} data-testid="input-new-name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={!newPhone.trim() || phoneInvalid || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>Remove <span className="font-mono font-medium">{deleteTarget.phone}</span>{deleteTarget.name ? ` (${deleteTarget.name})` : ""} from this group? This cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (deleteTarget) { removeMutation.mutate(deleteTarget.id); setDeleteTarget(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Contact Dialog */}
      <Dialog open={editOpen} onOpenChange={open => { setEditOpen(open); if (!open) setEditContact(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                placeholder={isMixed ? "919810560800 (must include country code)" : "9810560800"}
                data-testid="input-edit-phone"
              />
              {editPhoneInvalid && (
                <p className="text-xs text-red-600 mt-1">
                  Mixed mode requires the country code. Enter at least 11 digits (e.g. 919810560800).
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Name (optional)</label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} data-testid="input-edit-name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditContact(null); }}>Cancel</Button>
            <Button
              disabled={!editPhone.trim() || editPhoneInvalid || editMutation.isPending}
              onClick={() => editMutation.mutate()}
            >
              {editMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
