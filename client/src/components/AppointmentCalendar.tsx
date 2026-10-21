import { useState, useMemo, useEffect, useRef, type CSSProperties, type FormEvent } from "react";
import { CalendarDays, Clock, ChevronLeft, ChevronRight, Check, Lock, AlertCircle, Loader2 } from "lucide-react";
import { validatePhoneNumber } from "@shared/validation/phone";

export interface BookedAppointment {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  name: string;
  durationMinutes: number;
}

interface AppointmentCalendarProps {
  slots: Record<string, string[]>;
  durationMinutes?: number;
  /** The day the visitor asked for (YYYY-MM-DD): the card opens on it, or the next day with times. */
  requestedDate?: string;
  chatColor: string;
  chatColorEnd?: string;
  businessAccountId: string;
  /** The chat this booking belongs to (links the appointment + lead to it). */
  conversationId?: string;
  /** Widget session id (keeps the AI's memory of this chat in step with the booking). */
  sessionId?: string;
  /** Visitor token: proves the chat is this visitor's, so details they gave earlier can be filled in. */
  sessionToken?: string;
  /** Set once this card has booked: the card then shows the confirmation. */
  booked?: BookedAppointment | null;
  /** A newer booking card is further down the chat: this one is closed. */
  superseded?: boolean;
  onBooked?: (booking: BookedAppointment) => void;
}

type Step = 'pick' | 'details';

const VISIBLE_TIMES = 9;

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseISODate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function formatSlotTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function formatLongDate(dateStr: string): string {
  return parseISODate(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatShortDate(dateStr: string): string {
  return parseISODate(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The chat's scrolling list around the card. */
function findChatScroller(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/** Scroll the chat just enough to show the bottom of `el`, keeping its top in view. */
function revealInChat(el: HTMLElement | null, smooth = true) {
  if (!el) return;
  const chat = findChatScroller(el);
  if (!chat) return;
  const pad = 12;
  const box = chat.getBoundingClientRect();
  const card = el.getBoundingClientRect();
  const hiddenBelow = card.bottom - (box.bottom - pad);
  const roomAbove = card.top - (box.top + pad);
  let delta: number;
  if (hiddenBelow > 1) delta = roomAbove > 0 ? Math.min(hiddenBelow, roomAbove) : hiddenBelow;
  else if (roomAbove < -1) delta = Math.max(roomAbove, hiddenBelow); // top cut off: scroll up, bottom stays in view
  else return;
  const target = chat.scrollTop + delta;
  if (!smooth) { chat.scrollTop = target; return; }
  chat.scrollTo({ top: target, behavior: 'smooth' });
  // Smooth scrolling can be skipped (reduced motion, background tabs): make sure it lands.
  setTimeout(() => { if (Math.abs(chat.scrollTop - target) > 2) chat.scrollTop = target; }, 600);
}

export function AppointmentCalendar({
  slots,
  durationMinutes = 30,
  requestedDate,
  chatColor,
  chatColorEnd,
  businessAccountId,
  conversationId,
  sessionId,
  sessionToken,
  booked: bookedProp,
  superseded,
  onBooked,
}: AppointmentCalendarProps) {
  const [localBooked, setLocalBooked] = useState<BookedAppointment | null>(null);
  const booked = bookedProp ?? localBooked;
  // Slots taken by someone else while this card was open are dropped locally.
  const [takenSlots, setTakenSlots] = useState<Set<string>>(() => new Set());
  const availableSlots = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const date of Object.keys(slots).sort()) {
      const times = (slots[date] || []).filter(t => !takenSlots.has(`${date}_${t}`)).sort();
      if (times.length) out[date] = times;
    }
    return out;
  }, [slots, takenSlots]);
  const days = useMemo(() => Object.keys(availableSlots), [availableSlots]);

  // Open on the asked-for day, or the next day that has times (with a short note saying so).
  const [initialPick] = useState(() => {
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return { date: days[0] ?? null, notice: null as string | null };
    if (availableSlots[requestedDate]) return { date: requestedDate, notice: null };
    const next = days.find(d => d > requestedDate);
    return {
      date: next ?? days[0] ?? null,
      notice: next ? `No open times on ${formatLongDate(requestedDate)} — showing the next open day.` : null,
    };
  });
  const [step, setStep] = useState<Step>('pick');
  const [selectedDate, setSelectedDate] = useState<string | null>(initialPick.date);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [showAllTimes, setShowAllTimes] = useState(false);
  const [notice, setNotice] = useState<string | null>(initialPick.notice);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const prefillTriedRef = useRef(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [stripEdges, setStripEdges] = useState({ start: true, end: true });

  // Keep the selected day valid when slots change (e.g. a taken slot emptied a day).
  useEffect(() => {
    if (!selectedDate || !availableSlots[selectedDate]) setSelectedDate(days[0] ?? null);
  }, [availableSlots, days, selectedDate]);

  // When the card appears, the AI's text above it is usually still typing and pushes it down:
  // for the first few seconds keep the card's bottom in view, until the visitor touches the chat.
  useEffect(() => {
    if (booked || superseded) return;
    const card = cardRef.current;
    const chat = card ? findChatScroller(card) ?? card.closest<HTMLElement>('.overflow-y-auto') : null;
    let stopped = false;
    const stop = () => { stopped = true; };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    events.forEach(ev => chat?.addEventListener(ev, stop, { passive: true }));
    const started = Date.now();
    const timer = setInterval(() => {
      if (stopped || Date.now() - started > 6000) { clearInterval(timer); return; }
      revealInChat(cardRef.current, false);
    }, 200);
    return () => {
      clearInterval(timer);
      events.forEach(ev => chat?.removeEventListener(ev, stop));
    };
    // Only when the card first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the card's bottom in view as its content changes (details step, more times).
  const firstLayoutRef = useRef(true);
  useEffect(() => {
    if (firstLayoutRef.current) { firstLayoutRef.current = false; return; }
    if (superseded) return;
    const t = setTimeout(() => revealInChat(cardRef.current), 80);
    return () => clearTimeout(t);
  }, [step, selectedDate, showAllTimes, booked, superseded]);

  const updateStripEdges = () => {
    const el = stripRef.current;
    if (!el) return;
    setStripEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };
  // Show the selected day in the strip when the card opens (it may be further along than the first days).
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (strip && chip && chip.offsetLeft + chip.offsetWidth > strip.clientWidth) {
      strip.scrollLeft = Math.max(0, chip.offsetLeft - chip.offsetWidth - 24); // keep the day before it in view
      updateStripEdges();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    updateStripEdges();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateStripEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length, step]);

  // Fill in the name / mobile the visitor already shared in this chat.
  useEffect(() => {
    if (step !== 'details' || prefillTriedRef.current) return;
    prefillTriedRef.current = true;
    if (!conversationId || !sessionToken) return;
    const params = new URLSearchParams({ businessAccountId, conversationId, sessionToken });
    fetch(`/api/chat/widget/appointment-contact?${params.toString()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        if (data.name) setName(prev => prev || String(data.name));
        if (data.phone) {
          const check = validatePhoneNumber(String(data.phone), '10');
          if (check.isValid) setPhone(prev => prev || check.normalized);
        }
      })
      .catch(() => {});
  }, [step, conversationId, sessionToken, businessAccountId]);

  const todayStr = toISODate(new Date());
  const tomorrowStr = toISODate(new Date(Date.now() + 86400000));

  const gradient = chatColorEnd ? `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` : chatColor;
  const themeVars = {
    '--accent': chatColor,
    '--accent-soft': `color-mix(in srgb, ${chatColor} 9%, white)`,
    '--accent-ring': `color-mix(in srgb, ${chatColor} 22%, transparent)`,
  } as CSSProperties;

  const cardClass = "w-full max-w-[340px] overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.22)]";

  if (booked) {
    return (
      <div ref={cardRef} className={cardClass} style={themeVars}>
        <div className="px-5 pt-6 pb-5 text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60">
            <Check className="h-6 w-6 text-emerald-600" strokeWidth={2.5} />
          </div>
          <p className="text-[15px] font-semibold text-gray-900">Appointment confirmed</p>
          <p className="mt-3 text-sm font-medium text-gray-800">{formatLongDate(booked.date)}</p>
          <p className="mt-0.5 text-sm text-gray-500">
            {formatSlotTime(booked.time)} · {booked.durationMinutes} min
          </p>
          <div className="mx-auto my-4 h-px w-16 bg-gray-100" />
          <p className="text-xs text-gray-500">Booked for <span className="font-medium text-gray-700">{booked.name}</span></p>
        </div>
      </div>
    );
  }

  if (superseded) {
    return (
      <div className="flex max-w-[340px] items-center gap-2 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        <span>This calendar is closed — the latest times are below.</span>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div className={cardClass}>
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
            <CalendarDays className="h-4 w-4 text-gray-500" />
          </div>
          <p className="text-sm text-gray-600">No times are open right now. Please contact us directly to book.</p>
        </div>
      </div>
    );
  }

  const times = selectedDate ? availableSlots[selectedDate] || [] : [];
  const visibleTimes = showAllTimes ? times : times.slice(0, VISIBLE_TIMES);

  const scrollStrip = (dir: 1 | -1) => {
    const el = stripRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const pickDay = (date: string) => {
    setSelectedDate(date);
    setShowAllTimes(false);
    setNotice(null);
  };

  const pickTime = (time: string) => {
    setSelectedTime(time);
    setNotice(null);
    setSubmitError(null);
    setStep('details');
    setTimeout(() => {
      if (!nameInputRef.current?.value) nameInputRef.current?.focus({ preventScroll: true });
    }, 120);
  };

  const backToTimes = () => {
    setStep('pick');
    setSubmitError(null);
  };

  const validateName = (value: string) => (value.trim().length < 2 ? 'Please enter your name' : null);
  const validatePhone = (value: string) => {
    if (!value.trim()) return 'Please enter your mobile number';
    const check = validatePhoneNumber(value, '10');
    return check.isValid ? null : check.reasonMessage;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime || isSubmitting) return;
    const nErr = validateName(name);
    const pErr = validatePhone(phone);
    setNameError(nErr);
    setPhoneError(pErr);
    if (nErr || pErr) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch('/api/chat/widget/confirm-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessAccountId,
          conversationId: conversationId || undefined,
          sessionId: sessionId || undefined,
          sessionToken: sessionToken || undefined,
          date: selectedDate,
          time: selectedTime,
          name: name.trim(),
          phone: phone.trim(),
          durationMinutes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        const booking = { date: selectedDate, time: selectedTime, name: data.name || name.trim(), durationMinutes };
        setLocalBooked(booking);
        onBooked?.(booking);
        return;
      }
      if (data.field === 'name') { setNameError(data.error || 'Please enter your name'); return; }
      if (data.field === 'phone') { setPhoneError(data.error || 'Please check your mobile number'); return; }
      if (data.slotUnavailable) {
        setTakenSlots(prev => new Set(prev).add(`${selectedDate}_${selectedTime}`));
        setSelectedTime(null);
        setStep('pick');
        setNotice('Sorry, that time was just taken. Please choose another.');
        return;
      }
      setSubmitError(data.error || 'Could not book this time. Please try again.');
    } catch {
      setSubmitError('Connection problem. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = (hasError: boolean) =>
    `h-10 w-full rounded-lg border bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-shadow focus:ring-4 ${
      hasError ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-[var(--accent)] focus:ring-[var(--accent-ring)]'
    }`;

  return (
    <div ref={cardRef} className={cardClass} style={themeVars} data-booking-card="open">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--accent-soft)' }}>
          <CalendarDays className="h-[18px] w-[18px]" style={{ color: chatColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight text-gray-900">Book an appointment</p>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {step === 'pick' ? `${durationMinutes} min · Pick a day & time` : 'Step 2 of 2 · Your details'}
          </p>
        </div>
      </div>

      {step === 'pick' ? (
        <div className="animate-in fade-in duration-200">
          {notice && (
            <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {/* Day strip */}
          <div className="relative">
            <div
              ref={stripRef}
              onScroll={updateStripEdges}
              className="flex snap-x gap-2 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="listbox"
              aria-label="Available days"
            >
              {days.map(date => {
                const d = parseISODate(date);
                const isSelected = date === selectedDate;
                const label = date === todayStr ? 'Today' : date === tomorrowStr ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' });
                return (
                  <button
                    key={date}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-label={formatLongDate(date)}
                    onClick={() => pickDay(date)}
                    className={`flex w-[54px] shrink-0 snap-start flex-col items-center rounded-xl border py-2 transition-all ${
                      isSelected
                        ? 'border-transparent text-white shadow-[0_6px_14px_-6px_rgba(16,24,40,0.45)]'
                        : 'border-gray-200 bg-white text-gray-800 hover:border-[var(--accent)]'
                    }`}
                    style={isSelected ? { background: gradient } : undefined}
                  >
                    <span className={`text-[10px] font-medium uppercase tracking-wide ${isSelected ? 'text-white/85' : 'text-gray-500'}`}>{label}</span>
                    <span className="mt-0.5 text-lg font-semibold leading-none">{d.getDate()}</span>
                    <span className={`mt-1 text-[10px] ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                      {d.toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                  </button>
                );
              })}
            </div>
            {!stripEdges.start && <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent" />}
            {!stripEdges.end && <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent" />}
          </div>

          {/* Times */}
          <div className="px-4 pt-3 pb-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium text-gray-800">{selectedDate ? formatLongDate(selectedDate) : ''}</p>
              {!(stripEdges.start && stripEdges.end) && (
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => scrollStrip(-1)} disabled={stripEdges.start} aria-label="Earlier days"
                    className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => scrollStrip(1)} disabled={stripEdges.end} aria-label="Later days"
                    className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2" key={selectedDate || ''}>
              {visibleTimes.map(time => (
                <button
                  key={time}
                  type="button"
                  onClick={() => pickTime(time)}
                  className="rounded-lg border border-gray-200 bg-white py-2 text-[13px] font-medium text-gray-700 transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] animate-in fade-in duration-200"
                >
                  {formatSlotTime(time)}
                </button>
              ))}
            </div>
            {times.length > VISIBLE_TIMES && (
              <button
                type="button"
                onClick={() => setShowAllTimes(v => !v)}
                className="mt-2.5 w-full text-center text-xs font-medium hover:underline"
                style={{ color: chatColor }}
              >
                {showAllTimes ? 'Show fewer times' : `Show all ${times.length} times`}
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="animate-in fade-in slide-in-from-right-2 duration-200">
          {/* Chosen slot */}
          <div className="mx-4 flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: 'var(--accent-soft)' }}>
            <Clock className="h-4 w-4 shrink-0" style={{ color: chatColor }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-gray-900">{selectedDate && formatShortDate(selectedDate)}</p>
              <p className="truncate text-xs text-gray-600">{selectedTime && formatSlotTime(selectedTime)} · {durationMinutes} min</p>
            </div>
            <button type="button" onClick={backToTimes} className="shrink-0 text-xs font-semibold hover:underline" style={{ color: chatColor }}>
              Change
            </button>
          </div>

          <div className="space-y-3 px-4 pt-3.5 pb-4">
            <div>
              <label htmlFor="appt-name" className="mb-1 block text-xs font-medium text-gray-600">Full name</label>
              <input
                id="appt-name"
                ref={nameInputRef}
                type="text"
                autoComplete="name"
                value={name}
                onChange={e => { setName(e.target.value); if (nameError) setNameError(null); }}
                onBlur={() => name && setNameError(validateName(name))}
                placeholder="Your name"
                maxLength={120}
                className={inputClass(!!nameError)}
                aria-invalid={!!nameError}
              />
              {nameError && <p className="mt-1 text-[11px] text-red-600">{nameError}</p>}
            </div>

            <div>
              <label htmlFor="appt-phone" className="mb-1 block text-xs font-medium text-gray-600">Mobile number</label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 pl-3 pr-2.5 text-sm text-gray-500">+91</span>
                <input
                  id="appt-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={e => { setPhone(e.target.value.replace(/[^\d+\s-]/g, '')); if (phoneError) setPhoneError(null); }}
                  onBlur={() => {
                    if (!phone) return;
                    const check = validatePhoneNumber(phone, '10');
                    if (check.isValid) setPhone(check.normalized); // "+91 98765 43210" → "9876543210" (the +91 is shown already)
                    setPhoneError(validatePhone(phone));
                  }}
                  placeholder="98765 43210"
                  maxLength={16}
                  className={`${inputClass(!!phoneError)} pl-[3.6rem] tracking-wide`}
                  aria-invalid={!!phoneError}
                />
              </div>
              {phoneError && <p className="mt-1 text-[11px] text-red-600">{phoneError}</p>}
            </div>

            {submitError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white shadow-[0_8px_18px_-10px_rgba(16,24,40,0.55)] transition-opacity hover:opacity-95 disabled:opacity-70"
              style={{ background: gradient }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Booking…
                </>
              ) : (
                'Confirm booking'
              )}
            </button>

            <p className="flex items-center justify-center gap-1 text-[11px] text-gray-400">
              <Lock className="h-3 w-3" />
              Only used for this booking
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
