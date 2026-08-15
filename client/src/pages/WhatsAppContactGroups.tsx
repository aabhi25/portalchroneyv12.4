import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Trash2, ChevronRight } from "lucide-react";

interface ContactGroup {
  id: string;
  name: string;
  description: string;
  contactCount: number;
  updatedAt: string;
}

export default function WhatsAppContactGroups() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: groups = [], isLoading } = useQuery<ContactGroup[]>({
    queryKey: ["/api/whatsapp/contact-groups"],
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; description: string }) => {
      return await apiRequest("POST", "/api/whatsapp/contact-groups", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/contact-groups"] });
      setOpen(false); setName(""); setDescription("");
      toast({ title: "Contact group created" });
    },
    onError: (e: any) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/whatsapp/contact-groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/contact-groups"] });
      toast({ title: "Contact group deleted" });
    },
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-teal-600" />
            Contact Groups
          </h1>
          <p className="text-sm text-gray-600 mt-1">Audiences for WhatsApp marketing campaigns. Import via CSV.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-contact-group"><Plus className="h-4 w-4 mr-1" /> New Group</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create contact group</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="VIP customers" data-testid="input-group-name" />
              </div>
              <div>
                <label className="text-sm font-medium">Description (optional)</label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" rows={3} data-testid="input-group-description" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate({ name: name.trim(), description })} data-testid="button-create-group">
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading...</div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            No contact groups yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {groups.map(g => (
            <Card key={g.id} className="hover:shadow-md transition-shadow cursor-pointer" data-testid={`card-group-${g.id}`}>
              <CardContent className="p-4 flex items-center justify-between" onClick={() => setLocation(`/admin/whatsapp-contact-groups/${g.id}`)}>
                <div className="flex-1">
                  <div className="font-semibold">{g.name}</div>
                  {g.description && <div className="text-sm text-gray-600 mt-0.5">{g.description}</div>}
                  <div className="text-xs text-gray-500 mt-1">{g.contactCount} contacts</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${g.name}" and all its contacts?`)) deleteMutation.mutate(g.id); }}
                    data-testid={`button-delete-group-${g.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
