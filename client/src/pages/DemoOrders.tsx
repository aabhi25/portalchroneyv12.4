import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, PackageOpen, RefreshCw, Truck, Package, ImageIcon } from "lucide-react";

type DemoOrder = {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  productName: string;
  productDescription?: string;
  productImageUrl?: string;
  amount?: string;
  status: string;
  courier?: string;
  trackingNumber?: string;
  estimatedDelivery?: string;
  orderDate?: string;
  notes?: string;
};

const STATUS_OPTIONS = [
  { value: "confirmed", label: "Confirmed", color: "bg-blue-100 text-blue-700" },
  { value: "processing", label: "Processing", color: "bg-yellow-100 text-yellow-700" },
  { value: "shipped", label: "Shipped", color: "bg-purple-100 text-purple-700" },
  { value: "out_for_delivery", label: "Out for Delivery", color: "bg-orange-100 text-orange-700" },
  { value: "delivered", label: "Delivered", color: "bg-green-100 text-green-700" },
  { value: "return_requested", label: "Return Requested", color: "bg-rose-100 text-rose-700" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-700" },
];

function statusBadge(status: string) {
  const opt = STATUS_OPTIONS.find(s => s.value === status);
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${opt?.color || "bg-gray-100 text-gray-700"}`}>
      {opt?.label || status}
    </span>
  );
}

const emptyForm = (): Partial<DemoOrder> => ({
  orderId: "", customerName: "", customerPhone: "", customerEmail: "",
  productName: "", productDescription: "", amount: "", status: "confirmed",
  courier: "", trackingNumber: "", estimatedDelivery: "", orderDate: new Date().toISOString().slice(0, 10), notes: ""
});

export default function DemoOrders() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<DemoOrder | null>(null);
  const [form, setForm] = useState<Partial<DemoOrder>>(emptyForm());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: orders = [], isLoading } = useQuery<DemoOrder[]>({
    queryKey: ["/api/demo-orders"],
    queryFn: () => apiRequest("GET", "/api/demo-orders"),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<DemoOrder>) => apiRequest("POST", "/api/demo-orders", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/demo-orders"] }); setDialogOpen(false); toast({ title: "Order created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DemoOrder> }) => apiRequest("PATCH", `/api/demo-orders/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/demo-orders"] }); setDialogOpen(false); toast({ title: "Order updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/demo-orders/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/demo-orders"] }); setDeleteId(null); toast({ title: "Order deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("DELETE", "/api/demo-orders/bulk", { ids }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo-orders"] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: `Deleted ${data?.deleted ?? selectedIds.size} orders` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/demo-orders/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/demo-orders"] }),
    onError: (e: any) => toast({ title: "Error updating status", description: e.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/demo-orders/seed"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo-orders"] });
      toast({ title: data?.created === 0 ? "Orders already seeded" : `Seeded ${data?.created ?? 10} Libas demo orders!` });
    },
    onError: (e: any) => toast({ title: "Error seeding", description: e.message, variant: "destructive" }),
  });

  const refreshImagesMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/demo-orders/backfill-images"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo-orders"] });
      toast({ title: `Updated images for ${data?.updated ?? 0} order${data?.updated !== 1 ? "s" : ""}` });
    },
    onError: (e: any) => toast({ title: "Error refreshing images", description: e.message, variant: "destructive" }),
  });

  const openAdd = () => { setEditOrder(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (o: DemoOrder) => { setEditOrder(o); setForm({ ...o }); setDialogOpen(true); };
  const handleSave = () => {
    if (editOrder) updateMutation.mutate({ id: editOrder.id, data: form });
    else createMutation.mutate(form);
  };

  const allSelected = orders.length > 0 && selectedIds.size === orders.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < orders.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map(o => o.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
            <PackageOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Demo Orders</h1>
            <p className="text-sm text-gray-500">Manage demo orders for chatbot showcase</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {orders.length === 0 && (
            <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${seedMutation.isPending ? "animate-spin" : ""}`} />
              Seed Demo Data
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete Selected ({selectedIds.size})
            </Button>
          )}
          <Button onClick={openAdd} className="bg-gradient-to-r from-rose-500 to-pink-600 text-white">
            <Plus className="h-4 w-4 mr-2" /> Add Order
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">No demo orders yet</h3>
          <p className="text-sm text-gray-400 mb-4">Click "Seed Demo Data" to load sample orders using products from your catalogue</p>
          <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${seedMutation.isPending ? "animate-spin" : ""}`} />
            Seed Demo Data
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="w-10">
                  <Checkbox
                    checked={someSelected ? "indeterminate" : allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all orders"
                  />
                </TableHead>
                <TableHead className="font-semibold">Order ID</TableHead>
                <TableHead className="font-semibold">Customer</TableHead>
                <TableHead className="font-semibold">Product</TableHead>
                <TableHead className="font-semibold">Amount</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Courier</TableHead>
                <TableHead className="font-semibold">Est. Delivery</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} className={`hover:bg-gray-50 ${selectedIds.has(order.id) ? "bg-rose-50" : ""}`}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(order.id)}
                      onCheckedChange={() => toggleOne(order.id)}
                      aria-label={`Select order ${order.orderId}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono font-medium text-gray-800">{order.orderId}</TableCell>
                  <TableCell>
                    <div className="font-medium text-gray-800">{order.customerName}</div>
                    <div className="text-xs text-gray-400">{order.customerPhone}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {order.productImageUrl && (
                        <img
                          src={order.productImageUrl}
                          alt={order.productName}
                          className="w-10 h-10 rounded object-cover flex-shrink-0 border border-gray-100"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <div>
                        <div className="font-medium text-gray-800 max-w-[160px] truncate">{order.productName}</div>
                        {order.productDescription && (
                          <div className="text-xs text-gray-400 max-w-[160px] truncate">{order.productDescription}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {order.amount ? `₹${Number(order.amount).toLocaleString("en-IN")}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={order.status}
                      onValueChange={(val) => statusMutation.mutate({ id: order.id, status: val })}
                    >
                      <SelectTrigger className="w-[160px] h-8 text-xs">
                        <SelectValue>{statusBadge(order.status)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${opt.color}`}>{opt.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {order.courier ? (
                      <div>
                        <div className="text-sm font-medium flex items-center gap-1"><Truck className="h-3 w-3" />{order.courier}</div>
                        {order.trackingNumber && <div className="text-xs text-gray-400 font-mono">{order.trackingNumber}</div>}
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {order.estimatedDelivery ? new Date(order.estimatedDelivery).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(order)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => setDeleteId(order.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editOrder ? "Edit Order" : "Add Demo Order"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label>Order ID *</Label>
              <Input placeholder="#LB1001" value={form.orderId || ""} onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status || "confirmed"} onValueChange={val => setForm(f => ({ ...f, status: val }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Customer Name *</Label>
              <Input placeholder="Priya Sharma" value={form.customerName || ""} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Customer Phone</Label>
              <Input placeholder="9810012345" value={form.customerPhone || ""} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Customer Email</Label>
              <Input placeholder="priya@gmail.com" value={form.customerEmail || ""} onChange={e => setForm(f => ({ ...f, customerEmail: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Product Name *</Label>
              <Input placeholder="Banarasi Silk Saree - Royal Blue" value={form.productName || ""} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Product Description</Label>
              <Input placeholder="Pure banarasi silk with gold zari border" value={form.productDescription || ""} onChange={e => setForm(f => ({ ...f, productDescription: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Amount (₹)</Label>
              <Input placeholder="4599" value={form.amount || ""} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Order Date</Label>
              <Input type="date" value={form.orderDate || ""} onChange={e => setForm(f => ({ ...f, orderDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Courier</Label>
              <Input placeholder="Delhivery" value={form.courier || ""} onChange={e => setForm(f => ({ ...f, courier: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Tracking Number</Label>
              <Input placeholder="DL987654321" value={form.trackingNumber || ""} onChange={e => setForm(f => ({ ...f, trackingNumber: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Estimated Delivery</Label>
              <Input type="date" value={form.estimatedDelivery || ""} onChange={e => setForm(f => ({ ...f, estimatedDelivery: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input placeholder="Optional notes" value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            >
              {editOrder ? "Save Changes" : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Delete Confirm Dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Order?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirm Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} order{selectedIds.size !== 1 ? "s" : ""}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            You are about to permanently delete <strong>{selectedIds.size}</strong> selected order{selectedIds.size !== 1 ? "s" : ""}. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : `Delete ${selectedIds.size} order${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
