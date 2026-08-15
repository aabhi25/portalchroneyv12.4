import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";
import { useQuery } from "@tanstack/react-query";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, ArrowLeft, KeyRound, Zap, TableProperties, Plus, Trash2, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

type Section = 'connection' | 'sync' | 'mappings' | null;

const SOURCE_FIELD_OPTIONS = [
  { value: 'lead.name', label: 'Lead — Full Name' },
  { value: 'lead.email', label: 'Lead — Email' },
  { value: 'lead.phone', label: 'Lead — Phone' },
  { value: 'lead.whatsapp', label: 'Lead — WhatsApp' },
  { value: 'lead.createdAt', label: 'Lead — Created At' },
  { value: 'lead.sourceUrl', label: 'Lead — Source URL' },
  { value: 'session.city', label: 'Session — City' },
  { value: 'session.pageUrl', label: 'Session — Page URL' },
  { value: 'session.utmCampaign', label: 'Session — UTM Campaign' },
  { value: 'session.utmSource', label: 'Session — UTM Source' },
  { value: 'session.utmMedium', label: 'Session — UTM Medium' },
  { value: 'business.name', label: 'Business — Name' },
  { value: 'business.website', label: 'Business — Website' },
];

const sectionTitles: Record<string, string> = {
  connection: 'Connection Settings',
  sync: 'Auto-Sync',
  mappings: 'Field Mappings',
};

export default function SalesforceSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: currentUser } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const businessId = currentUser?.businessAccountId || currentUser?.activeBusinessAccountId;

  const [activeSection, setActiveSection] = useState<Section>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'success' | 'error' | null>(null);
  const [connectionMessage, setConnectionMessage] = useState('');

  // Connection form
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('production');
  const [showSecret, setShowSecret] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [instanceUrl, setInstanceUrl] = useState<string | null>(null);

  // Auto-sync
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  // Field mappings
  const [mappings, setMappings] = useState<any[]>([]);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<any | null>(null);
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [sfField, setSfField] = useState('');
  const [sourceType, setSourceType] = useState<'dynamic' | 'custom'>('dynamic');
  const [sourceField, setSourceField] = useState('lead.name');
  const [customValue, setCustomValue] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (!businessId) return;
    fetch('/api/salesforce/settings', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setClientId(d.clientId || '');
        setUsername(d.username || '');
        setEnvironment(d.environment || 'production');
        setHasCredentials(!!d.hasCredentials);
        setAutoSyncEnabled(d.enabled || false);
        setInstanceUrl(d.instanceUrl || null);
      })
      .catch(() => {});
  }, [businessId]);

  useEffect(() => {
    if (activeSection === 'mappings') loadMappings();
  }, [activeSection]);

  const loadMappings = async () => {
    const res = await fetch('/api/salesforce/field-mappings', { credentials: 'include' });
    const data = await res.json();
    setMappings(Array.isArray(data) ? data : []);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionStatus(null);
    try {
      const body = hasCredentials && !clientSecret && !password
        ? { useExistingSecret: true }
        : { clientId, clientSecret, username, password, environment };
      const res = await fetch('/api/salesforce/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setConnectionStatus('success');
        setConnectionMessage(data.message);
        if (data.instanceUrl) setInstanceUrl(data.instanceUrl);
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

  const handleSaveConnection = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/salesforce/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clientId, clientSecret: clientSecret || undefined, username, password: password || undefined, environment, enabled: autoSyncEnabled }),
      });
      const data = await res.json();
      if (data.success) {
        setHasCredentials(!!data.hasCredentials);
        setClientSecret('');
        setPassword('');
        toast({ title: 'Settings saved', description: 'Salesforce connection settings have been saved.' });
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to save settings', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save settings', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAutoSync = async (enabled: boolean) => {
    setAutoSyncEnabled(enabled);
    await fetch('/api/salesforce/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ clientId, username, environment, enabled }),
    });
    toast({ title: enabled ? 'Auto-sync enabled' : 'Auto-sync disabled', description: enabled ? 'New leads will automatically sync to Salesforce.' : 'Auto-sync is now disabled.' });
  };

  const openAddMapping = () => {
    setEditingMapping(null);
    setSfField('');
    setSourceType('dynamic');
    setSourceField('lead.name');
    setCustomValue('');
    setDisplayName('');
    setMappingDialogOpen(true);
  };

  const openEditMapping = (m: any) => {
    setEditingMapping(m);
    setSfField(m.salesforceField);
    setSourceType(m.sourceType);
    setSourceField(m.sourceField || 'lead.name');
    setCustomValue(m.customValue || '');
    setDisplayName(m.displayName);
    setMappingDialogOpen(true);
  };

  const handleSaveMapping = async () => {
    const body = {
      salesforceField: sfField,
      sourceType,
      sourceField: sourceType === 'dynamic' ? sourceField : null,
      customValue: sourceType === 'custom' ? customValue : null,
      displayName,
    };
    if (editingMapping) {
      await fetch(`/api/salesforce/field-mappings/${editingMapping.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    } else {
      await fetch('/api/salesforce/field-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    }
    setMappingDialogOpen(false);
    loadMappings();
    toast({ title: editingMapping ? 'Mapping updated' : 'Mapping added' });
  };

  const handleDeleteMapping = async (id: string) => {
    await fetch(`/api/salesforce/field-mappings/${id}`, { method: 'DELETE', credentials: 'include' });
    setDeleteDialogId(null);
    loadMappings();
    toast({ title: 'Mapping deleted' });
  };

  const handleToggleMapping = async (m: any) => {
    const newEnabled = m.isEnabled === 'true' ? 'false' : 'true';
    await fetch(`/api/salesforce/field-mappings/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ isEnabled: newEnabled }) });
    loadMappings();
  };

  const handleSeedDefaults = async () => {
    await fetch('/api/salesforce/field-mappings/seed-defaults', { method: 'POST', credentials: 'include' });
    loadMappings();
    toast({ title: 'Default mappings restored' });
  };

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
            <p className="text-muted-foreground">Salesforce CRM Integration</p>
          </div>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground hover:text-foreground" onClick={() => setLocation("/admin/crm")}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to CRM
            </Button>
            <h1 className="text-3xl font-bold mb-2">Salesforce CRM Integration</h1>
            <p className="text-muted-foreground">Automatically sync captured leads to your Salesforce account</p>
          </>
        )}
      </div>

      {/* Dashboard grid */}
      {!activeSection && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-blue-300 hover:-translate-y-0.5" onClick={() => setActiveSection('connection')}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-100 dark:bg-blue-900 p-2.5"><KeyRound className="h-5 w-5 text-blue-600 dark:text-blue-400" /></div>
                <div>
                  <CardTitle className="text-lg">Connection Settings</CardTitle>
                  <CardDescription>Configure your Salesforce API credentials</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {hasCredentials
                ? <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                : <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50 dark:bg-yellow-950">Not configured</Badge>}
            </CardContent>
          </Card>

          <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-purple-300 hover:-translate-y-0.5" onClick={() => setActiveSection('sync')}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-purple-100 dark:bg-purple-900 p-2.5"><Zap className="h-5 w-5 text-purple-600 dark:text-purple-400" /></div>
                <div>
                  <CardTitle className="text-lg">Auto-Sync</CardTitle>
                  <CardDescription>Enable automatic syncing of new leads to Salesforce</CardDescription>
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
                  <CardDescription>Configure which fields are synced to Salesforce</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 dark:bg-orange-950">{mappings.length || '—'} fields mapped</Badge>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Connection Settings */}
      {activeSection === 'connection' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Salesforce Credentials</CardTitle><CardDescription>Enter your Salesforce Connected App credentials. The Client Secret and Password are encrypted before storage.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select value={environment} onValueChange={(v) => setEnvironment(v as 'production' | 'sandbox')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production (login.salesforce.com)</SelectItem>
                    <SelectItem value="sandbox">Sandbox (test.salesforce.com)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Consumer Key (Client ID)</Label>
                <Input placeholder="3MVG9..." value={clientId} onChange={e => setClientId(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Consumer Secret (Client Secret)</Label>
                <div className="relative">
                  <Input type={showSecret ? 'text' : 'password'} placeholder={hasCredentials ? '••••••••••••••• (saved)' : 'Enter Consumer Secret'} value={clientSecret} onChange={e => setClientSecret(e.target.value)} className="pr-10" />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1 h-7 w-7 p-0" onClick={() => setShowSecret(!showSecret)}>
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {hasCredentials && !clientSecret && <p className="text-xs text-muted-foreground">Leave blank to keep the saved secret.</p>}
              </div>

              <div className="space-y-2">
                <Label>Salesforce Username</Label>
                <Input type="email" placeholder="user@company.com" value={username} onChange={e => setUsername(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Password + Security Token</Label>
                <div className="relative">
                  <Input type={showPassword ? 'text' : 'password'} placeholder={hasCredentials ? '••••••••••••••• (saved)' : 'Append security token to password'} value={password} onChange={e => setPassword(e.target.value)} className="pr-10" />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1 h-7 w-7 p-0" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Concatenate your password and security token: e.g. <span className="font-mono">MyPassword123ABC456XYZ</span></p>
                {hasCredentials && !password && <p className="text-xs text-muted-foreground">Leave blank to keep the saved password.</p>}
              </div>

              {instanceUrl && (
                <p className="text-xs text-muted-foreground">Instance: <span className="font-mono">{instanceUrl}</span></p>
              )}

              {connectionStatus && (
                <Alert variant={connectionStatus === 'success' ? 'default' : 'destructive'} className={connectionStatus === 'success' ? 'border-green-200 bg-green-50 dark:bg-green-950' : ''}>
                  <AlertDescription className="flex items-center gap-2">
                    {connectionStatus === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4" />}
                    {connectionMessage}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={handleTestConnection} disabled={testing || (!clientId && !hasCredentials)}>
                  {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Test Connection
                </Button>
                <Button onClick={handleSaveConnection} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Auto-Sync */}
      {activeSection === 'sync' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Auto-Sync to Salesforce</CardTitle><CardDescription>When enabled, leads captured by Chroney are automatically synced to Salesforce in real time.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div>
                  <p className="font-medium">Automatic Lead Sync</p>
                  <p className="text-sm text-muted-foreground">Push new leads to Salesforce as soon as they are captured</p>
                </div>
                <Switch checked={autoSyncEnabled} onCheckedChange={handleToggleAutoSync} />
              </div>
              {!hasCredentials && (
                <Alert><AlertDescription>Configure your Salesforce credentials in Connection Settings before enabling auto-sync.</AlertDescription></Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Field Mappings */}
      {activeSection === 'mappings' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{mappings.length} field{mappings.length !== 1 ? 's' : ''} configured</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSeedDefaults}>Restore Defaults</Button>
              <Button size="sm" onClick={openAddMapping}><Plus className="h-4 w-4 mr-1" />Add Mapping</Button>
            </div>
          </div>

          {mappings.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No field mappings configured. Add one or restore defaults.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {mappings.map(m => (
                <Card key={m.id} className={m.isEnabled !== 'true' ? 'opacity-60' : ''}>
                  <CardContent className="py-3 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium truncate">{m.salesforceField}</span>
                        {m.isEnabled !== 'true' && <Badge variant="outline" className="text-xs shrink-0">Disabled</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {m.displayName} — {m.sourceType === 'custom' ? `"${m.customValue}"` : m.sourceField}
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

      {/* Add/Edit Mapping Dialog */}
      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingMapping ? 'Edit Field Mapping' : 'Add Field Mapping'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Salesforce Field API Name</Label>
              <Input placeholder="e.g. LastName, Email, Custom_Field__c" value={sfField} onChange={e => setSfField(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input placeholder="Friendly name for this mapping" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Source Type</Label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as 'dynamic' | 'custom')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dynamic">Dynamic — from lead data</SelectItem>
                  <SelectItem value="custom">Custom — static value</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sourceType === 'dynamic' ? (
              <div className="space-y-2">
                <Label>Source Field</Label>
                <Select value={sourceField} onValueChange={setSourceField}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_FIELD_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Static Value</Label>
                <Input placeholder="e.g. Chroney Chat" value={customValue} onChange={e => setCustomValue(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveMapping} disabled={!sfField || !displayName || (sourceType === 'dynamic' && !sourceField) || (sourceType === 'custom' && !customValue)}>
              {editingMapping ? 'Save Changes' : 'Add Mapping'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteDialogId} onOpenChange={() => setDeleteDialogId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Field Mapping</AlertDialogTitle>
            <AlertDialogDescription>This will remove the mapping permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDialogId && handleDeleteMapping(deleteDialogId)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}
