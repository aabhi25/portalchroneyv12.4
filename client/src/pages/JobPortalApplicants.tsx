import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, UserCircle, Mail, Phone, FileText, Eye } from "lucide-react";

interface Applicant {
  id: string;
  businessAccountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  resumeUrl: string | null;
  resumeText: string | null;
  skills: string[];
  experienceSummary: string | null;
  source: string;
  conversationId: string | null;
  createdAt: string;
  applications: Array<{
    id: string;
    jobId: string;
    status: string;
    matchScore: string | null;
    appliedAt: string;
  }>;
}

interface ApplicationWithJob {
  id: string;
  jobId: string;
  applicantId: string;
  businessAccountId: string;
  status: string;
  matchScore: string | null;
  appliedAt: string;
  updatedAt: string;
  jobTitle: string;
  applicantName: string;
  applicantEmail: string | null;
}

interface ApplicantDetail extends Applicant {
  applications: ApplicationWithJob[];
}

export default function JobPortalApplicants() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [editingApplicant, setEditingApplicant] = useState<Applicant | null>(null);
  const [viewingApplicant, setViewingApplicant] = useState<ApplicantDetail | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [applicantToDelete, setApplicantToDelete] = useState<Applicant | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [experienceSummary, setExperienceSummary] = useState("");

  const { data: applicants = [], isLoading } = useQuery<Applicant[]>({
    queryKey: ["/api/applicants", search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      return apiRequest("GET", `/api/applicants?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; email?: string; phone?: string; skills?: string[]; experienceSummary?: string }) => apiRequest("POST", "/api/applicants", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applicants"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Applicant Added", description: "The applicant has been added." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; email?: string; phone?: string; skills?: string[]; experienceSummary?: string }) => apiRequest("PUT", `/api/applicants/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applicants"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Applicant Updated", description: "The applicant has been updated." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/applicants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applicants"] });
      setDeleteDialogOpen(false);
      toast({ title: "Applicant Deleted", description: "The applicant has been deleted." });
    },
  });

  function resetForm() {
    setName("");
    setEmail("");
    setPhone("");
    setSkillsInput("");
    setExperienceSummary("");
    setEditingApplicant(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(applicant: Applicant) {
    setEditingApplicant(applicant);
    setName(applicant.name);
    setEmail(applicant.email || "");
    setPhone(applicant.phone || "");
    setSkillsInput((applicant.skills || []).join(", "));
    setExperienceSummary(applicant.experienceSummary || "");
    setDialogOpen(true);
  }

  async function openDetail(applicant: Applicant) {
    try {
      const detail = await apiRequest<ApplicantDetail>("GET", `/api/applicants/${applicant.id}`);
      setViewingApplicant(detail);
      setDetailDialogOpen(true);
    } catch {
      toast({ title: "Error", description: "Failed to load applicant details.", variant: "destructive" });
    }
  }

  function handleSave() {
    const skills = skillsInput.split(",").map(s => s.trim()).filter(Boolean);
    const data = {
      name,
      email: email || null,
      phone: phone || null,
      skills,
      experienceSummary: experienceSummary || null,
    };
    if (editingApplicant) {
      updateMutation.mutate({ id: editingApplicant.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  }

  const sourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      manual: "bg-gray-100 text-gray-600",
      chat: "bg-blue-100 text-blue-700",
      import: "bg-purple-100 text-purple-700",
    };
    return <Badge className={colors[source] || "bg-gray-100 text-gray-600"}>{source}</Badge>;
  };

  const appStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      new: "bg-blue-100 text-blue-700",
      reviewing: "bg-yellow-100 text-yellow-700",
      shortlisted: "bg-green-100 text-green-700",
      rejected: "bg-red-100 text-red-700",
      hired: "bg-emerald-100 text-emerald-800",
    };
    return <Badge className={colors[status] || "bg-gray-100 text-gray-600"}>{status}</Badge>;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCircle className="w-6 h-6 text-cyan-600" />
            Applicants
          </h1>
          <p className="text-sm text-gray-500 mt-1">{applicants.length} applicant{applicants.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={openCreate} className="bg-gradient-to-r from-cyan-600 to-blue-600">
          <Plus className="w-4 h-4 mr-2" /> Add Applicant
        </Button>
      </div>

      <div className="relative max-w-sm mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search applicants..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : applicants.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <UserCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No applicants yet</p>
          <p className="text-sm">Applicants will appear here when they apply through chat or are added manually.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {applicants.map(applicant => (
            <div key={applicant.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-base">{applicant.name}</h3>
                    {sourceBadge(applicant.source)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                    {applicant.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5" /> {applicant.email}
                      </span>
                    )}
                    {applicant.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" /> {applicant.phone}
                      </span>
                    )}
                    {applicant.resumeUrl && (
                      <a
                        href={applicant.resumeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FileText className="w-3.5 h-3.5" /> Download Resume
                      </a>
                    )}
                  </div>
                  {applicant.skills && applicant.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {applicant.skills.slice(0, 6).map((skill, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{skill}</Badge>
                      ))}
                      {applicant.skills.length > 6 && <Badge variant="secondary" className="text-xs">+{applicant.skills.length - 6}</Badge>}
                    </div>
                  )}
                  {applicant.applications && applicant.applications.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2">
                      Applied to {applicant.applications.length} job{applicant.applications.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 ml-3">
                  <Button variant="ghost" size="icon" onClick={() => openDetail(applicant)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(applicant)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => { setApplicantToDelete(applicant); setDeleteDialogOpen(true); }}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) { setDialogOpen(false); resetForm(); } else setDialogOpen(true); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingApplicant ? "Edit Applicant" : "Add Applicant"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 9876543210" />
              </div>
            </div>
            <div>
              <Label>Skills (comma-separated)</Label>
              <Input value={skillsInput} onChange={e => setSkillsInput(e.target.value)} placeholder="e.g. Python, SQL, Data Analysis" />
            </div>
            <div>
              <Label>Experience Summary</Label>
              <Textarea value={experienceSummary} onChange={e => setExperienceSummary(e.target.value)} rows={3} placeholder="Brief experience summary..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
                className="bg-gradient-to-r from-cyan-600 to-blue-600"
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingApplicant ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Applicant Details</DialogTitle>
          </DialogHeader>
          {viewingApplicant && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg">{viewingApplicant.name}</h3>
                <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                  {viewingApplicant.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {viewingApplicant.email}</span>}
                  {viewingApplicant.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {viewingApplicant.phone}</span>}
                </div>
              </div>
              {viewingApplicant.experienceSummary && (
                <div>
                  <Label className="text-xs text-gray-500">Experience</Label>
                  <p className="text-sm">{viewingApplicant.experienceSummary}</p>
                </div>
              )}
              {viewingApplicant.skills && viewingApplicant.skills.length > 0 && (
                <div>
                  <Label className="text-xs text-gray-500">Skills</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {viewingApplicant.skills.map((skill, i) => (
                      <Badge key={i} variant="secondary">{skill}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {viewingApplicant.applications && viewingApplicant.applications.length > 0 && (
                <div>
                  <Label className="text-xs text-gray-500">Applied Jobs</Label>
                  <div className="space-y-2 mt-1">
                    {viewingApplicant.applications.map((app: ApplicationWithJob) => (
                      <div key={app.id} className="flex items-center justify-between border rounded p-2 text-sm">
                        <span className="font-medium">{app.jobTitle}</span>
                        {appStatusBadge(app.status)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {viewingApplicant.resumeUrl && (
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">Resume</Label>
                  <a
                    href={viewingApplicant.resumeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md text-sm font-medium transition-colors"
                  >
                    <FileText className="w-4 h-4" /> View / Download Resume
                  </a>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Applicant</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{applicantToDelete?.name}"? This will also remove all their job applications.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => applicantToDelete && deleteMutation.mutate(applicantToDelete.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
