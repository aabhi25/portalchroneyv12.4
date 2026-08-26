import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link2, Plus, Search, Sparkles, Trash2, UserRound, X } from "lucide-react";
import type { AiWorkbookColumn, AiWorkbookRow, AiWorkbookSheet } from "@shared/schema";

interface CampaignWorkbookField {
  value: string;
  label: string;
  formats: readonly string[];
}

interface Props {
  sheet: AiWorkbookSheet;
  onChange: (sheet: AiWorkbookSheet) => void;
  selectedRows: Set<string>;
  onSelectedRowsChange: (rows: Set<string>) => void;
  onFilteredRowsChange?: (rows: AiWorkbookRow[]) => void;
  onRemoveColumn?: (columnKey: string) => void;
  readOnly?: boolean;
  /** When set, this workbook is custom-linked to a campaign: team columns can be mapped to one of these fields. */
  mappableFields?: CampaignWorkbookField[];
  onMapColumn?: (column: AiWorkbookColumn) => void;
}

function safeKey(label: string, columns: AiWorkbookColumn[]) {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "column";
  let key = base;
  for (let n = 2; columns.some(c => c.key === key); n++) key = `${base}_${n}`;
  return key;
}

export function AiWorkbookGrid({
  sheet,
  onChange,
  selectedRows,
  onSelectedRowsChange,
  onFilteredRowsChange,
  onRemoveColumn,
  readOnly = false,
  mappableFields,
  onMapColumn,
}: Props) {
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [newColumn, setNewColumn] = useState("");
  const [columnToRemove, setColumnToRemove] = useState<AiWorkbookColumn | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);

  const outcomeColumn = sheet.columns.find(c => c.key === "classification_label" || c.key === "classification");
  const outcomes = useMemo(
    () => outcomeColumn
      ? Array.from(new Set(sheet.rows.map(r => String(r.values[outcomeColumn.key] || "")).filter(Boolean))).sort()
      : [],
    [sheet.rows, outcomeColumn?.key],
  );
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = sheet.rows.filter(row => {
      if (outcome !== "all" && outcomeColumn && String(row.values[outcomeColumn.key] || "") !== outcome) return false;
      if (!needle) return true;
      return sheet.columns.some(col => String(row.values[col.key] ?? "").toLowerCase().includes(needle));
    });
    return rows;
  }, [sheet, search, outcome, outcomeColumn?.key]);

  useEffect(() => {
    onFilteredRowsChange?.(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  const updateCell = (rowId: string, key: string, value: string | boolean) => {
    onChange({
      ...sheet,
      rows: sheet.rows.map(row => row.id === rowId
        ? { ...row, values: { ...row.values, [key]: value }, updatedAt: new Date().toISOString() }
        : row),
    });
  };

  const addColumn = () => {
    const label = newColumn.trim();
    if (!label) return;
    const key = safeKey(label, sheet.columns);
    onChange({
      ...sheet,
      columns: [...sheet.columns, { key, label, type: "text", source: "operator", editable: true }],
      rows: sheet.rows.map(row => ({ ...row, values: { ...row.values, [key]: "" } })),
    });
    setNewColumn("");
    setAddColumnOpen(false);
  };

  const addRow = () => {
    const values = Object.fromEntries(sheet.columns.map(c => [c.key, ""]));
    onChange({
      ...sheet,
      rows: [...sheet.rows, { id: crypto.randomUUID(), values, updatedAt: new Date().toISOString() }],
    });
  };

  const deleteSelected = () => {
    if (selectedRows.size === 0) return;
    onChange({ ...sheet, rows: sheet.rows.filter(row => !selectedRows.has(row.id)) });
    onSelectedRowsChange(new Set());
  };

  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every(row => selectedRows.has(row.id));
  const setAllVisible = (checked: boolean) => {
    const next = new Set(selectedRows);
    for (const row of filteredRows) checked ? next.add(row.id) : next.delete(row.id);
    onSelectedRowsChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search this tab…"
            className="pl-9 bg-white border-slate-200"
          />
        </div>
        {outcomeColumn && outcomes.length > 0 && (
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="w-[210px] bg-white border-slate-200" data-testid="select-workbook-outcome-filter">
              <SelectValue placeholder="All reply outcomes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reply outcomes</SelectItem>
              {outcomes.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {!readOnly && <div className="flex items-center gap-1 ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="bg-white border-slate-200">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setAddColumnOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Team column
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={addRow}>
                <Plus className="h-4 w-4 mr-2" /> Row
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedRows.size > 0 && (
            <Button variant="ghost" size="sm" onClick={deleteSelected} className="text-red-600 hover:text-red-700 hover:bg-red-50">
              <Trash2 className="h-4 w-4 mr-1" /> Remove selected
            </Button>
          )}
        </div>}
      </div>

      <div className="text-xs text-gray-500 flex items-center justify-between">
        <span>{filteredRows.length.toLocaleString()} of {sheet.rows.length.toLocaleString()} rows</span>
        {selectedRows.size > 0 ? <span>{selectedRows.size.toLocaleString()} selected</span> : <span> </span>}
      </div>

      <div className="border rounded-lg overflow-auto max-h-[62vh] bg-white">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-50 border-r border-b w-11 px-3 py-2">
                <Checkbox disabled={readOnly} checked={allVisibleSelected} onCheckedChange={v => setAllVisible(v === true)} />
              </th>
              <th className="border-r border-b px-2 py-2 text-xs text-gray-400 font-medium w-14">#</th>
              {sheet.columns.map(col => (
                  <th key={col.key} className="group min-w-[160px] max-w-[260px] border-r border-b px-3 py-2 text-left whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {col.source === "ai"
                      ? <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                      : col.source === "operator"
                        ? <UserRound className="h-3.5 w-3.5 text-blue-500" />
                        : null}
                    <span className="font-semibold text-gray-700">{col.label}</span>
                    {col.source !== "system" && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        {col.source === "ai" ? "AI" : "Team"}
                      </Badge>
                    )}
                    {col.campaignMapping && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-200 text-emerald-700 bg-emerald-50">
                        {mappableFields?.find(f => f.value === col.campaignMapping!.source)?.label || col.campaignMapping.source}
                      </Badge>
                    )}
                    {!readOnly && col.source === "operator" && mappableFields && onMapColumn && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={`h-5 w-5 text-gray-400 hover:text-violet-600 ${col.campaignMapping ? "text-emerald-500" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                        title={col.campaignMapping ? `Change what feeds ${col.label}` : `Map ${col.label} to a campaign field`}
                        aria-label={col.campaignMapping ? `Change mapping for ${col.label} column` : `Map ${col.label} column to a campaign field`}
                        onClick={() => onMapColumn(col)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {!readOnly && col.editable && onRemoveColumn && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 ml-auto text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title={`Remove ${col.label} column`}
                        aria-label={`Remove ${col.label} column`}
                        onClick={() => setColumnToRemove(col)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, index) => (
              <tr key={row.id} className={selectedRows.has(row.id) ? "bg-violet-50/70" : "hover:bg-slate-50"}>
                <td className="sticky left-0 z-10 bg-inherit border-r border-b px-3 py-2">
                  <Checkbox
                    disabled={readOnly}
                    checked={selectedRows.has(row.id)}
                    onCheckedChange={v => {
                      const next = new Set(selectedRows);
                      v === true ? next.add(row.id) : next.delete(row.id);
                      onSelectedRowsChange(next);
                    }}
                  />
                </td>
                <td className="border-r border-b px-2 py-2 text-xs text-gray-400 text-center">{index + 1}</td>
                {sheet.columns.map(col => {
                  const value = row.values[col.key];
                  return (
                    <td key={col.key} className="border-r border-b p-0 min-w-[160px] max-w-[260px]">
                      {!readOnly && col.editable ? (
                        col.type === "boolean" ? (
                          <div className="px-3 py-2">
                            <Checkbox
                              checked={value === true || value === "true"}
                              onCheckedChange={v => updateCell(row.id, col.key, v === true)}
                            />
                          </div>
                        ) : (
                          <input
                            type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
                            value={value == null ? "" : String(value).slice(0, col.type === "date" ? 10 : undefined)}
                            onChange={e => updateCell(row.id, col.key, e.target.value)}
                            className="w-full min-w-[160px] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-inset focus:ring-violet-400"
                          />
                        )
                      ) : (
                        <div className="px-3 py-2 truncate" title={value == null ? "" : String(value)}>
                          {col.type === "boolean"
                            ? (value === true || value === "true" ? "Yes" : "No")
                            : value == null || value === "" ? <span className="text-gray-300">—</span> : String(value)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr><td colSpan={sheet.columns.length + 2} className="text-center text-gray-400 py-12">No rows match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Dialog open={addColumnOpen} onOpenChange={setAddColumnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add team column</DialogTitle>
            <DialogDescription>Add a field for your team to update while reviewing this tab.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newColumn}
            onChange={e => setNewColumn(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newColumn.trim()) addColumn(); }}
            placeholder="e.g. Follow-up owner"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddColumnOpen(false)}>Cancel</Button>
            <Button onClick={addColumn} disabled={!newColumn.trim()}>Add column</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(columnToRemove)} onOpenChange={open => !open && setColumnToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove column?</DialogTitle>
            <DialogDescription>
              Remove “{columnToRemove?.label}” from this tab? Its values will be removed when you save this workbook.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColumnToRemove(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (columnToRemove) onRemoveColumn?.(columnToRemove.key);
                setColumnToRemove(null);
              }}
            >
              Remove column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
