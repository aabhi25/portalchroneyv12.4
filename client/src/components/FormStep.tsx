import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Send, Loader2, Check, Calendar, Clock, ChevronLeft, ChevronRight, CheckCircle, User, Phone } from "lucide-react";
import { validatePhoneNumber } from "@shared/validation/phone";

interface FormStepData {
  stepId: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
  options?: string[];
  placeholder?: string;
  stepType?: string;
  completionButtonText?: string;
  journeyId?: string;
  conversationId?: string;
}

interface FormStepProps {
  step: FormStepData;
  onSubmit: (value: string) => void;
  isSubmitting?: boolean;
  primaryColor?: string;
  businessAccountId?: string;
  conversationId?: string;
  onContinueExploring?: () => void;
}

type BookingPhase = 'calendar' | 'name' | 'phone' | 'confirmed';

export function FormStep({ step, onSubmit, isSubmitting = false, primaryColor = "#6366f1", businessAccountId, conversationId, onContinueExploring }: FormStepProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  
  // Appointment booking state
  const [appointmentSlots, setAppointmentSlots] = useState<Record<string, string[]>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingMessage, setBookingMessage] = useState("");
  
  // Multi-phase booking flow state
  const [bookingPhase, setBookingPhase] = useState<BookingPhase>('calendar');
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Calendar month navigation state
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    setValue("");
    setError("");
    setSelectedDate(null);
    setSelectedTime(null);
    setBookingSuccess(false);
    setBookingMessage("");
    setBookingPhase('calendar');
    setAppointmentId(null);
    setPatientName("");
    setPatientPhone("");
    setCurrentMonth(new Date()); // Reset to current month
    
    // Fetch appointment slots if this is a book_appointment step
    if (step.stepType === 'book_appointment' && businessAccountId) {
      fetchAppointmentSlots();
    }
  }, [step.stepId, step.stepType, businessAccountId]);

  const fetchAppointmentSlots = async () => {
    if (!businessAccountId) return;
    
    setLoadingSlots(true);
    try {
      const response = await fetch(`/api/chat/widget/appointment-slots?businessAccountId=${encodeURIComponent(businessAccountId)}`);
      if (response.ok) {
        const data = await response.json();
        setAppointmentSlots(data.slots || {});
      }
    } catch (error) {
      console.error('Failed to fetch appointment slots:', error);
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleBookAppointment = async () => {
    if (!selectedDate || !selectedTime || !businessAccountId) return;
    
    setIsBooking(true);
    setError("");
    try {
      const response = await fetch('/api/chat/widget/book-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessAccountId,
          date: selectedDate,
          time: selectedTime,
          conversationId,
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setAppointmentId(data.appointmentId);
        setBookingMessage(`${formatDate(selectedDate)} at ${formatTime(selectedTime)}`);
        // Move to name collection phase
        setBookingPhase('name');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to book appointment');
      }
    } catch (error) {
      console.error('Booking failed:', error);
      setError('Failed to book appointment. Please try again.');
    } finally {
      setIsBooking(false);
    }
  };

  const handleNameSubmit = () => {
    if (!patientName.trim()) {
      setError("Please enter your name");
      return;
    }
    setError("");
    setBookingPhase('phone');
  };

  const handlePhoneSubmit = async () => {
    const cleanPhone = patientPhone.replace(/\D/g, '');
    if (!cleanPhone) {
      setError("Please enter your mobile number");
      return;
    }
    if (cleanPhone.length !== 10) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    const phoneValidation = validatePhoneNumber(cleanPhone, '10');
    if (!phoneValidation.isValid) {
      setError(phoneValidation.reasonMessage);
      return;
    }
    
    setError("");
    setIsUpdating(true);
    
    try {
      // Update the pending appointment with name and phone
      const response = await fetch('/api/chat/widget/update-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId,
          conversationId,
          businessAccountId,
          name: patientName,
          phone: patientPhone,
        })
      });
      
      if (response.ok) {
        setBookingPhase('confirmed');
        setBookingSuccess(true);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to confirm appointment');
      }
    } catch (error) {
      console.error('Failed to update appointment:', error);
      setError('Failed to confirm appointment. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleContinue = () => {
    // Pass the booking confirmation as the answer
    onSubmit(`Booked: ${bookingMessage} - Name: ${patientName}, Phone: ${patientPhone}`);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.getTime() === today.getTime()) {
      return 'Today';
    } else if (date.getTime() === tomorrow.getTime()) {
      return 'Tomorrow';
    }
    
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // Calendar helpers
  const getMonthDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday
    
    const days: (Date | null)[] = [];
    
    // Add empty slots for days before the first of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };
  
  const formatDateKey = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  
  const isDateAvailable = (date: Date) => {
    const dateKey = formatDateKey(date);
    return appointmentSlots[dateKey] && appointmentSlots[dateKey].length > 0;
  };
  
  const isPastDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };
  
  const goToPrevMonth = () => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() - 1);
    // Don't allow going before current month
    const today = new Date();
    if (newMonth.getFullYear() > today.getFullYear() || 
        (newMonth.getFullYear() === today.getFullYear() && newMonth.getMonth() >= today.getMonth())) {
      setCurrentMonth(newMonth);
    }
  };
  
  const goToNextMonth = () => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + 1);
    if (canGoNextMonth()) {
      setCurrentMonth(newMonth);
    }
  };
  
  const canGoPrevMonth = () => {
    const today = new Date();
    return currentMonth.getFullYear() > today.getFullYear() || 
           (currentMonth.getFullYear() === today.getFullYear() && currentMonth.getMonth() > today.getMonth());
  };
  
  const canGoNextMonth = () => {
    // Find the latest available date from slots
    const availableDates = Object.keys(appointmentSlots).filter(
      dateKey => appointmentSlots[dateKey] && appointmentSlots[dateKey].length > 0
    ).sort();
    
    if (availableDates.length === 0) return false;
    
    const latestDate = new Date(availableDates[availableDates.length - 1] + 'T00:00:00');
    const nextMonthStart = new Date(currentMonth);
    nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
    nextMonthStart.setDate(1);
    
    // Can go to next month if there are slots in or after that month
    return latestDate >= nextMonthStart;
  };
  
  const hasAvailableSlotsInCurrentMonth = () => {
    const monthDays = getMonthDays(currentMonth);
    return monthDays.some(date => date && isDateAvailable(date) && !isPastDate(date));
  };

  const handleSubmit = () => {
    if (step.isRequired && !value.trim()) {
      setError("This field is required");
      return;
    }

    if (step.questionType === "email" && value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        setError("Please enter a valid email address");
        return;
      }
    }

    if (step.questionType === "phone" && value) {
      const cleanPhone = value.replace(/\D/g, '');
      if (cleanPhone.length !== 10) {
        setError("Please enter a valid 10-digit mobile number");
        return;
      }
      const phoneValidation = validatePhoneNumber(cleanPhone, '10');
      if (!phoneValidation.isValid) {
        setError(phoneValidation.reasonMessage);
        return;
      }
    }

    setError("");
    onSubmit(value);
    setValue("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Render appointment calendar with multi-phase booking flow
  const renderAppointmentCalendar = () => {
    const availableDates = Object.keys(appointmentSlots).sort();

    if (loadingSlots) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: primaryColor }} />
          <span className="ml-2 text-sm text-gray-600">Loading available times...</span>
        </div>
      );
    }

    // Phase: Name collection
    if (bookingPhase === 'name') {
      return (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-blue-600 mb-1">
              <Calendar className="w-5 h-5" />
              <span className="font-medium text-sm">Appointment Selected</span>
            </div>
            <p className="text-sm text-blue-700 font-medium">{bookingMessage}</p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <User className="w-4 h-4" style={{ color: primaryColor }} />
              <span>Your Name</span>
            </div>
            <Input
              type="text"
              value={patientName}
              onChange={(e) => { setPatientName(e.target.value); setError(""); }}
              placeholder="Enter your full name"
              className="h-12 rounded-xl border-gray-200 focus:border-blue-400 focus:ring-blue-400"
              onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
            />
          </div>
          
          {error && (
            <p className="text-xs font-medium text-rose-500 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}
          
          <Button
            onClick={handleNameSubmit}
            className="w-full h-12 rounded-xl font-semibold text-sm transition-all duration-300 ease-out shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            style={{ 
              backgroundColor: primaryColor,
              boxShadow: `0 4px 14px 0 ${primaryColor}40`
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <span>Continue</span>
              <ChevronRight className="w-4 h-4" />
            </span>
          </Button>
        </div>
      );
    }

    // Phase: Phone collection
    if (bookingPhase === 'phone') {
      return (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-blue-600 mb-1">
              <Calendar className="w-5 h-5" />
              <span className="font-medium text-sm">Appointment Selected</span>
            </div>
            <p className="text-sm text-blue-700 font-medium">{bookingMessage}</p>
            <p className="text-xs text-blue-600 mt-1">For: {patientName}</p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Phone className="w-4 h-4" style={{ color: primaryColor }} />
              <span>Your Mobile Number</span>
            </div>
            <Input
              type="tel"
              value={patientPhone}
              onChange={(e) => { setPatientPhone(e.target.value); setError(""); }}
              placeholder="Enter your mobile number"
              className="h-12 rounded-xl border-gray-200 focus:border-blue-400 focus:ring-blue-400"
              onKeyPress={(e) => e.key === 'Enter' && handlePhoneSubmit()}
            />
          </div>
          
          {error && (
            <p className="text-xs font-medium text-rose-500 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}
          
          <Button
            onClick={handlePhoneSubmit}
            disabled={isUpdating}
            className="w-full h-12 rounded-xl font-semibold text-sm transition-all duration-300 ease-out shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            style={{ 
              backgroundColor: primaryColor,
              boxShadow: `0 4px 14px 0 ${primaryColor}40`
            }}
          >
            {isUpdating ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Confirming...</span>
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                <span>Confirm Appointment</span>
              </span>
            )}
          </Button>
        </div>
      );
    }

    // Phase: Confirmed
    if (bookingPhase === 'confirmed' || bookingSuccess) {
      return (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
            <div className="flex items-center justify-center gap-2 text-green-600 mb-2">
              <CheckCircle className="w-6 h-6" />
              <span className="font-semibold text-lg">Appointment Confirmed!</span>
            </div>
            <p className="text-sm text-green-700 font-medium">{bookingMessage}</p>
            <div className="mt-2 text-xs text-green-600 space-y-0.5">
              <p>Name: {patientName}</p>
              <p>Phone: {patientPhone}</p>
            </div>
          </div>
          <Button
            onClick={handleContinue}
            className="w-full h-12 rounded-xl font-semibold text-sm transition-all duration-300 ease-out shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            style={{ 
              backgroundColor: primaryColor,
              boxShadow: `0 4px 14px 0 ${primaryColor}40`
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              <span>Continue</span>
            </span>
          </Button>
        </div>
      );
    }

    // Phase: Calendar (default)
    if (availableDates.length === 0) {
      return (
        <div className="bg-gray-50 rounded-xl p-5 text-center">
          <Calendar className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600">No available slots at this time.</p>
          <p className="text-xs text-gray-500 mt-1">Please contact us directly for assistance.</p>
        </div>
      );
    }

    const monthDays = getMonthDays(currentMonth);
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="space-y-4">
        {/* Calendar Month View */}
        <div className="space-y-3">
          {/* Month Header with Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={goToPrevMonth}
              disabled={!canGoPrevMonth()}
              className={`p-1.5 rounded-lg transition-all ${
                canGoPrevMonth() 
                  ? 'hover:bg-gray-100 text-gray-600' 
                  : 'text-gray-300 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-sm font-semibold text-gray-800">
              {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <button
              onClick={goToNextMonth}
              disabled={!canGoNextMonth()}
              className={`p-1.5 rounded-lg transition-all ${
                canGoNextMonth() 
                  ? 'hover:bg-gray-100 text-gray-600' 
                  : 'text-gray-300 cursor-not-allowed'
              }`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          
          {/* Week Days Header */}
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day) => (
              <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {monthDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="h-9" />;
              }
              
              const dateKey = formatDateKey(date);
              const isSelected = selectedDate === dateKey;
              const hasSlots = isDateAvailable(date);
              const isPast = isPastDate(date);
              const isToday = formatDateKey(date) === formatDateKey(new Date());
              
              return (
                <button
                  key={dateKey}
                  onClick={() => {
                    if (hasSlots && !isPast) {
                      setSelectedDate(dateKey);
                      setSelectedTime(null);
                    }
                  }}
                  disabled={!hasSlots || isPast}
                  className={`
                    h-9 rounded-lg text-sm font-medium
                    transition-all duration-200 ease-out
                    flex items-center justify-center relative
                    ${isSelected 
                      ? 'text-white shadow-md' 
                      : isPast || !hasSlots
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-700 hover:bg-gray-100'
                    }
                    ${isToday && !isSelected ? 'ring-1 ring-gray-300' : ''}
                  `}
                  style={{ 
                    backgroundColor: isSelected ? primaryColor : undefined,
                    boxShadow: isSelected ? `0 2px 8px 0 ${primaryColor}40` : undefined
                  }}
                >
                  {date.getDate()}
                  {hasSlots && !isPast && !isSelected && (
                    <span 
                      className="absolute bottom-1 w-1 h-1 rounded-full"
                      style={{ backgroundColor: primaryColor }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          
          {/* No slots message for current month */}
          {!hasAvailableSlotsInCurrentMonth() && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-sm text-amber-700">No available slots this month.</p>
              {canGoNextMonth() && (
                <p className="text-xs text-amber-600 mt-1">Try the next month for more options.</p>
              )}
            </div>
          )}
          
          {/* Legend */}
          {hasAvailableSlotsInCurrentMonth() && (
            <div className="flex items-center justify-center gap-4 text-xs text-gray-500 pt-1">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primaryColor }} />
                <span>Available</span>
              </div>
            </div>
          )}
        </div>

        {/* Time Selection */}
        {selectedDate && appointmentSlots[selectedDate] && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Clock className="w-4 h-4" style={{ color: primaryColor }} />
              <span>Select a Time</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {appointmentSlots[selectedDate].map((time) => {
                const isSelected = selectedTime === time;
                return (
                  <button
                    key={time}
                    onClick={() => setSelectedTime(time)}
                    className={`
                      px-3 py-2.5 rounded-lg text-sm font-medium
                      transition-all duration-200 ease-out
                      ${isSelected 
                        ? 'text-white shadow-md' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                    style={{ 
                      backgroundColor: isSelected ? primaryColor : undefined,
                      boxShadow: isSelected ? `0 2px 8px 0 ${primaryColor}40` : undefined
                    }}
                  >
                    {formatTime(time)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs font-medium text-rose-500 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        )}

        {/* Book Button */}
        <Button
          onClick={handleBookAppointment}
          disabled={!selectedDate || !selectedTime || isBooking}
          className={`
            w-full h-12 rounded-xl font-semibold text-sm
            transition-all duration-300 ease-out
            shadow-md hover:shadow-lg
            disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
            ${selectedDate && selectedTime ? 'hover:scale-[1.02] active:scale-[0.98]' : 'opacity-60'}
          `}
          style={{ 
            backgroundColor: primaryColor,
            boxShadow: selectedDate && selectedTime ? `0 4px 14px 0 ${primaryColor}40` : undefined
          }}
        >
          {isBooking ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Booking...</span>
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>Book Appointment</span>
            </span>
          )}
        </Button>
      </div>
    );
  };

  const renderInput = () => {
    switch (step.questionType) {
      case "radio":
        return (
          <RadioGroup
            value={value}
            onValueChange={setValue}
            className="space-y-2"
          >
            {step.options?.map((option, index) => {
              const isSelected = value === option;
              return (
                <div
                  key={index}
                  className={`
                    relative flex items-center p-4 rounded-xl cursor-pointer
                    transition-all duration-200 ease-out
                    ${isSelected 
                      ? 'bg-gradient-to-r from-gray-50 to-white shadow-md' 
                      : 'bg-white hover:bg-gray-50/80 border border-gray-200 hover:border-gray-300 hover:shadow-sm'
                    }
                  `}
                  style={{ 
                    boxShadow: isSelected ? `0 0 0 2px ${primaryColor}` : undefined,
                    borderColor: isSelected ? primaryColor : undefined
                  }}
                  onClick={() => setValue(option)}
                >
                  <div 
                    className={`
                      flex items-center justify-center w-5 h-5 rounded-full border-2 mr-3
                      transition-all duration-200
                      ${isSelected ? 'border-transparent' : 'border-gray-300'}
                    `}
                    style={{ 
                      backgroundColor: isSelected ? primaryColor : 'transparent',
                      borderColor: isSelected ? primaryColor : undefined
                    }}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>
                  <RadioGroupItem value={option} id={`option-${index}`} className="sr-only" />
                  <Label 
                    htmlFor={`option-${index}`} 
                    className={`
                      cursor-pointer flex-1 text-sm font-medium
                      transition-colors duration-200
                      ${isSelected ? 'text-gray-900' : 'text-gray-700'}
                    `}
                  >
                    {option}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        );

      case "dropdown":
        return (
          <div className="relative">
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full h-12 px-4 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-transparent hover:border-gray-300 transition-all duration-200"
              style={{ 
                boxShadow: value ? `0 0 0 2px ${primaryColor}20` : undefined,
                borderColor: value ? primaryColor : undefined
              }}
            >
              <option value="" disabled className="text-gray-400">Select an option</option>
              {step.options?.map((option, index) => (
                <option key={index} value={option} className="py-2">
                  {option}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        );

      case "email":
        return (
          <Input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={step.placeholder || "Enter your email"}
            className="h-12 px-4 text-sm font-medium rounded-xl border-gray-200 focus:ring-2 focus:ring-offset-0 transition-all duration-200 hover:border-gray-300"
            autoFocus
          />
        );

      case "phone":
        return (
          <Input
            type="tel"
            value={value}
            onChange={(e) => {
              const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 10);
              setValue(digitsOnly);
            }}
            onKeyPress={handleKeyPress}
            placeholder={step.placeholder || "Enter 10-digit mobile number"}
            className="h-12 px-4 text-sm font-medium rounded-xl border-gray-200 focus:ring-2 focus:ring-offset-0 transition-all duration-200 hover:border-gray-300"
            maxLength={10}
            autoFocus
          />
        );

      case "number":
        return (
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={step.placeholder || "Enter a number"}
            className="h-12 px-4 text-sm font-medium rounded-xl border-gray-200 focus:ring-2 focus:ring-offset-0 transition-all duration-200 hover:border-gray-300"
            autoFocus
          />
        );

      case "date":
        return (
          <Input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="h-12 px-4 text-sm font-medium rounded-xl border-gray-200 focus:ring-2 focus:ring-offset-0 transition-all duration-200 hover:border-gray-300"
            autoFocus
          />
        );

      default:
        return (
          <Input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={step.placeholder || "Type your answer..."}
            className="h-12 px-4 text-sm font-medium rounded-xl border-gray-200 focus:ring-2 focus:ring-offset-0 transition-all duration-200 hover:border-gray-300"
            autoFocus
          />
        );
    }
  };

  // Render journey complete step with completion message and optional button
  if (step.stepType === 'journey_complete') {
    return (
      <div className="bg-gradient-to-b from-white to-gray-50/50 rounded-2xl p-6 shadow-lg border border-gray-100/80 space-y-5 backdrop-blur-sm text-center">
        <div className="flex justify-center mb-3">
          <div 
            className="w-16 h-16 rounded-full flex items-center justify-center shadow-md"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <CheckCircle 
              className="w-8 h-8" 
              style={{ color: primaryColor }}
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-gray-900 leading-relaxed">
            {step.questionText || "Thank you!"}
          </h3>
        </div>

        {step.completionButtonText && onContinueExploring && (
          <Button
            onClick={onContinueExploring}
            className="w-full h-12 rounded-xl font-semibold text-sm transition-all duration-300 ease-out shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            style={{ 
              backgroundColor: primaryColor,
              boxShadow: `0 4px 14px 0 ${primaryColor}40`
            }}
          >
            <span className="flex items-center justify-center gap-2">
              {step.completionButtonText}
            </span>
          </Button>
        )}
      </div>
    );
  }

  // Render appointment calendar if stepType is book_appointment
  if (step.stepType === 'book_appointment') {
    return (
      <div className="bg-gradient-to-b from-white to-gray-50/50 rounded-2xl p-5 shadow-lg border border-gray-100/80 space-y-4 backdrop-blur-sm">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-gray-900 leading-relaxed">
            {step.questionText || "Select an appointment time"}
            {step.isRequired && <span className="text-rose-500 ml-1 text-sm">*</span>}
          </h3>
        </div>
        {renderAppointmentCalendar()}
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-white to-gray-50/50 rounded-2xl p-5 shadow-lg border border-gray-100/80 space-y-5 backdrop-blur-sm">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-gray-900 leading-relaxed">
          {step.questionText}
          {step.isRequired && <span className="text-rose-500 ml-1 text-sm">*</span>}
        </h3>
      </div>

      <div className="space-y-3">
        {renderInput()}
        {error && (
          <p className="text-xs font-medium text-rose-500 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        )}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || (!value && step.isRequired)}
        className={`
          w-full h-12 rounded-xl font-semibold text-sm
          transition-all duration-300 ease-out
          shadow-md hover:shadow-lg
          disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
          ${!value && step.isRequired ? 'opacity-60' : 'hover:scale-[1.02] active:scale-[0.98]'}
        `}
        style={{ 
          backgroundColor: primaryColor,
          boxShadow: value || !step.isRequired ? `0 4px 14px 0 ${primaryColor}40` : undefined
        }}
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Submitting...</span>
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Send className="w-4 h-4" />
            <span>Submit</span>
          </span>
        )}
      </Button>
    </div>
  );
}
