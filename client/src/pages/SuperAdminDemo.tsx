import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Copy, MoreVertical, Plus, RefreshCw, Trash2, Eye, ExternalLink, Pencil, Search } from "lucide-react";
import type { BusinessAccountDto } from "@shared/dto";

interface DemoPage {
  id: string;
  businessAccountId: string;
  token: string;
  title: string | null;
  description: string | null;
  appearance: string | null;
  isActive: string;
  expiresAt: string | null;
  lastViewedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export default function SuperAdminDemo() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingDemo, setEditingDemo] = useState<DemoPage | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [createFormData, setCreateFormData] = useState({
    businessAccountId: "",
    title: "",
    description: "",
    expiresAt: "",
  });
  const [editFormData, setEditFormData] = useState({
    businessAccountId: "",
    title: "",
    description: "",
    expiresAt: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [editAccountOpen, setEditAccountOpen] = useState(false);

  const { data: demoPages = [], isLoading: isDemoPagesLoading } = useQuery<DemoPage[]>({
    queryKey: ["/api/super-admin/demo-pages"],
    queryFn: async () => {
      return await apiRequest("GET", "/api/super-admin/demo-pages");
    },
  });

  const { data: businessAccounts = [] } = useQuery<BusinessAccountDto[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const data = await apiRequest("GET", "/api/business-accounts?limit=1000");
      // API returns { accounts: [...], total, hasMore } - extract accounts array
      return (data as any).accounts || data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createFormData) => {
      return await apiRequest("POST", "/api/super-admin/demo-pages", data);
    },
    onSuccess: (newDemo) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/demo-pages"] });
      setIsCreateOpen(false);
      setCreateFormData({ businessAccountId: "", title: "", description: "", expiresAt: "" });
      toast({
        title: "Demo Page Created",
        description: "The demo page has been created successfully.",
      });
      
      const demoUrl = `${window.location.origin}/demo/${newDemo.token}`;
      navigator.clipboard.writeText(demoUrl);
      toast({
        title: "Link Copied",
        description: "The demo link has been copied to your clipboard.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create demo page",
        variant: "destructive",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest("PATCH", `/api/super-admin/demo-pages/${id}`, { isActive });
    },
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/super-admin/demo-pages"] });
      const previousPages = queryClient.getQueryData<DemoPage[]>(["/api/super-admin/demo-pages"]);
      
      queryClient.setQueryData<DemoPage[]>(["/api/super-admin/demo-pages"], (old) =>
        old?.map((page) => page.id === id ? { ...page, isActive: isActive ? "true" : "false" } : page)
      );
      
      return { previousPages };
    },
    onError: (error, variables, context) => {
      if (context?.previousPages) {
        queryClient.setQueryData(["/api/super-admin/demo-pages"], context.previousPages);
      }
      toast({
        title: "Error",
        description: "Failed to update demo page status",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/demo-pages"] });
    },
  });

  const regenerateTokenMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/super-admin/demo-pages/${id}/regenerate-token`);
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/demo-pages"] });
      const demoUrl = `${window.location.origin}/demo/${updated.token}`;
      navigator.clipboard.writeText(demoUrl);
      toast({
        title: "Token Regenerated",
        description: "New demo link copied to clipboard. The old link is now invalid.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to regenerate token",
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editFormData }) => {
      return await apiRequest("PATCH", `/api/super-admin/demo-pages/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/demo-pages"] });
      setEditingDemo(null);
      setEditFormData({ businessAccountId: "", title: "", description: "", expiresAt: "" });
      toast({
        title: "Demo Page Updated",
        description: "The demo page has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update demo page",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/super-admin/demo-pages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/demo-pages"] });
      setDeleteId(null);
      toast({
        title: "Demo Page Deleted",
        description: "The demo page has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete demo page",
        variant: "destructive",
      });
    },
  });

  const handleCopyLink = (token: string) => {
    const demoUrl = `${window.location.origin}/demo/${token}`;
    navigator.clipboard.writeText(demoUrl);
    toast({
      title: "Link Copied",
      description: "Demo link copied to clipboard",
    });
  };

  const handleOpenDemo = (token: string) => {
    window.open(`/demo/${token}`, "_blank");
  };

  const handleCreate = () => {
    if (!createFormData.businessAccountId || !createFormData.title) {
      toast({
        title: "Validation Error",
        description: "Business account and title are required",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate(createFormData);
  };

  const handleEdit = (demo: DemoPage) => {
    setEditingDemo(demo);
    setEditFormData({
      businessAccountId: demo.businessAccountId,
      title: demo.title || "",
      description: demo.description || "",
      expiresAt: demo.expiresAt ? new Date(demo.expiresAt).toISOString().split('T')[0] : "",
    });
  };

  const handleUpdate = () => {
    if (!editingDemo || !editFormData.businessAccountId || !editFormData.title) {
      toast({
        title: "Validation Error",
        description: "Business account and title are required",
        variant: "destructive",
      });
      return;
    }

    editMutation.mutate({ id: editingDemo.id, data: editFormData });
  };

  const handleCloseEdit = (open: boolean) => {
    if (!open) {
      setEditingDemo(null);
      setEditFormData({ businessAccountId: "", title: "", description: "", expiresAt: "" });
    }
  };

  const getBusinessName = (businessAccountId: string) => {
    return businessAccounts.find(b => b.id === businessAccountId)?.name || "Unknown";
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Demo Pages</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage shareable demo pages for business accounts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search demo pages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Demo Page
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Demo Page</DialogTitle>
              <DialogDescription>
                Select a business account and create a shareable demo page
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="business">Business Account *</Label>
                <Popover open={createAccountOpen} onOpenChange={setCreateAccountOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={createAccountOpen}
                      className="w-full justify-between font-normal"
                    >
                      {createFormData.businessAccountId
                        ? businessAccounts.find((account) => account.id === createFormData.businessAccountId)?.name
                        : "Search business account..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search business account..." />
                      <CommandList>
                        <CommandEmpty>No business account found.</CommandEmpty>
                        <CommandGroup>
                          {businessAccounts.map((account) => (
                            <CommandItem
                              key={account.id}
                              value={account.name}
                              onSelect={() => {
                                setCreateFormData({ ...createFormData, businessAccountId: account.id });
                                setCreateAccountOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  createFormData.businessAccountId === account.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {account.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={createFormData.title}
                  onChange={(e) => setCreateFormData({ ...createFormData, title: e.target.value })}
                  placeholder="Demo for Potential Client"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={createFormData.description}
                  onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
                  placeholder="Additional notes about this demo..."
                  rows={3}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expires">Expiration Date (Optional)</Label>
                <Input
                  id="expires"
                  type="date"
                  value={createFormData.expiresAt}
                  onChange={(e) => setCreateFormData({ ...createFormData, expiresAt: e.target.value })}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Demo Page"}
              </Button>
            </DialogFooter>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {isDemoPagesLoading ? (
        <div className="text-center py-12">Loading demo pages...</div>
      ) : demoPages.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/50">
          <p className="text-muted-foreground">No demo pages created yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click "New Demo Page" to create your first demo
          </p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Viewed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {demoPages
                .filter((demo) => {
                  if (!searchQuery.trim()) return true;
                  const query = searchQuery.toLowerCase();
                  const businessName = getBusinessName(demo.businessAccountId).toLowerCase();
                  const title = (demo.title || "").toLowerCase();
                  return businessName.includes(query) || title.includes(query);
                })
                .map((demo) => (
                <TableRow key={demo.id}>
                  <TableCell className="font-medium">
                    {getBusinessName(demo.businessAccountId)}
                  </TableCell>
                  <TableCell>{demo.title || "Untitled"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={demo.isActive === "true"}
                        onCheckedChange={(checked) =>
                          toggleActiveMutation.mutate({ id: demo.id, isActive: checked })
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {demo.isActive === "true" ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(demo.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {demo.lastViewedAt
                      ? format(new Date(demo.lastViewedAt), "MMM d, yyyy")
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleCopyLink(demo.token)}>
                          <Copy className="w-4 h-4 mr-2" />
                          Copy Link
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenDemo(demo.token)}>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Open Demo
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleEdit(demo)}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => regenerateTokenMutation.mutate(demo.id)}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Regenerate Token
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteId(demo.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editingDemo} onOpenChange={(open) => !open && handleCloseEdit(false)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Demo Page</DialogTitle>
            <DialogDescription>
              Update the demo page details
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-business">Business Account *</Label>
              <Popover open={editAccountOpen} onOpenChange={setEditAccountOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={editAccountOpen}
                    className="w-full justify-between font-normal"
                  >
                    {editFormData.businessAccountId
                      ? businessAccounts.find((account) => account.id === editFormData.businessAccountId)?.name
                      : "Search business account..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search business account..." />
                    <CommandList>
                      <CommandEmpty>No business account found.</CommandEmpty>
                      <CommandGroup>
                        {businessAccounts.map((account) => (
                          <CommandItem
                            key={account.id}
                            value={account.name}
                            onSelect={() => {
                              setEditFormData({ ...editFormData, businessAccountId: account.id });
                              setEditAccountOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                editFormData.businessAccountId === account.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {account.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Title *</Label>
              <Input
                id="edit-title"
                value={editFormData.title}
                onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                placeholder="Demo for Potential Client"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description (Optional)</Label>
              <Textarea
                id="edit-description"
                value={editFormData.description}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                placeholder="Additional notes about this demo..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-expires">Expiration Date (Optional)</Label>
              <Input
                id="edit-expires"
                type="date"
                value={editFormData.expiresAt}
                onChange={(e) => setEditFormData({ ...editFormData, expiresAt: e.target.value })}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleCloseEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={editMutation.isPending}>
              {editMutation.isPending ? "Updating..." : "Update Demo Page"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Demo Page?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The demo link will no longer work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
