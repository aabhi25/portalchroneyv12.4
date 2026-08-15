import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, ArrowLeft, KeyRound, Zap, TableProperties, Globe, Plus, Trash2, Pencil, Store, Upload, FileSpreadsheet, RefreshCw, Search, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import MasterBulkUploadModal from "@/components/MasterBulkUploadModal";
import { Sparkles } from "lucide-react";

type Section = 'connection' | 'auth' | 'sync' | 'mappings' | 'stores' | null;

interface FieldMapping {
  id: string;
  crmField: string;
  sourceType: 'dynamic' | 'custom' | 'store';
  sourceField: string | null;
  customValue: string | null;
  displayName: string;
  isEnabled: string;
  sortOrder: number;
  isAutoManaged?: boolean;
}

interface FieldOption {
  value: string;
  label: string;
}

interface FieldGroup {
  label: string;
  fields: FieldOption[];
}

interface AvailableFieldsResponse {
  groups: FieldGroup[];
}

interface StoreCredential {
  id: string;
  dealerName: string;
  storeName: string;
  city: string | null;
  storeId: number | null;
  sid: string;
  hasSecret?: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const sectionTitles: Record<string, string> = {
  connection: 'Connection Settings',
  auth: 'Authentication',
  sync: 'Auto-Sync',
  mappings: 'Field Mappings',
  stores: 'Store Credentials',
};

export default function CustomCrmSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: currentUser } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const { data: availableFields } = useQuery<AvailableFieldsResponse>({ queryKey: ["/api/custom-crm/available-fields"] });

  const [activeSection, setActiveSection] = useState<Section>(null);
  const [masterUploadOpen, setMasterUploadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'success' | 'error' | null>(null);
  const [connectionMessage, setConnectionMessage] = useState('');

  const [name, setName] = useState('Custom CRM');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [httpMethod, setHttpMethod] = useState('POST');
  const [contentType, setContentType] = useState('form-data');
  const [authType, setAuthType] = useState('none');
  const [authKey, setAuthKey] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [relayTesting, setRelayTesting] = useState(false);
  const [relayTestStatus, setRelayTestStatus] = useState<'success' | 'error' | null>(null);
  const [relayTestMessage, setRelayTestMessage] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [showAuthKey, setShowAuthKey] = useState(false);
  const [authKeyChanged, setAuthKeyChanged] = useState(false);

  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<FieldMapping | null>(null);
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [crmField, setCrmField] = useState('');
  const [sourceType, setSourceType] = useState<'dynamic' | 'custom' | 'store'>('dynamic');
  const [sourceField, setSourceField] = useState('lead.customerName');
  const [customValue, setCustomValue] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [storeCredentials, setStoreCredentials] = useState<StoreCredential[]>([]);
  const [storeDialogOpen, setStoreDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreCredential | null>(null);
  const [deleteStoreId, setDeleteStoreId] = useState<string | null>(null);
  const [storeDealerName, setStoreDealerName] = useState('');
  const [storeStoreName, setStoreStoreName] = useState('');
  const [storeCity, setStoreCity] = useState('');
  const [storeStoreId, setStoreStoreId] = useState('');
  const [storeSid, setStoreSid] = useState('');
  const [storeSecret, setStoreSecret] = useState('');
  const [existingSecretSet, setExistingSecretSet] = useState(false);
  const [showStoreSecret, setShowStoreSecret] = useState(false);
  const [importingStores, setImportingStores] = useState(false);
  const [storeSearch, setStoreSearch] = useState('');
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchSettings();
    loadStoreCredentials();
  }, []);

  useEffect(() => {
    if (activeSection === 'mappings') loadMappings();
    if (activeSection === 'stores') loadStoreCredentials();
  }, [activeSection]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/custom-crm/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setName(data.name || 'Custom CRM');
        setApiBaseUrl(data.apiBaseUrl || '');
        setApiEndpoint(data.apiEndpoint || '');
        setHttpMethod(data.httpMethod || 'POST');
        setContentType(data.contentType || 'form-data');
        setAuthType(data.authType || 'none');
        setAuthHeaderName(data.authHeaderName || '');
        setAutoSyncEnabled(data.autoSyncEnabled || false);
        setCallbackUrl(data.callbackUrl || '');
        setRelayUrl(data.relayUrl || '');
        setEnabled(data.enabled || false);
        setHasCredentials(!!data.hasCredentials);
      }
    } catch (error: any) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMappings = async () => {
    try {
      const res = await fetch('/api/custom-crm/field-mappings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMappings(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load mappings:', error);
    }
  };

  const handleSyncFromLeadFields = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/custom-crm/field-mappings/sync-from-lead-fields', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        if (data.created > 0 || data.updated > 0) {
          const parts: string[] = [];
          if (data.created > 0) parts.push(`${data.created} new mapping${data.created !== 1 ? 's' : ''} created`);
          if (data.updated > 0) parts.push(`${data.updated} CRM key${data.updated !== 1 ? 's' : ''} updated`);
          toast({
            title: 'Mappings synced',
            description: parts.join(', ') + '.',
          });
        } else {
          toast({
            title: 'Already up to date',
            description: `All ${data.total} lead field${data.total !== 1 ? 's' : ''} are already in sync.`,
          });
        }
        loadMappings();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to sync mappings', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const payload: any = {
        name,
        apiBaseUrl,
        apiEndpoint,
        httpMethod,
        contentType,
        authType,
        authHeaderName: authType === 'api_key' ? authHeaderName : null,
        autoSyncEnabled,
        enabled,
        callbackUrl: authType === 'checksum_caprion' ? callbackUrl : null,
        relayUrl: relayUrl || null,
      };
      if (authKeyChanged && authKey) {
        payload.authKey = authKey;
      }

      const res = await fetch('/api/custom-crm/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: 'Settings Saved', description: 'Custom CRM settings have been saved.' });
        setAuthKey('');
        setAuthKeyChanged(false);
        queryClient.invalidateQueries({ queryKey: ["/api/custom-crm/settings"] });
        fetchSettings();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to save settings', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionStatus(null);
    try {
      const payload: any = {
        apiBaseUrl,
        apiEndpoint,
        httpMethod,
        authType,
        authHeaderName,
      };
      if (authKeyChanged && authKey) {
        payload.authKey = authKey;
      }

      const res = await fetch('/api/custom-crm/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setConnectionStatus('success');
        setConnectionMessage(data.message || 'Connection successful!');
      } else {
        setConnectionStatus('error');
        setConnectionMessage(data.error || 'Connection failed');
      }
    } catch {
      setConnectionStatus('error');
      setConnectionMessage('Network error');
    } finally {
      setTesting(false);
    }
  };

  const handleTestRelay = async () => {
    setRelayTesting(true);
    setRelayTestStatus(null);
    setRelayTestMessage('');
    try {
      const res = await fetch('/api/custom-crm/test-relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ relayUrl }),
      });
      const data = await res.json();
      setRelayTestStatus(data.success ? 'success' : 'error');
      setRelayTestMessage(data.message || (data.success ? 'Relay reachable' : 'Relay unreachable'));
    } catch {
      setRelayTestStatus('error');
      setRelayTestMessage('Network error — could not reach relay');
    } finally {
      setRelayTesting(false);
    }
  };

  const handleToggleAutoSync = async (val: boolean) => {
    setAutoSyncEnabled(val);
    try {
      await fetch('/api/custom-crm/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name, apiBaseUrl, apiEndpoint, httpMethod, contentType, authType, authHeaderName, enabled, autoSyncEnabled: val, callbackUrl: authType === 'checksum_caprion' ? callbackUrl : null, relayUrl: relayUrl || null,
        }),
      });
      toast({ title: val ? 'Auto-sync enabled' : 'Auto-sync disabled' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update auto-sync', variant: 'destructive' });
    }
  };

  const openAddMapping = () => {
    setEditingMapping(null);
    setCrmField('');
    setSourceType('dynamic');
    setSourceField('lead.customerName');
    setCustomValue('');
    setDisplayName('');
    setMappingDialogOpen(true);
  };

  const openEditMapping = (m: FieldMapping) => {
    setEditingMapping(m);
    setCrmField(m.crmField);
    setSourceType(m.sourceType);
    const defaultField = m.sourceType === 'store' ? 'store.sid' : 'lead.customerName';
    setSourceField(m.sourceField || defaultField);
    setCustomValue(m.customValue || '');
    setDisplayName(m.displayName);
    setMappingDialogOpen(true);
  };

  const handleSaveMapping = async () => {
    if (!crmField || !displayName) {
      toast({ title: 'Missing Fields', description: 'CRM field name and display name are required', variant: 'destructive' });
      return;
    }
    if ((sourceType === 'dynamic' || sourceType === 'store') && !sourceField) {
      toast({ title: 'Missing Source', description: `Please select a ${sourceType === 'store' ? 'store' : 'data source'} field`, variant: 'destructive' });
      return;
    }
    if (sourceType === 'custom' && !customValue) {
      toast({ title: 'Missing Value', description: 'Please enter a custom value', variant: 'destructive' });
      return;
    }

    interface MappingBody {
      crmField: string;
      sourceType: string;
      sourceField: string | null;
      customValue: string | null;
      displayName: string;
      isAutoManaged?: boolean;
    }

    const body: MappingBody = {
      crmField,
      sourceType,
      sourceField: (sourceType === 'dynamic' || sourceType === 'store') ? sourceField : null,
      customValue: sourceType === 'custom' ? customValue : null,
      displayName,
    };

    if (editingMapping) {
      body.isAutoManaged = false;
    }

    try {
      if (editingMapping) {
        await fetch(`/api/custom-crm/field-mappings/${editingMapping.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/custom-crm/field-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
      }
      setMappingDialogOpen(false);
      loadMappings();
      toast({ title: editingMapping ? 'Mapping updated' : 'Mapping added' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteMapping = async (id: string) => {
    await fetch(`/api/custom-crm/field-mappings/${id}`, { method: 'DELETE', credentials: 'include' });
    setDeleteDialogId(null);
    loadMappings();
    toast({ title: 'Mapping deleted' });
  };

  const handleToggleMapping = async (m: FieldMapping) => {
    const newEnabled = m.isEnabled === 'true' ? 'false' : 'true';
    await fetch(`/api/custom-crm/field-mappings/${m.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ isEnabled: newEnabled }),
    });
    loadMappings();
  };

  const loadStoreCredentials = async () => {
    try {
      const res = await fetch('/api/custom-crm/store-credentials', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStoreCredentials(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load store credentials:', error);
    }
  };

  const openStoreDialog = (store?: StoreCredential) => {
    if (store) {
      setEditingStore(store);
      setStoreDealerName(store.dealerName);
      setStoreStoreName(store.storeName);
      setStoreCity(store.city || '');
      setStoreStoreId(store.storeId ? String(store.storeId) : '');
      setStoreSid(store.sid);
      setStoreSecret('');
      setExistingSecretSet(!!store.hasSecret);
    } else {
      setEditingStore(null);
      setStoreDealerName('');
      setStoreStoreName('');
      setStoreCity('');
      setStoreStoreId('');
      setStoreSid('');
      setStoreSecret('');
      setExistingSecretSet(false);
    }
    setShowStoreSecret(false);
    setStoreDialogOpen(true);
  };

  const handleSaveStore = async () => {
    try {
      if (!storeDealerName || !storeStoreName || !storeSid) {
        toast({ title: 'Error', description: 'Dealer name, store name, and SID are required', variant: 'destructive' });
        return;
      }
      if (!editingStore && !storeSecret) {
        toast({ title: 'Error', description: 'Secret is required for new store credentials', variant: 'destructive' });
        return;
      }

      const payload: any = {
        dealerName: storeDealerName,
        storeName: storeStoreName,
        city: storeCity || null,
        storeId: storeStoreId || null,
        sid: storeSid,
      };
      if (storeSecret) payload.secret = storeSecret;

      if (editingStore) {
        await fetch(`/api/custom-crm/store-credentials/${editingStore.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/custom-crm/store-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      }

      setStoreDialogOpen(false);
      loadStoreCredentials();
      toast({ title: editingStore ? 'Store credential updated' : 'Store credential added' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteStore = async (id: string) => {
    await fetch(`/api/custom-crm/store-credentials/${id}`, { method: 'DELETE', credentials: 'include' });
    setDeleteStoreId(null);
    loadStoreCredentials();
    toast({ title: 'Store credential deleted' });
  };

  const handleBulkDeleteStores = async () => {
    const ids = Array.from(selectedStoreIds);
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/custom-crm/store-credentials/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (res.ok) {
        const count = data.deleted || ids.length;
        toast({ title: 'Stores deleted', description: `${count} store credential(s) deleted` });
        setSelectedStoreIds(new Set());
        loadStoreCredentials();
      } else {
        toast({ title: 'Delete failed', description: data.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Delete error', description: error.message, variant: 'destructive' });
    }
    setBulkDeleteConfirmOpen(false);
  };

  const filteredStoreCredentials = storeCredentials.filter(store => {
    if (!storeSearch) return true;
    const q = storeSearch.toLowerCase();
    return store.storeName.toLowerCase().includes(q) ||
           store.sid.toLowerCase().includes(q) ||
           store.dealerName.toLowerCase().includes(q) ||
           (store.city && store.city.toLowerCase().includes(q)) ||
           (store.storeId && String(store.storeId).includes(q));
  });

  const allFilteredSelected = filteredStoreCredentials.length > 0 && filteredStoreCredentials.every(s => selectedStoreIds.has(s.id));

  const groupedByDealer = filteredStoreCredentials.reduce<Record<string, StoreCredential[]>>((acc, store) => {
    const dealer = store.dealerName || 'Unknown Dealer';
    if (!acc[dealer]) acc[dealer] = [];
    acc[dealer].push(store);
    return acc;
  }, {});
  const sortedDealerNames = Object.keys(groupedByDealer).sort((a, b) => a.localeCompare(b));

  const handleToggleStore = async (store: StoreCredential) => {
    await fetch(`/api/custom-crm/store-credentials/${store.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ isActive: !store.isActive }),
    });
    loadStoreCredentials();
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch('/api/custom-crm/store-credentials/export-template', { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to download' }));
        toast({ title: 'Download failed', description: data.error, variant: 'destructive' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'store_credentials_template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Template downloaded', description: 'Fill in Store ID, SID, and Secret columns, then import the file back' });
    } catch (error: any) {
      toast({ title: 'Download error', description: error.message, variant: 'destructive' });
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingStores(true);
    try {
      let lines: string[][];
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        if (workbook.SheetNames.length === 0) throw new Error('Excel file has no sheets');
        lines = [];
        let headerRow: string[] | null = null;
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          const mapped = rows.map(row => row.map(cell => String(cell).trim())).filter(row => row.some(c => c !== ''));
          if (mapped.length === 0) continue;
          if (!headerRow) {
            headerRow = mapped[0];
            lines.push(...mapped);
          } else {
            const firstRow = mapped[0].map(c => c.toLowerCase());
            const matchCount = headerRow.filter((h, i) => firstRow[i] && firstRow[i] === h.toLowerCase()).length;
            const isHeader = matchCount >= Math.ceil(headerRow.filter(h => h !== '').length / 2);
            lines.push(...(isHeader ? mapped.slice(1) : mapped));
          }
        }
        if (lines.length === 0) throw new Error('No data found in any sheet');
      } else {
        const text = await file.text();
        lines = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      }

      const headers = lines[0]?.map(h => h.toLowerCase());
      if (!headers || headers.length === 0) throw new Error('Empty file');

      let dealerIdx = headers.findIndex(h => h.includes('dealer'));
      let storeNameIdx = headers.findIndex(h => h.includes('store') && h.includes('name'));
      let cityIdx = headers.findIndex(h => h.includes('city') || h.includes('location'));
      let storeIdIdx = headers.findIndex(h => h.includes('store') && h.includes('id'));
      let sidIdx = headers.findIndex(h => h.includes('sid') || h.includes('s_id'));
      let secretIdx = headers.findIndex(h => h.includes('secret') || h.includes('key'));

      if (sidIdx === -1 || secretIdx === -1) {
        toast({ title: 'Analyzing file with AI...', description: 'Column headers not recognized, using AI to map columns' });
        const aiRes = await fetch('/api/custom-crm/store-credentials/ai-map-columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            headers: lines[0],
            sampleRows: lines.slice(1, 6),
          }),
        });
        const aiData = await aiRes.json();
        if (!aiRes.ok || !aiData.success) {
          throw new Error(aiData.error || 'AI could not identify required columns (SID and Secret)');
        }
        const m = aiData.mapping;
        dealerIdx = m.dealerName ?? -1;
        storeNameIdx = m.storeName ?? -1;
        cityIdx = m.city ?? -1;
        storeIdIdx = m.storeId ?? -1;
        sidIdx = m.sid;
        secretIdx = m.secret;
      }

      const maxRequiredIdx = Math.max(sidIdx, secretIdx);
      const credentials = lines.slice(1)
        .filter(row => row.length > maxRequiredIdx && row[sidIdx])
        .map(row => ({
          dealerName: dealerIdx >= 0 ? row[dealerIdx] : 'Default',
          storeName: storeNameIdx >= 0 ? row[storeNameIdx] : row[sidIdx],
          city: cityIdx >= 0 ? row[cityIdx] : null,
          storeId: storeIdIdx >= 0 ? row[storeIdIdx] : null,
          sid: row[sidIdx],
          secret: row[secretIdx],
        }));

      if (credentials.length === 0) throw new Error('No valid rows found');

      const res = await fetch('/api/custom-crm/store-credentials/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentials }),
      });

      const data = await res.json();
      if (res.ok) {
        toast({ title: 'Import Complete', description: `${data.created ?? 0} new, ${data.updated ?? 0} updated, ${data.failed ?? 0} failed out of ${data.total} total` });
        loadStoreCredentials();
      } else {
        toast({ title: 'Import Failed', description: data.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Import Error', description: error.message, variant: 'destructive' });
    } finally {
      setImportingStores(false);
      e.target.value = '';
    }
  };

  if (loading) {
    return (
      <div>
        <MoreFeaturesNavTabs />
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const activeMappingsCount = mappings.filter(m => m.isEnabled === 'true').length;

  return (
    <div>
      <MoreFeaturesNavTabs />
      <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        {activeSection ? (
          <div>
            <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground hover:text-foreground" onClick={() => setActiveSection(null)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Dashboard
            </Button>
            <h1 className="text-3xl font-bold mb-2">{sectionTitles[activeSection]}</h1>
            <p className="text-muted-foreground">{name} Integration</p>
          </div>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground hover:text-foreground" onClick={() => history.back()}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <h1 className="text-3xl font-bold mb-2">{name} Integration</h1>
            <p className="text-muted-foreground">
              Connect to any in-house CRM with configurable API endpoints, authentication, and field mappings
            </p>
          </>
        )}
      </div>

      {!activeSection && (
        <div className="space-y-4">
        <Card
          className="cursor-pointer transition-all hover:shadow-lg border-violet-200 dark:border-violet-800 bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-950/40 dark:to-fuchsia-950/30 hover:-translate-y-0.5"
          onClick={() => setMasterUploadOpen(true)}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-violet-100 dark:bg-violet-900 p-2.5"><Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" /></div>
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Master Bulk Upload
                    <Badge variant="outline" className="text-violet-600 border-violet-300 bg-violet-50 dark:bg-violet-950">New</Badge>
                  </CardTitle>
                  <CardDescription>Upload one Excel to populate dealer/city/store dropdowns <span className="font-medium">and</span> store credentials at once</CardDescription>
                </div>
              </div>
              <Button className="bg-violet-600 hover:bg-violet-700 text-white shrink-0" onClick={(e) => { e.stopPropagation(); setMasterUploadOpen(true); }}>
                <Upload className="h-4 w-4 mr-2" />Start Upload
              </Button>
            </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-blue-300 hover:-translate-y-0.5" onClick={() => setActiveSection('connection')}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-100 dark:bg-blue-900 p-2.5"><Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" /></div>
                <div>
                  <CardTitle className="text-lg">Connection Settings</CardTitle>
                  <CardDescription>Configure API endpoint, HTTP method, and content type</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {apiBaseUrl
                ? <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950"><CheckCircle2 className="h-3 w-3 mr-1" />Configured</Badge>
                : <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50 dark:bg-yellow-950">Not configured</Badge>}
            </CardContent>
          </Card>

          <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-amber-300 hover:-translate-y-0.5" onClick={() => setActiveSection('auth')}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-amber-100 dark:bg-amber-900 p-2.5"><KeyRound className="h-5 w-5 text-amber-600 dark:text-amber-400" /></div>
                <div>
                  <CardTitle className="text-lg">Authentication</CardTitle>
                  <CardDescription>API key, bearer token, or checksum (HMAC) auth</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {authType !== 'none'
                ? <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950"><CheckCircle2 className="h-3 w-3 mr-1" />{authType === 'api_key' ? 'API Key' : authType === 'bearer' ? 'Bearer Token' : authType === 'checksum_caprion' ? 'Caprion (per-store)' : 'Checksum HMAC'}</Badge>
                : <Badge variant="outline" className="text-gray-500 border-gray-200 bg-gray-50 dark:bg-gray-900">None</Badge>}
            </CardContent>
          </Card>

          <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-purple-300 hover:-translate-y-0.5" onClick={() => setActiveSection('sync')}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-purple-100 dark:bg-purple-900 p-2.5"><Zap className="h-5 w-5 text-purple-600 dark:text-purple-400" /></div>
                <div>
                  <CardTitle className="text-lg">Auto-Sync</CardTitle>
                  <CardDescription>Auto-push leads on WhatsApp flow completion</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {autoSyncEnabled
                ? <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950"><CheckCircle2 className="h-3 w-3 mr-1" />Enabled</Badge>
                : <Badge variant="outline" className="text-gray-500 border-gray-200 bg-gray-50 dark:bg-gray-900">Disabled</Badge>}
            </CardContent>
          </Card>

          <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-orange-300 hover:-translate-y-0.5" onClick={() => setActiveSection('mappings')}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-orange-100 dark:bg-orange-900 p-2.5"><TableProperties className="h-5 w-5 text-orange-600 dark:text-orange-400" /></div>
                <div>
                  <CardTitle className="text-lg">Field Mappings</CardTitle>
                  <CardDescription>Map WhatsApp lead fields to your CRM fields</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 dark:bg-orange-950">
                {activeMappingsCount > 0 ? `${activeMappingsCount} active mapping${activeMappingsCount !== 1 ? 's' : ''}` : 'No mappings'}
              </Badge>
            </CardContent>
          </Card>

          <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-teal-300 hover:-translate-y-0.5" onClick={() => setActiveSection('stores')}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-teal-100 dark:bg-teal-900 p-2.5"><Store className="h-5 w-5 text-teal-600 dark:text-teal-400" /></div>
                <div>
                  <CardTitle className="text-lg">Store Credentials</CardTitle>
                  <CardDescription>Per-store SID and secret keys for CRM authentication</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="text-teal-600 border-teal-200 bg-teal-50 dark:bg-teal-950">
                {storeCredentials.length > 0 ? `${storeCredentials.filter(s => s.isActive).length} active store${storeCredentials.filter(s => s.isActive).length !== 1 ? 's' : ''}` : 'No stores'}
              </Badge>
            </CardContent>
          </Card>
        </div>
        </div>
      )}

      <MasterBulkUploadModal
        open={masterUploadOpen}
        onClose={() => setMasterUploadOpen(false)}
        onApplied={() => { if (activeSection === 'stores') loadStoreCredentials(); }}
      />

      {activeSection === 'connection' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>API Connection</CardTitle>
              <CardDescription>Configure the CRM API endpoint details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>CRM Name</Label>
                <Input placeholder="e.g. Caprion, Internal CRM" value={name} onChange={e => setName(e.target.value)} />
                <p className="text-xs text-muted-foreground">A display name to identify this CRM integration</p>
              </div>

              <div className="space-y-2">
                <Label>API Base URL</Label>
                <Input placeholder="e.g. https://api.caprion.in" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>API Endpoint Path</Label>
                <Input placeholder="e.g. /api/apiintegration/v4/CreateLead" value={apiEndpoint} onChange={e => setApiEndpoint(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>HTTP Method</Label>
                  <Select value={httpMethod} onValueChange={setHttpMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="GET">GET</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Content Type</Label>
                  <Select value={contentType} onValueChange={setContentType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="form-data">Form Data (multipart)</SelectItem>
                      <SelectItem value="json">JSON (application/json)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div>
                  <p className="font-medium">Enable Integration</p>
                  <p className="text-sm text-muted-foreground">Turn on to activate this CRM integration</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Relay Server</CardTitle>
              <CardDescription>Route outbound lead sync requests through an India-based proxy when your CRM only accepts requests from Indian IP addresses. Leave blank to call the CRM directly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Relay URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder="e.g. http://13.233.12.45:3000"
                    value={relayUrl}
                    onChange={e => { setRelayUrl(e.target.value); setRelayTestStatus(null); }}
                  />
                  <Button
                    variant="outline"
                    onClick={handleTestRelay}
                    disabled={relayTesting || !relayUrl.trim()}
                  >
                    {relayTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Test Relay
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter the base URL of your relay server (e.g. <code>http://13.233.12.45:3000</code>); the app will call <code>/relay</code> on it automatically.
                </p>
                {relayTestStatus && (
                  <Alert variant={relayTestStatus === 'success' ? 'default' : 'destructive'} className={relayTestStatus === 'success' ? 'border-green-200 bg-green-50 dark:bg-green-950' : ''}>
                    <AlertDescription className="flex items-center gap-2">
                      {relayTestStatus === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4" />}
                      {relayTestMessage}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>

          {connectionStatus && (
            <Alert variant={connectionStatus === 'success' ? 'default' : 'destructive'} className={connectionStatus === 'success' ? 'border-green-200 bg-green-50 dark:bg-green-950' : ''}>
              <AlertDescription className="flex items-center gap-2">
                {connectionStatus === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4" />}
                {connectionMessage}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleTestConnection} disabled={testing || !apiBaseUrl}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Test Connection
            </Button>
            <Button onClick={handleSaveSettings} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Settings
            </Button>
          </div>
        </div>
      )}

      {activeSection === 'auth' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Authentication Settings</CardTitle>
              <CardDescription>Configure how requests are authenticated with your CRM API</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Authentication Type</Label>
                <Select value={authType} onValueChange={setAuthType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="api_key">API Key (Custom Header)</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="checksum_hmac">Checksum HMAC-SHA256</SelectItem>
                    <SelectItem value="checksum_caprion">Checksum Caprion (per-store)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {authType === 'none' && 'No authentication headers will be sent'}
                  {authType === 'api_key' && 'Send an API key in a custom header (e.g. X-Api-Key)'}
                  {authType === 'bearer' && 'Send a Bearer token in the Authorization header'}
                  {authType === 'checksum_hmac' && 'Generate HMAC-SHA256 checksum from payload values (ksort keys, join with ||)'}
                  {authType === 'checksum_caprion' && 'Per-store credentials: ksort values + append secret before HMAC-SHA256. Requires Store Credentials to be configured.'}
                </p>
              </div>

              {authType !== 'none' && (
                <>
                  {authType === 'api_key' && (
                    <div className="space-y-2">
                      <Label>Header Name</Label>
                      <Input placeholder="e.g. X-Api-Key" value={authHeaderName} onChange={e => setAuthHeaderName(e.target.value)} />
                      <p className="text-xs text-muted-foreground">The HTTP header name to send the API key in</p>
                    </div>
                  )}

                  {authType !== 'checksum_caprion' && (
                  <div className="space-y-2">
                    <Label>{authType === 'api_key' ? 'API Key' : authType === 'bearer' ? 'Bearer Token' : 'HMAC Secret Key'}</Label>
                    <div className="relative">
                      <Input
                        type={showAuthKey ? 'text' : 'password'}
                        placeholder={hasCredentials ? '••••••••••••••• (saved)' : `Enter ${authType === 'api_key' ? 'API key' : authType === 'bearer' ? 'bearer token' : 'HMAC secret key'}`}
                        value={authKey}
                        onChange={e => { setAuthKey(e.target.value); setAuthKeyChanged(true); }}
                        className="pr-10"
                      />
                      <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1 h-7 w-7 p-0" onClick={() => setShowAuthKey(!showAuthKey)}>
                        {showAuthKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    {hasCredentials && !authKey && <p className="text-xs text-muted-foreground">Leave blank to keep the saved key.</p>}
                  </div>
                  )}
                  {authType === 'checksum_caprion' && (
                    <>
                      <Alert className="border-teal-200 bg-teal-50 dark:bg-teal-950">
                        <AlertDescription className="text-sm">
                          <Store className="h-4 w-4 inline mr-1" />
                          Per-store secrets are managed in the <button className="underline font-medium" onClick={() => setActiveSection('stores')}>Store Credentials</button> section. Each store's secret will be used for checksum generation during sync.
                        </AlertDescription>
                      </Alert>
                      <div className="space-y-2">
                        <Label>Callback URL</Label>
                        <Input
                          placeholder="https://your-site.com/caprion/callback"
                          value={callbackUrl}
                          onChange={e => setCallbackUrl(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Caprion redirect URL after lead submission. Required by Caprion API.</p>
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="flex gap-3 pt-2">
                <Button onClick={handleSaveSettings} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeSection === 'sync' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Auto-Sync to {name}</CardTitle>
              <CardDescription>When enabled, leads from WhatsApp flows are automatically pushed to your CRM upon completion.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div>
                  <p className="font-medium">Automatic Lead Sync</p>
                  <p className="text-sm text-muted-foreground">Push leads to {name} when WhatsApp flows are completed</p>
                </div>
                <Switch checked={autoSyncEnabled} onCheckedChange={handleToggleAutoSync} />
              </div>
              {!apiBaseUrl && (
                <Alert><AlertDescription>Configure your API connection in Connection Settings before enabling auto-sync.</AlertDescription></Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeSection === 'mappings' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{mappings.length} field{mappings.length !== 1 ? 's' : ''} configured</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleSyncFromLeadFields} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Sync from Lead Fields
              </Button>
              <Button size="sm" onClick={openAddMapping}><Plus className="h-4 w-4 mr-1" />Add Mapping</Button>
            </div>
          </div>

          {mappings.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No field mappings configured. Add mappings to define how lead data maps to your CRM fields.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {mappings.map(m => (
                <Card key={m.id} className={m.isEnabled !== 'true' ? 'opacity-60' : ''}>
                  <CardContent className="py-3 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{m.displayName || m.crmField}</span>
                        {m.isAutoManaged && <Badge variant="outline" className="text-xs shrink-0 text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-950">Auto</Badge>}
                        {m.isEnabled !== 'true' && <Badge variant="outline" className="text-xs shrink-0">Disabled</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        Source: {m.sourceType === 'custom' ? `"${m.customValue}"` : m.sourceField}
                      </p>
                      <p className="text-xs truncate">
                        <span className="text-muted-foreground">CRM key: </span>
                        <span className="font-mono text-blue-600 dark:text-blue-400">{m.crmField}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch checked={m.isEnabled === 'true'} onCheckedChange={() => handleToggleMapping(m)} />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditMapping(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteDialogId(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSection === 'stores' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Store Credentials</CardTitle>
                  <CardDescription>Manage per-store SID and secret keys for CRM authentication. Each store has its own credentials used for checksum generation.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                    <Download className="h-4 w-4 mr-1" />
                    Download Template
                  </Button>
                  <label htmlFor="csv-import">
                    <Button variant="outline" size="sm" asChild disabled={importingStores}>
                      <span>
                        {importingStores ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                        Import CSV / Excel
                      </span>
                    </Button>
                  </label>
                  <input id="csv-import" type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={handleImportExcel} />
                  <Button size="sm" onClick={() => openStoreDialog()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Store
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {storeCredentials.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Store className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">No store credentials configured</p>
                  <p className="text-sm mt-1">Add individual stores or bulk import from a CSV or Excel file</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by store name, SID, or dealer..."
                        value={storeSearch}
                        onChange={e => { setStoreSearch(e.target.value); setSelectedStoreIds(new Set()); }}
                        className="pl-9"
                      />
                    </div>
                    {selectedStoreIds.size > 0 && (
                      <Button variant="destructive" size="sm" onClick={() => setBulkDeleteConfirmOpen(true)}>
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete Selected ({selectedStoreIds.size})
                      </Button>
                    )}
                  </div>
                  {filteredStoreCredentials.length > 0 && (
                    <div className="flex items-center gap-2 px-1">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={() => {
                          if (allFilteredSelected) {
                            setSelectedStoreIds(new Set());
                          } else {
                            setSelectedStoreIds(new Set(filteredStoreCredentials.map(s => s.id)));
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
                      />
                      <span className="text-sm text-muted-foreground">
                        Select all ({filteredStoreCredentials.length}{storeSearch ? ' filtered' : ''})
                      </span>
                    </div>
                  )}
                  <div className="space-y-4">
                  {sortedDealerNames.map(dealerName => {
                    const dealerStores = groupedByDealer[dealerName];
                    const allDealerSelected = dealerStores.every(s => selectedStoreIds.has(s.id));
                    const someDealerSelected = dealerStores.some(s => selectedStoreIds.has(s.id));
                    return (
                      <div key={dealerName} className="space-y-1.5">
                        <div className="flex items-center gap-2 px-1 pt-1 pb-0.5 border-b">
                          <input
                            type="checkbox"
                            checked={allDealerSelected}
                            ref={el => { if (el) el.indeterminate = someDealerSelected && !allDealerSelected; }}
                            onChange={() => {
                              const next = new Set(selectedStoreIds);
                              if (allDealerSelected) {
                                dealerStores.forEach(s => next.delete(s.id));
                              } else {
                                dealerStores.forEach(s => next.add(s.id));
                              }
                              setSelectedStoreIds(next);
                            }}
                            className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
                          />
                          <span className="font-semibold text-sm">{dealerName}</span>
                          <Badge variant="secondary" className="text-xs">{dealerStores.length}</Badge>
                        </div>
                        {dealerStores.map(store => (
                          <Card key={store.id} className={`${!store.isActive ? 'opacity-50' : ''} ${selectedStoreIds.has(store.id) ? 'ring-2 ring-primary' : ''}`}>
                            <CardContent className="p-4 flex items-center justify-between">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={selectedStoreIds.has(store.id)}
                                  onChange={() => {
                                    const next = new Set(selectedStoreIds);
                                    if (next.has(store.id)) next.delete(store.id); else next.add(store.id);
                                    setSelectedStoreIds(next);
                                  }}
                                  className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium truncate">{store.storeName}</span>
                                    <Badge variant="outline" className="text-xs shrink-0">{store.sid}</Badge>
                                    {!store.isActive && <Badge variant="outline" className="text-xs text-red-500 border-red-200">Inactive</Badge>}
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-0.5">{store.city ? `${store.city} · ` : ''}ID: {store.storeId || '—'}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                <Switch checked={store.isActive} onCheckedChange={() => handleToggleStore(store)} />
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openStoreDialog(store)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteStoreId(store.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    );
                  })}
                  {filteredStoreCredentials.length === 0 && storeSearch && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      No stores matching "{storeSearch}"
                    </div>
                  )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={storeDialogOpen} onOpenChange={setStoreDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingStore ? 'Edit Store Credential' : 'Add Store Credential'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Dealer Name</Label>
              <Input placeholder="e.g. HomeLane, Design Cafe" value={storeDealerName} onChange={e => setStoreDealerName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Store Name</Label>
              <Input placeholder="e.g. HomeLane Bangalore" value={storeStoreName} onChange={e => setStoreStoreName(e.target.value)} />
              <p className="text-xs text-muted-foreground">Must match the store_name field value from the WhatsApp flow (case-insensitive)</p>
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input placeholder="e.g. Bangalore, Chennai, Mumbai" value={storeCity} onChange={e => setStoreCity(e.target.value)} />
              <p className="text-xs text-muted-foreground">Used with dealer name + store name to match leads from WhatsApp flow</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Store ID</Label>
                <Input placeholder="Optional numeric ID" value={storeStoreId} onChange={e => setStoreStoreId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>SID</Label>
                <Input placeholder="e.g. S00597" value={storeSid} onChange={e => setStoreSid(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Secret Key</Label>
              <div className="relative">
                <Input
                  type={showStoreSecret ? 'text' : 'password'}
                  placeholder={
                    editingStore
                      ? (existingSecretSet && !storeSecret ? '••••••••••••' : 'Enter secret key')
                      : 'Enter secret key'
                  }
                  value={storeSecret}
                  onChange={e => setStoreSecret(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowStoreSecret(!showStoreSecret)}
                >
                  {showStoreSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {existingSecretSet && !storeSecret && editingStore ? (
                <p className="text-xs text-green-600">Secret key is configured. Leave blank to keep existing.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Used for HMAC checksum generation. Encrypted at rest.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStoreDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveStore}>{editingStore ? 'Update' : 'Add'} Store</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteStoreId} onOpenChange={() => setDeleteStoreId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Store Credential</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this store credential? Leads from this store will no longer be able to sync to the CRM.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteStoreId && handleDeleteStore(deleteStoreId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedStoreIds.size} Store Credential{selectedStoreIds.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the selected store credential{selectedStoreIds.size > 1 ? 's' : ''}. Leads from these stores will no longer sync to the CRM.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDeleteStores}>Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingMapping ? 'Edit Field Mapping' : 'Add Field Mapping'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>CRM Field Name</Label>
              <Input placeholder="e.g. name, mobile, sid" value={crmField} onChange={e => setCrmField(e.target.value)} />
              <p className="text-xs text-muted-foreground">The field name your CRM API expects</p>
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input placeholder="Friendly name for this mapping" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Source Type</Label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as 'dynamic' | 'custom' | 'store')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dynamic">Dynamic — from lead data</SelectItem>
                  <SelectItem value="custom">Custom — static value</SelectItem>
                  <SelectItem value="store">Store — from store credentials</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sourceType === 'dynamic' ? (
              <div className="space-y-2">
                <Label>Source Field</Label>
                <Select value={sourceField} onValueChange={setSourceField}>
                  <SelectTrigger><SelectValue placeholder={!availableFields ? "Loading fields..." : "Select a field"} /></SelectTrigger>
                  <SelectContent>
                    {availableFields?.groups.map(group => (
                      group.fields.length > 0 ? (
                        <SelectGroup key={group.label}>
                          <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</SelectLabel>
                          {group.fields.map(f => (
                            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null
                    ))}
                    {availableFields && availableFields.groups.every(g => g.fields.length === 0) && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No fields configured. Set up lead fields in WhatsApp settings first.</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ) : sourceType === 'store' ? (
              <div className="space-y-2">
                <Label>Store Field</Label>
                <Select value={sourceField} onValueChange={setSourceField}>
                  <SelectTrigger><SelectValue placeholder="Select store field" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store.sid">Store SID</SelectItem>
                    <SelectItem value="store.storeName">Store Name</SelectItem>
                    <SelectItem value="store.dealerName">Dealer Name</SelectItem>
                    <SelectItem value="store.city">Store City</SelectItem>
                    <SelectItem value="store.storeId">Store ID</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Resolved from the matched store credential at sync time</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Static Value</Label>
                <Input placeholder="e.g. dealer SID, scheme ID" value={customValue} onChange={e => setCustomValue(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveMapping}>{editingMapping ? 'Update' : 'Add'} Mapping</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteDialogId} onOpenChange={() => setDeleteDialogId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Field Mapping</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this field mapping? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDialogId && handleDeleteMapping(deleteDialogId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}
