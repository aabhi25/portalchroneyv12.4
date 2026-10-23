import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import {
  AlertCircle, Calendar as CalendarIcon, CheckCircle2, Clock, Mail, MessageSquare,
  MoreHorizontal, Phone, Search, UserX, X, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// The database fields are still called patient* (no database changes); the screen says "Name".
export interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  patientEmail: string | null;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes: string;
  status: string;
  notes: string | null;
  conversationId?: string | null;
}

export type AppointmentView = "upcoming" | "past" | "needs_update" | "all";

const STATUS: Record<string, { label: string; pill: string; icon: typeof Clock }> = {
  pending: { label: "Pending", pill: "bg-amber-50 text-amber-700 ring-amber-200", icon: Clock },
  confirmed: { label: "Confirmed", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: CheckCircle2 },
  completed: { label: "Completed", pill: "bg-sky-50 text-sky-700 ring-sky-200", icon: CheckCircle2 },
  no_show: { label: "No-show", pill: "bg-orange-50 text-orange-700 ring-orange-200", icon: UserX },
  cancelled: { label: "Cancelled", pill: "bg-rose-50 text-rose-700 ring-rose-200", icon: XCircle },
  rescheduled: { label: "Rescheduled", pill: "bg-violet-50 text-violet-700 ring-violet-200", icon: CalendarIcon },
};
const STATUS_CHOICES = ["confirmed", "completed", "no_show", "cancelled", "pending"];

const statusLabel = (status: string) => STATUS[status]?.label ?? status.replace(/_/g, " ");

// The day is read in the viewer's time zone, the same way the page has always shown it.
export const appointmentDay = (apt: Appointment) => startOfDay(new Date(apt.appointmentDate));

export const appointmentStart = (apt: Appointment) => {
  const [h, m] = apt.appointmentTime.split(":").map(Number);
  const start = appointmentDay(apt);
  start.setHours(h || 0, m || 0, 0, 0);
  return start;
};

const appointmentEnd = (apt: Appointment) =>
  new Date(appointmentStart(apt).getTime() + (parseInt(apt.durationMinutes) || 30) * 60_000);

const isOpen = (apt: Appointment) => apt.status === "confirmed" || apt.status === "pending";

// Still upcoming: not cancelled or finished, and the time has not passed yet.
export const isUpcoming = (apt: Appointment, now: Date) => isOpen(apt) && appointmentEnd(apt) > now;

// The time has passed but nobody recorded what happened.
export const needsUpdate = (apt: Appointment, now: Date) => isOpen(apt) && appointmentEnd(apt) <= now;

const formatTime = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${suffix}`;
};

const dayHeading = (day: Date, now: Date) => {
  const today = startOfDay(now);
  const sameYear = day.getFullYear() === today.getFullYear();
  const date = format(day, sameYear ? "EEE, d MMM" : "EEE, d MMM yyyy");
  if (isSameDay(day, today)) return { label: "Today", date };
  if (isSameDay(day, addDays(today, 1))) return { label: "Tomorrow", date };
  if (isSameDay(day, addDays(today, -1))) return { label: "Yesterday", date };
  return { label: date, date: "" };
};

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "?";

// Widget bookings start as "Pending" until the person gives their details.
const hasName = (apt: Appointment) => apt.patientName && apt.patientName !== "Pending";

export function AppointmentsList({
  appointments,
  isLoading,
  view,
  onViewChange,
}: {
  appointments: Appointment[];
  isLoading: boolean;
  view: AppointmentView;
  onViewChange: (view: AppointmentView) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState<Date | undefined>();
  const now = new Date();

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/appointments/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/appointments"] });
      const previous = queryClient.getQueryData<Appointment[]>(["/api/appointments"]);
      queryClient.setQueryData<Appointment[]>(["/api/appointments"], old =>
        old?.map(apt => (apt.id === id ? { ...apt, status } : apt)),
      );
      return { previous };
    },
    onSuccess: (_data, { status }) => {
      toast({ title: `Marked as ${statusLabel(status)}` });
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["/api/appointments"], context.previous);
      toast({ title: "Couldn't update the booking", description: "Please try again.", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    },
  });

  const counts = useMemo(() => {
    const today = startOfDay(now);
    return {
      upcoming: appointments.filter(apt => appointmentDay(apt) >= today).length,
      past: appointments.filter(apt => appointmentDay(apt) < today).length,
      needs_update: appointments.filter(apt => needsUpdate(apt, now)).length,
      all: appointments.length,
    };
    // `now` changes every render; the counts only need to follow the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]);

  const groups = useMemo(() => {
    const today = startOfDay(now);
    const query = search.trim().toLowerCase();
    let list = appointments;

    if (filterDate) {
      list = list.filter(apt => isSameDay(appointmentDay(apt), filterDate));
    } else if (view === "upcoming") {
      list = list.filter(apt => appointmentDay(apt) >= today);
    } else if (view === "past") {
      list = list.filter(apt => appointmentDay(apt) < today);
    } else if (view === "needs_update") {
      list = list.filter(apt => needsUpdate(apt, now));
    }

    if (query) {
      list = list.filter(apt =>
        [apt.patientName, apt.patientPhone, apt.patientEmail ?? ""].some(v => v.toLowerCase().includes(query)),
      );
    }

    // Upcoming reads soonest first; history reads most recent first.
    const soonestFirst = view === "upcoming" || !!filterDate;
    const sorted = [...list].sort((a, b) => {
      const diff = appointmentStart(a).getTime() - appointmentStart(b).getTime();
      return soonestFirst ? diff : -diff;
    });

    const byDay: { day: Date; items: Appointment[] }[] = [];
    for (const apt of sorted) {
      const day = appointmentDay(apt);
      const last = byDay[byDay.length - 1];
      if (last && isSameDay(last.day, day)) last.items.push(apt);
      else byDay.push({ day, items: [apt] });
    }
    return byDay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, view, search, filterDate]);

  const views: { key: AppointmentView; label: string; hidden?: boolean }[] = [
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past" },
    { key: "needs_update", label: "Needs update", hidden: counts.needs_update === 0 && view !== "needs_update" },
    { key: "all", label: "All" },
  ];

  const emptyText = search.trim()
    ? "No bookings match your search."
    : filterDate
      ? `No bookings on ${format(filterDate, "d MMM yyyy")}.`
      : view === "upcoming"
        ? "No upcoming bookings. New ones appear here as soon as someone books."
        : view === "past"
          ? "No past bookings yet."
          : view === "needs_update"
            ? "All caught up. Every past booking has an outcome."
            : "No bookings yet.";

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* Views, search and date */}
      <div className="flex flex-col gap-3 border-b border-black/[0.06] p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex max-w-full gap-1 self-start overflow-x-auto rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Which bookings to show">
          {views.filter(v => !v.hidden).map(v => {
            const active = !filterDate && view === v.key;
            const count = counts[v.key];
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setFilterDate(undefined); onViewChange(v.key); }}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900",
                )}
              >
                {v.key === "needs_update" && <AlertCircle className="h-3.5 w-3.5 text-amber-600" />}
                {v.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    v.key === "needs_update" ? "bg-amber-100 text-amber-800" : active ? "bg-gray-100 text-gray-700" : "text-gray-500",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:flex-1 xl:w-60 xl:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, phone or email"
              className="pl-9"
              aria-label="Search bookings"
            />
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={filterDate ? format(filterDate, "yyyy-MM-dd") : ""}
              onChange={e => {
                const [y, m, d] = e.target.value.split("-").map(Number);
                setFilterDate(e.target.value ? new Date(y, m - 1, d) : undefined);
              }}
              className="sm:w-44"
              aria-label="Show bookings on one date"
            />
            {filterDate && (
              <Button variant="ghost" size="icon" onClick={() => setFilterDate(undefined)} aria-label="Clear date">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {filterDate && (
        <div className="flex items-center justify-between border-b border-black/[0.06] bg-indigo-50/60 px-4 py-2 text-sm text-indigo-900">
          <span>Showing every booking on {format(filterDate, "EEEE, d MMMM yyyy")}</span>
          <button type="button" className="font-medium hover:underline" onClick={() => setFilterDate(undefined)}>
            Clear
          </button>
        </div>
      )}

      {!filterDate && view !== "needs_update" && counts.needs_update > 0 && (
        <div className="flex flex-col gap-2 border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            {counts.needs_update === 1
              ? "1 booking has passed but is still marked Confirmed or Pending. Record what happened to keep your records accurate."
              : `${counts.needs_update} bookings have passed but are still marked Confirmed or Pending. Record what happened to keep your records accurate.`}
          </span>
          <Button size="sm" variant="outline" className="shrink-0 border-amber-300 bg-white" onClick={() => onViewChange("needs_update")}>
            Review {counts.needs_update === 1 ? "it" : "them"}
          </Button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-500">Loading bookings…</div>
      ) : groups.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <CalendarIcon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-600">{emptyText}</p>
          {view === "upcoming" && !filterDate && !search.trim() && counts.past > 0 && (
            <Button variant="ghost" className="mt-2 text-indigo-700" onClick={() => onViewChange("past")}>
              See past bookings
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-black/[0.06]">
          {groups.map(({ day, items }) => {
            const heading = dayHeading(day, now);
            return (
              <section key={day.toISOString()}>
                <div className="flex items-baseline justify-between bg-gray-50/80 px-4 py-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {heading.label}
                    {heading.date && <span className="ml-2 font-normal text-gray-500">{heading.date}</span>}
                  </h3>
                  <span className="text-xs text-gray-500">{items.length === 1 ? "1 booking" : `${items.length} bookings`}</span>
                </div>
                <ul className="divide-y divide-black/[0.04]">
                  {items.map(apt => (
                    <AppointmentRow
                      key={apt.id}
                      apt={apt}
                      overdue={needsUpdate(apt, now)}
                      onStatus={status => updateStatus.mutate({ id: apt.id, status })}
                      onOpenChat={apt.conversationId ? () => setLocation(`/conversations?id=${apt.conversationId}`) : undefined}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppointmentRow({
  apt,
  overdue,
  onStatus,
  onOpenChat,
}: {
  apt: Appointment;
  overdue: boolean;
  onStatus: (status: string) => void;
  onOpenChat?: () => void;
}) {
  const status = STATUS[apt.status];
  const StatusIcon = status?.icon ?? CalendarIcon;
  const closed = apt.status === "cancelled";
  const named = hasName(apt);

  return (
    <li className={cn("flex flex-wrap items-start gap-x-4 sm:items-center gap-y-3 px-4 py-3.5", closed && "opacity-60")}>
      <div className="w-[4.5rem] shrink-0">
        <div className={cn("text-sm font-semibold text-gray-900 tabular-nums", closed && "line-through")}>
          {formatTime(apt.appointmentTime)}
        </div>
        <div className="text-xs text-gray-500">{parseInt(apt.durationMinutes) || 30} min</div>
      </div>

      <div className="flex min-w-0 flex-1 basis-44 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
          {named ? initials(apt.patientName) : "?"}
        </div>
        <div className="min-w-0">
          <div className={cn("truncate text-sm font-medium", named ? "text-gray-900" : "italic text-gray-500")}>
            {named ? apt.patientName : "Name not given yet"}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
            {apt.patientPhone && (
              <a href={`tel:${apt.patientPhone}`} className="inline-flex items-center gap-1 hover:text-indigo-700">
                <Phone className="h-3 w-3" /> {apt.patientPhone}
              </a>
            )}
            {apt.patientEmail && (
              <a href={`mailto:${apt.patientEmail}`} className="inline-flex min-w-0 items-center gap-1 hover:text-indigo-700">
                <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{apt.patientEmail}</span>
              </a>
            )}
          </div>
          {apt.notes && (
            <p className="mt-1 line-clamp-2 text-xs text-gray-500" title={apt.notes}>{apt.notes}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 max-sm:w-full max-sm:pl-[5.5rem]">
        {overdue ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
            title={`The time has passed but it is still marked ${statusLabel(apt.status)}`}
          >
            <AlertCircle className="h-3 w-3" /> Needs update
          </span>
        ) : (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", status?.pill ?? "bg-gray-50 text-gray-700 ring-gray-200")}>
            <StatusIcon className="h-3 w-3" /> {statusLabel(apt.status)}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 sm:ml-2">
          {overdue && (
            <>
              <Button size="sm" variant="outline" className="h-8" onClick={() => onStatus("completed")}>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-sky-600" /> Completed
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => onStatus("no_show")}>
                <UserX className="mr-1 h-3.5 w-3.5 text-orange-600" /> No-show
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`More actions for ${named ? apt.patientName : "this booking"}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs font-normal text-gray-500">Change status</DropdownMenuLabel>
              {STATUS_CHOICES.filter(s => s !== apt.status).map(s => {
                const Icon = STATUS[s].icon;
                return (
                  <DropdownMenuItem key={s} onSelect={() => onStatus(s)}>
                    <Icon className="mr-2 h-4 w-4" /> {STATUS[s].label}
                  </DropdownMenuItem>
                );
              })}
              {onOpenChat && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onOpenChat}>
                    <MessageSquare className="mr-2 h-4 w-4" /> Open the chat
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
