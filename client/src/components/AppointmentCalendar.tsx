import { useState, useMemo } from "react";
import { Calendar, Clock, ChevronLeft, ChevronRight, Check } from "lucide-react";

interface AppointmentCalendarProps {
  slots: Record<string, string[]>;
  durationMinutes: number;
  chatColor: string;
  chatColorEnd?: string;
  onSelectSlot: (date: string, time: string) => void;
  businessAccountId: string;
}

export function AppointmentCalendar({ 
  slots, 
  durationMinutes, 
  chatColor, 
  chatColorEnd,
  onSelectSlot,
  businessAccountId
}: AppointmentCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const availableDates = useMemo(() => new Set(Object.keys(slots)), [slots]);
  const availableDatesArray = useMemo(() => Object.keys(slots).sort(), [slots]);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const hasAnySlots = availableDatesArray.length > 0;

  const currentMonthHasSlots = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    return availableDatesArray.some(dateStr => {
      const date = new Date(dateStr + 'T00:00:00');
      return date.getFullYear() === year && date.getMonth() === month;
    });
  }, [currentMonth, availableDatesArray]);

  const nextAvailableMonth = useMemo(() => {
    if (availableDatesArray.length === 0) return null;
    const firstAvailable = new Date(availableDatesArray[0] + 'T00:00:00');
    return new Date(firstAvailable.getFullYear(), firstAvailable.getMonth(), 1);
  }, [availableDatesArray]);

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const startPadding = firstDay.getDay();
    const totalDays = lastDay.getDate();
    
    const days: { date: Date; dateStr: string; isCurrentMonth: boolean; isPast: boolean; hasSlots: boolean }[] = [];
    
    for (let i = startPadding - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      const dateStr = formatDateToISO(date);
      days.push({
        date,
        dateStr,
        isCurrentMonth: false,
        isPast: date < today,
        hasSlots: availableDates.has(dateStr)
      });
    }
    
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      const dateStr = formatDateToISO(date);
      days.push({
        date,
        dateStr,
        isCurrentMonth: true,
        isPast: date < today,
        hasSlots: availableDates.has(dateStr)
      });
    }
    
    const remaining = 42 - days.length;
    for (let day = 1; day <= remaining; day++) {
      const date = new Date(year, month + 1, day);
      const dateStr = formatDateToISO(date);
      days.push({
        date,
        dateStr,
        isCurrentMonth: false,
        isPast: date < today,
        hasSlots: availableDates.has(dateStr)
      });
    }
    
    return days;
  }, [currentMonth, today, availableDates]);

  function formatDateToISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const formatSelectedDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const handleDateClick = (day: typeof calendarDays[0]) => {
    if (day.isPast || !day.hasSlots) return;
    setSelectedDate(day.dateStr);
    setSelectedTime(null);
  };

  const handleTimeSelect = (time: string) => {
    if (selectedDate) {
      setSelectedTime(time);
    }
  };

  const handleBookAppointment = async () => {
    if (!selectedDate || !selectedTime) return;
    
    setIsBooking(true);
    try {
      onSelectSlot(selectedDate, selectedTime);
      setBookingSuccess(true);
    } catch (error) {
      console.error('Booking failed:', error);
    } finally {
      setIsBooking(false);
    }
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const canGoPrevious = useMemo(() => {
    const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    const lastDayOfPrevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0);
    return lastDayOfPrevMonth >= today;
  }, [currentMonth, today]);

  if (!hasAnySlots) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500 text-sm">
        No available slots at this time. Please contact us directly.
      </div>
    );
  }

  if (bookingSuccess) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
        <div className="flex items-center justify-center gap-2 text-green-600 mb-2">
          <Check className="w-5 h-5" />
          <span className="font-medium">Appointment Requested!</span>
        </div>
        <p className="text-sm text-green-700">
          {formatSelectedDate(selectedDate!)} at {formatTime(selectedTime!)}
        </p>
      </div>
    );
  }

  const jumpToNextAvailable = () => {
    if (nextAvailableMonth) {
      setCurrentMonth(nextAvailableMonth);
    }
  };

  const gradientStyle = chatColorEnd 
    ? { background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }
    : { backgroundColor: chatColor };

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      <div 
        className="px-4 py-3 text-white flex items-center gap-2"
        style={gradientStyle}
      >
        <Calendar className="w-4 h-4" />
        <span className="font-medium text-sm">Select Appointment</span>
        {durationMinutes && (
          <span className="ml-auto text-xs opacity-80">
            {durationMinutes} min
          </span>
        )}
      </div>
      
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={goToPreviousMonth}
            disabled={!canGoPrevious}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-800">{monthName}</span>
          <button
            onClick={goToNextMonth}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map(day => (
            <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, idx) => {
            const isSelected = selectedDate === day.dateStr;
            const isAvailable = day.hasSlots && !day.isPast;
            const isDisabled = day.isPast || !day.hasSlots;
            
            return (
              <button
                key={idx}
                onClick={() => handleDateClick(day)}
                disabled={isDisabled}
                className={`
                  aspect-square flex items-center justify-center text-xs rounded-lg transition-all
                  ${!day.isCurrentMonth ? 'text-gray-300' : ''}
                  ${isDisabled && day.isCurrentMonth ? 'text-gray-400 cursor-not-allowed' : ''}
                  ${isAvailable && !isSelected ? 'text-gray-800 font-medium hover:bg-gray-100 ring-1 ring-inset ring-gray-300' : ''}
                  ${isSelected ? 'text-white shadow-md' : ''}
                  ${day.isPast && day.isCurrentMonth ? 'text-gray-300 line-through' : ''}
                `}
                style={isSelected ? gradientStyle : undefined}
              >
                {day.date.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded ring-1 ring-inset ring-gray-300 bg-white"></div>
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-gray-100"></div>
            <span>Unavailable</span>
          </div>
        </div>

        {!currentMonthHasSlots && nextAvailableMonth && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
            <p className="text-xs text-amber-700 mb-2">
              No availability in {currentMonth.toLocaleDateString('en-US', { month: 'long' })}
            </p>
            <button
              onClick={jumpToNextAvailable}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all hover:opacity-90"
              style={gradientStyle}
            >
              Jump to {nextAvailableMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </button>
          </div>
        )}

        {selectedDate && slots[selectedDate] && (
          <div className="mt-4 pt-3 border-t border-gray-100 animate-in fade-in duration-200">
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatSelectedDate(selectedDate)}
            </p>
            <div className="grid grid-cols-3 gap-2 max-h-[120px] overflow-y-auto">
              {slots[selectedDate].map(time => (
                <button
                  key={time}
                  onClick={() => handleTimeSelect(time)}
                  className={`px-2 py-2 text-xs rounded-lg transition-all ${
                    selectedTime === time
                      ? 'text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={selectedTime === time ? gradientStyle : undefined}
                >
                  {formatTime(time)}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedDate && selectedTime && (
          <button
            onClick={handleBookAppointment}
            disabled={isBooking}
            className="w-full mt-3 py-2.5 text-white text-sm font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            style={gradientStyle}
          >
            {isBooking ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Booking...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Book Appointment
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
