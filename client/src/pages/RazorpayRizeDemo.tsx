import { useState, useEffect } from "react";
import { ChevronLeft, Check } from "lucide-react";

const RAZORPAY_RIZE_BUSINESS_ID = "760c81e7-7f3f-497b-8f0d-b0dc54903c4a";

type CompanyType = "private_limited" | "llp" | "opc" | null;

interface FormData {
  name: string;
  phone: string;
  companyType: CompanyType;
  numberOfDirectors: number;
  hasExistingDSC: boolean;
  directorsWithDSC: number;
  authorisedCapital: string;
  state: string;
}

const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal"
];

const CAPITAL_OPTIONS = [
  "₹1,00,000", "₹5,00,000", "₹10,00,000", "₹25,00,000", "₹50,00,000", "₹1,00,00,000"
];

export default function RazorpayRizeDemo() {
  const getStepFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const step = parseInt(params.get('step') || '1', 10);
    return step >= 1 && step <= 7 ? step : 1;
  };
  
  const [currentScreen, setCurrentScreen] = useState(getStepFromUrl);
  
  useEffect(() => {
    const handlePopState = () => {
      setCurrentScreen(getStepFromUrl());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  
  useEffect(() => {
    if (!window.location.search.includes('step=')) {
      window.history.replaceState({}, '', '/demo/razorpay-rize?step=1');
    }
  }, []);
  
  const [formData, setFormData] = useState<FormData>({
    name: "",
    phone: "+919674726401",
    companyType: null,
    numberOfDirectors: 2,
    hasExistingDSC: false,
    directorsWithDSC: 0,
    authorisedCapital: "₹1,00,000",
    state: "Karnataka"
  });

  const CAMPAIGN_ID = '4a619d45-e590-4cc6-a44c-a9f0bb04fbdc';
  
  const PRODUCTION_URL = 'https://portal.aichroney.com';
  
  useEffect(() => {
    const scriptId = 'hichroney-guidance-widget-script';
    
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `${PRODUCTION_URL}/guidance-widget.js`;
      script.setAttribute('data-business-id', RAZORPAY_RIZE_BUSINESS_ID);
      script.setAttribute('data-campaign-id', CAMPAIGN_ID);
      document.body.appendChild(script);
    }
    
    return () => {
      const existingScript = document.getElementById(scriptId);
      if (existingScript) {
        existingScript.remove();
      }
      const existingIframe = document.getElementById('hichroney-guidance-widget-iframe');
      if (existingIframe) {
        existingIframe.remove();
      }
      const existingLauncher = document.getElementById('hichroney-guidance-widget-launcher');
      if (existingLauncher) {
        existingLauncher.remove();
      }
    };
  }, []);
  
  useEffect(() => {
    const iframe = document.getElementById('hichroney-guidance-widget-iframe') as HTMLIFrameElement | null;
    if (iframe) {
      const sourceUrl = encodeURIComponent(window.location.pathname + window.location.search);
      iframe.src = `${PRODUCTION_URL}/embed/guidance?businessAccountId=${RAZORPAY_RIZE_BUSINESS_ID}&campaignId=${CAMPAIGN_ID}&sourceUrl=${sourceUrl}`;
    }
  }, [currentScreen]);

  const handleNext = () => {
    if (currentScreen < 7) {
      const nextStep = currentScreen + 1;
      window.history.pushState({}, '', `/demo/razorpay-rize?step=${nextStep}`);
      setCurrentScreen(nextStep);
    }
  };

  const handleBack = () => {
    if (currentScreen > 1) {
      const prevStep = currentScreen - 1;
      window.history.pushState({}, '', `/demo/razorpay-rize?step=${prevStep}`);
      setCurrentScreen(prevStep);
    }
  };

  const getNewDSCCount = () => {
    if (!formData.hasExistingDSC) return formData.numberOfDirectors;
    return formData.numberOfDirectors - formData.directorsWithDSC;
  };

  const calculatePrice = () => {
    const basePrice = formData.companyType === "private_limited" ? 14999 : 
                      formData.companyType === "llp" ? 12999 : 11999;
    const dscPrice = getNewDSCCount() * 1160;
    return basePrice + dscPrice;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/30 flex justify-start">
      <div className="w-full max-w-xl p-8 lg:p-12 flex flex-col justify-center">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-700 mb-10 self-start transition-colors"
          disabled={currentScreen === 1}
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back</span>
        </button>

        <div className="flex items-center justify-start gap-2.5 mb-10">
          <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-white text-xs font-bold">R</span>
          </div>
          <span className="text-slate-700 font-semibold tracking-tight">Rize Incorporation</span>
        </div>

        <div className="flex gap-1.5 mb-10">
          {[1, 2, 3, 4, 5, 6, 7].map((step) => (
            <div
              key={step}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                step < currentScreen ? 'bg-blue-600' : 
                step === currentScreen ? 'bg-blue-600' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        <div className="space-y-8">
          {currentScreen === 1 && (
            <Screen1Name
              name={formData.name}
              onChange={(name) => setFormData({ ...formData, name })}
              onNext={handleNext}
            />
          )}

          {currentScreen === 2 && (
            <Screen2Phone phone={formData.phone} onNext={handleNext} />
          )}

          {currentScreen === 3 && (
            <Screen3CompanyType
              selected={formData.companyType}
              onChange={(companyType) => setFormData({ ...formData, companyType })}
              onNext={handleNext}
            />
          )}

          {currentScreen === 4 && (
            <Screen4Directors
              companyType={formData.companyType}
              numberOfDirectors={formData.numberOfDirectors}
              hasExistingDSC={formData.hasExistingDSC}
              directorsWithDSC={formData.directorsWithDSC}
              onChange={(updates) => setFormData({ ...formData, ...updates })}
              onNext={handleNext}
            />
          )}

          {currentScreen === 5 && (
            <Screen5Capital
              amount={formData.authorisedCapital}
              onChange={(authorisedCapital) => setFormData({ ...formData, authorisedCapital })}
              onNext={handleNext}
            />
          )}

          {currentScreen === 6 && (
            <Screen6State
              state={formData.state}
              onChange={(state) => setFormData({ ...formData, state })}
              onNext={handleNext}
            />
          )}

          {currentScreen === 7 && (
            <Screen7Pricing
              companyType={formData.companyType}
              totalPrice={calculatePrice()}
              newDSCCount={getNewDSCCount()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Screen1Name({ name, onChange, onNext }: { name: string; onChange: (v: string) => void; onNext: () => void }) {
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">
          Let us get to know <span className="text-blue-600">you</span>
        </h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          This will help us keep you updated throughout your registration journey.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter your name"
          className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all text-slate-800 placeholder:text-slate-400"
        />
      </div>

      <button
        onClick={onNext}
        disabled={!name.trim()}
        className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed shadow-sm"
      >
        Continue
      </button>
    </div>
  );
}

function Screen2Phone({ phone, onNext }: { phone: string; onNext: () => void }) {
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">
          Your <span className="text-blue-600">contact details</span>
        </h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          We'll use this number to send important updates and verification codes.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Phone Number</label>
        <input
          type="text"
          value={phone}
          disabled
          className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
        />
        <p className="text-xs text-slate-400 mt-2">Linked to your account for security</p>
      </div>

      <button
        onClick={onNext}
        className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm"
      >
        Continue
      </button>
    </div>
  );
}

function Screen3CompanyType({ selected, onChange, onNext }: { selected: CompanyType; onChange: (v: CompanyType) => void; onNext: () => void }) {
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Company Type</h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          Choose a company type that best fits your business needs.
        </p>
      </div>

      <div className="flex gap-3">
        {[
          { id: "private_limited" as const, label: "Private Limited" },
          { id: "llp" as const, label: "LLP" },
          { id: "opc" as const, label: "OPC" }
        ].map((type) => (
          <button
            key={type.id}
            onClick={() => onChange(type.id)}
            className={`px-5 py-2.5 rounded-full border transition-all font-medium text-sm ${
              selected === type.id
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-slate-500">
        Unable to decide? <a href="#" className="text-blue-600 hover:underline font-medium">Try our Company Recommender</a>
      </p>

      <button
        onClick={onNext}
        disabled={!selected}
        className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed shadow-sm"
      >
        Continue
      </button>
    </div>
  );
}

function Screen4Directors({
  companyType,
  numberOfDirectors,
  hasExistingDSC,
  directorsWithDSC,
  onChange,
  onNext
}: {
  companyType: CompanyType;
  numberOfDirectors: number;
  hasExistingDSC: boolean;
  directorsWithDSC: number;
  onChange: (updates: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const minDirectors = companyType === "opc" ? 1 : 2;
  const maxDirectors = companyType === "opc" ? 1 : 15;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Director Details</h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          Select the number of directors who will manage your company.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Number of Directors</label>
        <select
          value={numberOfDirectors}
          onChange={(e) => onChange({ numberOfDirectors: parseInt(e.target.value) })}
          className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all text-slate-800"
        >
          {Array.from({ length: maxDirectors - minDirectors + 1 }, (_, i) => minDirectors + i).map((num) => (
            <option key={num} value={num}>{num}</option>
          ))}
        </select>
      </div>

      <div className="bg-slate-50 rounded-xl p-5 space-y-4 border border-slate-100">
        <div className="flex items-start justify-between">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-800 text-sm">Existing DSC holders</span>
            </div>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Toggle if any director already has a valid Digital Signature Certificate.
            </p>
          </div>
          <button
            onClick={() => onChange({ hasExistingDSC: !hasExistingDSC, directorsWithDSC: 0 })}
            className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ${hasExistingDSC ? 'bg-blue-600' : 'bg-slate-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform ${hasExistingDSC ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {hasExistingDSC && (
          <div className="space-y-2 pt-2">
            <label className="text-sm font-medium text-slate-700">Directors with valid DSC</label>
            <select
              value={directorsWithDSC}
              onChange={(e) => onChange({ directorsWithDSC: parseInt(e.target.value) })}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 outline-none"
            >
              {Array.from({ length: numberOfDirectors }, (_, i) => i + 1).map((num) => (
                <option key={num} value={num}>{num}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="text-sm text-blue-600 font-medium">
        {numberOfDirectors - (hasExistingDSC ? directorsWithDSC : 0)} new DSC(s) will be issued
      </p>

      <button
        onClick={onNext}
        className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm"
      >
        Continue
      </button>
    </div>
  );
}

function Screen5Capital({ amount, onChange, onNext }: { amount: string; onChange: (v: string) => void; onNext: () => void }) {
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">
          <span className="text-blue-600">Authorised</span> Capital
        </h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          Select the maximum share capital for your company.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Amount</label>
        <select
          value={amount}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all text-slate-800"
        >
          {CAPITAL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <p className="text-sm text-slate-400 mt-2">
          Most startups choose ₹1,00,000 as their authorised capital.
        </p>
      </div>

      <button
        onClick={onNext}
        className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm"
      >
        Continue
      </button>
    </div>
  );
}

function Screen6State({ state, onChange, onNext }: { state: string; onChange: (v: string) => void; onNext: () => void }) {
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">
          <span className="text-blue-600">State</span> of Registration
        </h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          Choose the state where your registered office will be located.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">State</label>
        <select
          value={state}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all text-slate-800"
        >
          {STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <p className="text-sm text-slate-400 mt-2">Stamp duty varies by state</p>
      </div>

      <button
        onClick={onNext}
        className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm"
      >
        Continue
      </button>
    </div>
  );
}

function Screen7Pricing({ companyType, totalPrice, newDSCCount }: { companyType: CompanyType; totalPrice: number; newDSCCount: number }) {
  const companyName = companyType === "private_limited" ? "Private Limited Company" :
                      companyType === "llp" ? "LLP" : "One Person Company";

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Pricing Summary</h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          All-inclusive pricing. No hidden charges.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="mb-5">
          <h3 className="font-semibold text-slate-800">{companyName} Registration</h3>
          <p className="text-sm text-slate-500 mt-1">Pay and proceed to document submission</p>
        </div>

        <div className="flex items-baseline justify-between mb-6">
          <span className="text-3xl font-bold text-slate-800">₹{totalPrice.toLocaleString()}</span>
          <a href="#" className="text-sm text-slate-500 hover:text-blue-600 font-medium">View breakdown</a>
        </div>

        <button className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm">
          Proceed to pay ₹{totalPrice.toLocaleString()}
        </button>

        <div className="space-y-3 mt-6 pt-5 border-t border-slate-100">
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>All DSC charges included (tokens & shipping)</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>Company name registration (up to 4 names)</span>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-slate-50 to-blue-50/50 rounded-xl border border-slate-100 p-5">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-base">📞</span>
          <span className="font-semibold text-slate-800 text-sm">Need expert guidance?</span>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Pay ₹1,499 now, rest after consultation
        </p>
        <button className="w-full py-3 border border-blue-600 text-blue-600 rounded-xl font-medium hover:bg-blue-50 transition-all text-sm">
          Book a consultation
        </button>
      </div>
    </div>
  );
}
