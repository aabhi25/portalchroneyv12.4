import { useState, useEffect } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Pencil, Trash2, Search, Briefcase, MapPin, Building2, Clock, Users, Download, Plug, CheckCircle2, XCircle, Loader2, RefreshCw, Sparkles } from "lucide-react";

interface Job {
  id: string;
  businessAccountId: string;
  title: string;
  description: string | null;
  requirements: string | null;
  location: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  currency: string | null;
  jobType: string;
  experienceLevel: string | null;
  department: string | null;
  skills: string[];
  externalRefId: string | null;
  source: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  applicantCount: number;
}

interface ImportConfig {
  apiUrl: string;
  authHeader?: string;
  fieldMapping: {
    title: string;
    description?: string;
    requirements?: string;
    location?: string;
    salaryMin?: string;
    salaryMax?: string;
    currency?: string;
    jobType?: string;
    experienceLevel?: string;
    department?: string;
    skills?: string;
    externalId: string;
  };
  lastSyncedAt?: string;
  lastSyncStatus?: string;
  lastSyncError?: string;
  lastSyncStats?: { created: number; updated: number; skipped: number; errors: number };
}

const JOB_TYPES = ["full-time", "part-time", "contract", "internship", "freelance"];
const EXPERIENCE_LEVELS = ["entry", "junior", "mid", "senior", "lead", "executive"];
const JOB_STATUSES = ["active", "inactive", "closed"];

export default function JobPortalJobs() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [location, setLocation] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [jobType, setJobType] = useState("full-time");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [department, setDepartment] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [jobStatus, setJobStatus] = useState("active");

  const [importApiUrl, setImportApiUrl] = useState("");
  const [importAuthHeader, setImportAuthHeader] = useState("");
  const [mapTitle, setMapTitle] = useState("title");
  const [mapDescription, setMapDescription] = useState("description");
  const [mapRequirements, setMapRequirements] = useState("");
  const [mapLocation, setMapLocation] = useState("location");
  const [mapSalaryMin, setMapSalaryMin] = useState("");
  const [mapSalaryMax, setMapSalaryMax] = useState("");
  const [mapCurrency, setMapCurrency] = useState("");
  const [mapJobType, setMapJobType] = useState("");
  const [mapExpLevel, setMapExpLevel] = useState("");
  const [mapDepartment, setMapDepartment] = useState("");
  const [mapSkills, setMapSkills] = useState("");
  const [mapExternalId, setMapExternalId] = useState("id");
  const [testResult, setTestResult] = useState<{ success: boolean; sampleCount?: number; error?: string } | null>(null);

  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ["/api/jobs", statusFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      return apiRequest("GET", `/api/jobs?${params.toString()}`);
    },
  });

  const { data: importConfigData } = useQuery<{ config: ImportConfig | null }>({
    queryKey: ["/api/job-import/config"],
    queryFn: () => apiRequest("GET", "/api/job-import/config"),
  });

  const [isSyncing, setIsSyncing] = useState(false);

  const { data: syncStatusData } = useQuery<{
    configured: boolean;
    lastSyncedAt: string | null;
    lastSyncStatus: string;
    lastSyncError: string | null;
    lastSyncStats: { created: number; updated: number; skipped: number; errors: number } | null;
  }>({
    queryKey: ["/api/job-import/status"],
    queryFn: () => apiRequest("GET", "/api/job-import/status"),
    refetchInterval: isSyncing ? 2000 : false,
  });

  useEffect(() => {
    if (syncStatusData?.lastSyncStatus === "syncing") {
      setIsSyncing(true);
    } else if (syncStatusData && syncStatusData.lastSyncStatus !== "syncing") {
      setIsSyncing(false);
    }
  }, [syncStatusData?.lastSyncStatus]);

  useEffect(() => {
    if (importConfigData?.config && importDialogOpen) {
      const c = importConfigData.config;
      setImportApiUrl(c.apiUrl || "");
      setImportAuthHeader(c.authHeader || "");
      setMapTitle(c.fieldMapping.title || "title");
      setMapDescription(c.fieldMapping.description || "");
      setMapRequirements(c.fieldMapping.requirements || "");
      setMapLocation(c.fieldMapping.location || "");
      setMapSalaryMin(c.fieldMapping.salaryMin || "");
      setMapSalaryMax(c.fieldMapping.salaryMax || "");
      setMapCurrency(c.fieldMapping.currency || "");
      setMapJobType(c.fieldMapping.jobType || "");
      setMapExpLevel(c.fieldMapping.experienceLevel || "");
      setMapDepartment(c.fieldMapping.department || "");
      setMapSkills(c.fieldMapping.skills || "");
      setMapExternalId(c.fieldMapping.externalId || "id");
    }
  }, [importConfigData, importDialogOpen]);

  const createMutation = useMutation({
    mutationFn: (data: Omit<Job, "id" | "businessAccountId" | "createdAt" | "updatedAt" | "applicantCount" | "externalRefId" | "source">) => apiRequest("POST", "/api/jobs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Job Created", description: "The job listing has been created." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<Job>) => apiRequest("PUT", `/api/jobs/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Job Updated", description: "The job listing has been updated." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/jobs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setDeleteDialogOpen(false);
      toast({ title: "Job Deleted", description: "The job listing has been deleted." });
    },
  });

  const saveImportConfigMutation = useMutation({
    mutationFn: (data: { apiUrl: string; authHeader?: string; fieldMapping: ImportConfig["fieldMapping"] }) =>
      apiRequest("POST", "/api/job-import/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-import/config"] });
      toast({ title: "Config Saved", description: "Import configuration saved successfully." });
    },
    onError: (err: unknown) => {
      const errMsg = err instanceof Error ? err.message : "Failed to save config";
      toast({ title: "Error", description: errMsg, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: (data: { apiUrl: string; authHeader?: string }) =>
      apiRequest("POST", "/api/job-import/test", data),
    onSuccess: (result: { success: boolean; sampleCount?: number; error?: string }) => {
      setTestResult(result);
    },
    onError: (err: unknown) => {
      const errMsg = err instanceof Error ? err.message : "Test failed";
      setTestResult({ success: false, error: errMsg });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => {
      setIsSyncing(true);
      return apiRequest("POST", "/api/job-import/sync");
    },
    onSuccess: (result: { success: boolean; stats?: { created: number; updated: number; skipped: number; errors: number } }) => {
      setIsSyncing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/job-import/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/job-import/status"] });
      if (result.stats) {
        toast({
          title: "Import Complete",
          description: `Created: ${result.stats.created}, Updated: ${result.stats.updated}, Skipped: ${result.stats.skipped}, Errors: ${result.stats.errors}`,
        });
      }
    },
    onError: (err: unknown) => {
      setIsSyncing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/job-import/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/job-import/status"] });
      const errMsg = err instanceof Error ? err.message : "Import failed";
      toast({ title: "Sync Failed", description: errMsg, variant: "destructive" });
    },
  });

  const loadSamplesMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/jobs/load-samples"),
    onSuccess: (result: { success: boolean; count: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Sample Jobs Loaded", description: `${result.count} sample job listings have been created.` });
    },
    onError: (err: unknown) => {
      const errMsg = err instanceof Error ? err.message : "Failed to load samples";
      toast({ title: "Error", description: errMsg, variant: "destructive" });
    },
  });

  function resetForm() {
    setTitle("");
    setDescription("");
    setRequirements("");
    setLocation("");
    setSalaryMin("");
    setSalaryMax("");
    setCurrency("INR");
    setJobType("full-time");
    setExperienceLevel("");
    setDepartment("");
    setSkillsInput("");
    setJobStatus("active");
    setEditingJob(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(job: Job) {
    setEditingJob(job);
    setTitle(job.title);
    setDescription(job.description || "");
    setRequirements(job.requirements || "");
    setLocation(job.location || "");
    setSalaryMin(job.salaryMin || "");
    setSalaryMax(job.salaryMax || "");
    setCurrency(job.currency || "INR");
    setJobType(job.jobType);
    setExperienceLevel(job.experienceLevel || "");
    setDepartment(job.department || "");
    setSkillsInput((job.skills || []).join(", "));
    setJobStatus(job.status);
    setDialogOpen(true);
  }

  function handleSave() {
    const skills = skillsInput.split(",").map(s => s.trim()).filter(Boolean);
    const data = {
      title,
      description: description || null,
      requirements: requirements || null,
      location: location || null,
      salaryMin: salaryMin || null,
      salaryMax: salaryMax || null,
      currency,
      jobType,
      experienceLevel: experienceLevel || null,
      department: department || null,
      skills,
      status: jobStatus,
    };
    if (editingJob) {
      updateMutation.mutate({ id: editingJob.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  }

  function handleSaveImportConfig() {
    const fieldMapping: ImportConfig["fieldMapping"] = {
      title: mapTitle,
      externalId: mapExternalId,
    };
    if (mapDescription) fieldMapping.description = mapDescription;
    if (mapRequirements) fieldMapping.requirements = mapRequirements;
    if (mapLocation) fieldMapping.location = mapLocation;
    if (mapSalaryMin) fieldMapping.salaryMin = mapSalaryMin;
    if (mapSalaryMax) fieldMapping.salaryMax = mapSalaryMax;
    if (mapCurrency) fieldMapping.currency = mapCurrency;
    if (mapJobType) fieldMapping.jobType = mapJobType;
    if (mapExpLevel) fieldMapping.experienceLevel = mapExpLevel;
    if (mapDepartment) fieldMapping.department = mapDepartment;
    if (mapSkills) fieldMapping.skills = mapSkills;

    saveImportConfigMutation.mutate({
      apiUrl: importApiUrl,
      authHeader: importAuthHeader || undefined,
      fieldMapping,
    });
  }

  function handleTestConnection() {
    setTestResult(null);
    testConnectionMutation.mutate({
      apiUrl: importApiUrl,
      authHeader: importAuthHeader || undefined,
    });
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-green-100 text-green-700",
      inactive: "bg-gray-100 text-gray-600",
      closed: "bg-red-100 text-red-700",
    };
    return <Badge className={colors[status] || "bg-gray-100 text-gray-600"}>{status}</Badge>;
  };

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      "full-time": "bg-blue-100 text-blue-700",
      "part-time": "bg-purple-100 text-purple-700",
      contract: "bg-orange-100 text-orange-700",
      internship: "bg-cyan-100 text-cyan-700",
      freelance: "bg-amber-100 text-amber-700",
    };
    return <Badge variant="outline" className={colors[type] || ""}>{type}</Badge>;
  };

  const importConfig = importConfigData?.config;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-cyan-600" />
            Job Listings
          </h1>
          <p className="text-sm text-gray-500 mt-1">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => loadSamplesMutation.mutate()}
            disabled={loadSamplesMutation.isPending}
          >
            {loadSamplesMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {loadSamplesMutation.isPending ? "Loading..." : "Load Sample"}
          </Button>
          <Button variant="outline" onClick={() => { setTestResult(null); setImportDialogOpen(true); }}>
            <Download className="w-4 h-4 mr-2" /> Import Jobs
          </Button>
          <Button onClick={openCreate} className="bg-gradient-to-r from-cyan-600 to-blue-600">
            <Plus className="w-4 h-4 mr-2" /> Add Job
          </Button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search jobs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {JOB_STATUSES.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No jobs yet</p>
          <p className="text-sm">Create your first job listing to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-base">{job.title}</h3>
                    {statusBadge(job.status)}
                    {typeBadge(job.jobType)}
                    {job.source === "import" && (
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-600 text-xs">Imported</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                    {job.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {job.location}
                      </span>
                    )}
                    {job.department && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" /> {job.department}
                      </span>
                    )}
                    {job.experienceLevel && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> {job.experienceLevel}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> {job.applicantCount} applicant{job.applicantCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-gray-400">
                      {new Date(job.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {job.skills && job.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {job.skills.slice(0, 5).map((skill, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{skill}</Badge>
                      ))}
                      {job.skills.length > 5 && <Badge variant="secondary" className="text-xs">+{job.skills.length - 5}</Badge>}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 ml-3">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(job)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => { setJobToDelete(job); setDeleteDialogOpen(true); }}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) { setDialogOpen(false); resetForm(); } else setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingJob ? "Edit Job" : "Create Job"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Software Engineer" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Job Type</Label>
                <Select value={jobType} onValueChange={setJobType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOB_TYPES.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={jobStatus} onValueChange={setJobStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOB_STATUSES.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Job description..." />
            </div>
            <div>
              <Label>Requirements</Label>
              <Textarea value={requirements} onChange={e => setRequirements(e.target.value)} rows={3} placeholder="Required qualifications..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Location</Label>
                <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Mumbai, Remote" />
              </div>
              <div>
                <Label>Department</Label>
                <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Engineering" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Min Salary</Label>
                <Input type="number" value={salaryMin} onChange={e => setSalaryMin(e.target.value)} placeholder="e.g. 500000" />
              </div>
              <div>
                <Label>Max Salary</Label>
                <Input type="number" value={salaryMax} onChange={e => setSalaryMax(e.target.value)} placeholder="e.g. 1000000" />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Experience Level</Label>
              <Select value={experienceLevel || "none"} onValueChange={v => setExperienceLevel(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {EXPERIENCE_LEVELS.map(l => <SelectItem key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Skills (comma-separated)</Label>
              <Input value={skillsInput} onChange={e => setSkillsInput(e.target.value)} placeholder="e.g. React, TypeScript, Node.js" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={!title.trim() || createMutation.isPending || updateMutation.isPending}
                className="bg-gradient-to-r from-cyan-600 to-blue-600"
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingJob ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-indigo-600" />
              Import Jobs from External API
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-700">
              Connect to any REST API that returns job listings as JSON. Configure the endpoint and map response fields to your job schema.
            </div>

            <div>
              <Label>API Endpoint URL *</Label>
              <Input
                value={importApiUrl}
                onChange={e => setImportApiUrl(e.target.value)}
                placeholder="https://api.example.com/jobs"
              />
            </div>

            <div>
              <Label>Authorization Header</Label>
              <Input
                value={importAuthHeader}
                onChange={e => setImportAuthHeader(e.target.value)}
                placeholder="Bearer your-api-key-here"
              />
              <p className="text-xs text-gray-400 mt-1">Leave empty if the API is public</p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={!importApiUrl.trim() || testConnectionMutation.isPending}
              >
                {testConnectionMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing...</>
                ) : (
                  <><Plug className="w-4 h-4 mr-2" /> Test Connection</>
                )}
              </Button>
              {testResult && (
                <div className={`flex items-center gap-1.5 text-sm ${testResult.success ? "text-green-600" : "text-red-600"}`}>
                  {testResult.success ? (
                    <><CheckCircle2 className="w-4 h-4" /> Connected ({testResult.sampleCount} items found)</>
                  ) : (
                    <><XCircle className="w-4 h-4" /> {testResult.error}</>
                  )}
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h3 className="font-medium text-sm mb-3">Field Mapping</h3>
              <p className="text-xs text-gray-500 mb-3">Map the JSON field names from the API response to job fields. Use dot notation for nested fields (e.g. "job.title").</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Title *</Label>
                  <Input value={mapTitle} onChange={e => setMapTitle(e.target.value)} placeholder="title" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">External ID *</Label>
                  <Input value={mapExternalId} onChange={e => setMapExternalId(e.target.value)} placeholder="id" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <Input value={mapDescription} onChange={e => setMapDescription(e.target.value)} placeholder="description" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Requirements</Label>
                  <Input value={mapRequirements} onChange={e => setMapRequirements(e.target.value)} placeholder="requirements" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Location</Label>
                  <Input value={mapLocation} onChange={e => setMapLocation(e.target.value)} placeholder="location" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Department</Label>
                  <Input value={mapDepartment} onChange={e => setMapDepartment(e.target.value)} placeholder="department" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Min Salary</Label>
                  <Input value={mapSalaryMin} onChange={e => setMapSalaryMin(e.target.value)} placeholder="salary_min" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Max Salary</Label>
                  <Input value={mapSalaryMax} onChange={e => setMapSalaryMax(e.target.value)} placeholder="salary_max" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Input value={mapCurrency} onChange={e => setMapCurrency(e.target.value)} placeholder="currency" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Job Type</Label>
                  <Input value={mapJobType} onChange={e => setMapJobType(e.target.value)} placeholder="job_type" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Experience Level</Label>
                  <Input value={mapExpLevel} onChange={e => setMapExpLevel(e.target.value)} placeholder="experience_level" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Skills</Label>
                  <Input value={mapSkills} onChange={e => setMapSkills(e.target.value)} placeholder="skills" className="h-8 text-sm" />
                </div>
              </div>
            </div>

            {syncStatusData?.lastSyncStatus === "syncing" && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Sync in progress...
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-sm text-gray-500">
                {syncStatusData?.lastSyncedAt && (
                  <span>Last synced: {new Date(syncStatusData.lastSyncedAt).toLocaleString()}</span>
                )}
                {syncStatusData?.lastSyncStats && (
                  <span className="ml-2 text-xs">
                    ({syncStatusData.lastSyncStats.created} created, {syncStatusData.lastSyncStats.updated} updated, {syncStatusData.lastSyncStats.skipped} unchanged, {syncStatusData.lastSyncStats.errors} errors)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleSaveImportConfig} disabled={!importApiUrl.trim() || !mapTitle.trim() || !mapExternalId.trim() || saveImportConfigMutation.isPending}>
                  {saveImportConfigMutation.isPending ? "Saving..." : "Save Config"}
                </Button>
                <Button
                  onClick={() => syncMutation.mutate()}
                  disabled={!importConfig?.apiUrl || syncMutation.isPending || syncStatusData?.lastSyncStatus === "syncing"}
                  className="bg-gradient-to-r from-indigo-600 to-purple-600"
                >
                  {syncMutation.isPending || syncStatusData?.lastSyncStatus === "syncing" ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" /> Sync Now</>
                  )}
                </Button>
              </div>
            </div>

            {syncStatusData?.lastSyncStatus === "failed" && syncStatusData.lastSyncError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                Last sync failed: {syncStatusData.lastSyncError}
              </div>
            )}

            {syncStatusData?.lastSyncStatus === "completed" && syncStatusData.lastSyncStats && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Last sync completed successfully: {syncStatusData.lastSyncStats.created} created, {syncStatusData.lastSyncStats.updated} updated, {syncStatusData.lastSyncStats.skipped} unchanged, {syncStatusData.lastSyncStats.errors} errors
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{jobToDelete?.title}"? This will also remove all applications for this job.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => jobToDelete && deleteMutation.mutate(jobToDelete.id)}
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
