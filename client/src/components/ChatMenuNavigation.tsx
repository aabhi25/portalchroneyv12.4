import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Search, Phone, MessageCircle, MessageSquare, ExternalLink, FileText, Folder, BookOpen, GraduationCap, Briefcase, ShoppingBag, Star, Heart, HelpCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatDetailsView, parseDetailsConfig } from "./ChatDetailsView";
import { validatePhoneNumber } from "@shared/validation/phone";

interface TranslationCache {
  [key: string]: string;
}

interface MenuItem {
  id: string;
  title: string;
  subtitle?: string | null;
  icon?: string | null;
  iconBgColor?: string | null;
  iconColor?: string | null;
  itemType: string;
  actionValue?: string | null;
  leadFormFields?: string | null;
  parentId?: string | null;
  sortOrder: number;
  children?: MenuItem[];
}

interface CustomLeadField {
  id: string;
  label: string;
  fieldType: 'text' | 'dropdown' | 'textarea';
  options: string[];
  required: boolean;
  /**
   * Dropdown-only. When non-empty, the lead is only pushed to LeadSquared if
   * the visitor's answer is one of these values. Evaluated server-side.
   */
  lsqQualifyValues?: string[];
}

interface MenuConfig {
  enabled: string;
  welcomeMessage?: string | null;
  avatarUrl?: string | null;
  quickChips?: string[];
  footerText?: string | null;
  footerLinkText?: string | null;
  footerLinkUrl?: string | null;
  persistentCtaEnabled?: string;
  persistentCtaLabel?: string;
  persistentCtaIcon?: string;
  persistentCtaAction?: string;
  persistentCtaStyle?: string;
  chatInsteadStyle?: string;
  persistentCtaValue?: string | null;
  leadFormFields?: string;
}

interface MenuData {
  enabled: boolean;
  config?: MenuConfig;
  items?: MenuItem[];
}

interface ChatMenuNavigationProps {
  businessAccountId: string;
  chatColor: string;
  chatColorEnd?: string;
  avatarUrl?: string;
  selectedLanguage?: string;
  pageUrl?: string;
  conversationId?: string;
  onSwitchToChat: () => void;
  onSendMessage: (message: string, itemId: string) => void;
  onStartJourney?: (journeyId: string) => void;
  onCallPhone?: (phone: string) => void;
  onOpenUrl?: (url: string) => void;
}

const getIconComponent = (iconName?: string | null) => {
  switch (iconName) {
    case "phone":
      return Phone;
    case "message-square":
    case "message":
    case "chat":
      return MessageSquare;
    case "folder":
      return Folder;
    case "book-open":
      return BookOpen;
    case "graduation-cap":
      return GraduationCap;
    case "briefcase":
      return Briefcase;
    case "shopping-bag":
      return ShoppingBag;
    case "star":
      return Star;
    case "heart":
      return Heart;
    case "help-circle":
      return HelpCircle;
    case "link":
    case "url":
      return ExternalLink;
    case "file":
    case "form":
      return FileText;
    default:
      return ChevronRight;
  }
};

export function ChatMenuNavigation({
  businessAccountId,
  chatColor,
  chatColorEnd,
  avatarUrl,
  selectedLanguage,
  onSwitchToChat,
  onSendMessage,
  onStartJourney,
  onCallPhone,
  onOpenUrl,
  pageUrl: pageUrlProp,
  conversationId,
}: ChatMenuNavigationProps) {
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTranslating, setIsTranslating] = useState(false);
  const [navigationStack, setNavigationStack] = useState<MenuItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingDetailsItem, setViewingDetailsItem] = useState<MenuItem | null>(null);
  const [translations, setTranslations] = useState<TranslationCache>({});
  const translationCacheRef = useRef<{ [lang: string]: TranslationCache }>({});
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadFormTitle, setLeadFormTitle] = useState('Get in Touch');
  const [activeLeadFormFields, setActiveLeadFormFields] = useState<string | null>(null);
  // Which saved form config this submission came from: a menu item id, or the
  // persistent CTA. The server uses this to load the authoritative field config
  // when deciding whether the lead qualifies for LeadSquared sync.
  const [activeLeadFormSource, setActiveLeadFormSource] = useState<string>('persistent_cta');
  const [leadFormData, setLeadFormData] = useState<{ name: string; phone: string; email: string; customFields: Record<string, string> }>({ name: "", phone: "", email: "", customFields: {} });
  const [leadFormSubmitting, setLeadFormSubmitting] = useState(false);
  const [leadFormSuccess, setLeadFormSuccess] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Helper to get translated text or original
  const t = useCallback((text: string | null | undefined): string => {
    if (!text) return "";
    if (!selectedLanguage || selectedLanguage === 'auto' || selectedLanguage === 'en') {
      return text;
    }
    return translations[text] || text;
  }, [translations, selectedLanguage]);

  useEffect(() => {
    const fetchMenuData = async () => {
      try {
        const response = await fetch(`/api/chat-menu/public?businessAccountId=${businessAccountId}`, {
          cache: "no-store",
        });
        const data = await response.json();
        setMenuData(data);
      } catch (error) {
        console.error("Failed to fetch menu data:", error);
        setMenuData({ enabled: false });
      } finally {
        setIsLoading(false);
      }
    };

    if (businessAccountId) {
      fetchMenuData();
    }
  }, [businessAccountId]);

  // Translate menu content when language changes
  useEffect(() => {
    const translateContent = async () => {
      if (!menuData || !selectedLanguage || selectedLanguage === 'auto' || selectedLanguage === 'en') {
        setTranslations({});
        return;
      }

      // Check cache first
      if (translationCacheRef.current[selectedLanguage]) {
        setTranslations(translationCacheRef.current[selectedLanguage]);
        return;
      }

      // Collect all texts to translate
      const textsToTranslate: string[] = [];
      const config = menuData.config;
      
      if (config?.welcomeMessage) textsToTranslate.push(config.welcomeMessage);
      if (config?.footerText) textsToTranslate.push(config.footerText);
      if (config?.footerLinkText) textsToTranslate.push(config.footerLinkText);
      if (config?.persistentCtaLabel) textsToTranslate.push(config.persistentCtaLabel);
      
      // Add static UI text
      textsToTranslate.push("Chat with us instead");
      textsToTranslate.push("Get in Touch");
      textsToTranslate.push("Thank You!");
      textsToTranslate.push("We'll get back to you soon.");
      textsToTranslate.push("Please fill in your details and we'll get back to you.");
      textsToTranslate.push("Name");
      textsToTranslate.push("Mobile Number");
      textsToTranslate.push("Email");
      textsToTranslate.push("Enter your name");
      textsToTranslate.push("Enter your mobile number");
      textsToTranslate.push("Enter your email");
      textsToTranslate.push("Submit");
      textsToTranslate.push("Submitting...");
      
      // Add quick chips
      if (config?.quickChips) {
        config.quickChips.forEach(chip => textsToTranslate.push(chip));
      }

      // Collect menu item texts recursively
      const collectItemTexts = (items: MenuItem[]) => {
        for (const item of items) {
          if (item.title) textsToTranslate.push(item.title);
          if (item.subtitle) textsToTranslate.push(item.subtitle);
          
          // Collect details config texts
          if (item.itemType === 'detail' && item.actionValue) {
            try {
              const detailsConfig = JSON.parse(item.actionValue);
              if (detailsConfig.brochureLabel) textsToTranslate.push(detailsConfig.brochureLabel);
              if (Array.isArray(detailsConfig.tabs)) {
                detailsConfig.tabs.forEach((tab: { name?: string; content?: string }) => {
                  if (tab.name) textsToTranslate.push(tab.name);
                  if (tab.content) textsToTranslate.push(tab.content);
                });
              }
              if (Array.isArray(detailsConfig.actionButtons)) {
                detailsConfig.actionButtons.forEach((btn: { label?: string }) => {
                  if (btn.label) textsToTranslate.push(btn.label);
                });
              }
            } catch {}
          }
          
          if (item.children) collectItemTexts(item.children);
        }
      };
      if (menuData.items) collectItemTexts(menuData.items);

      if (textsToTranslate.length === 0) return;

      setIsTranslating(true);
      try {
        const response = await fetch('/api/chat/widget/translate-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessAccountId,
            texts: textsToTranslate,
            targetLanguage: selectedLanguage
          })
        });
        
        if (response.ok) {
          const { translatedTexts } = await response.json();
          const newCache: TranslationCache = {};
          textsToTranslate.forEach((original, index) => {
            newCache[original] = translatedTexts[index] || original;
          });
          translationCacheRef.current[selectedLanguage] = newCache;
          setTranslations(newCache);
        }
      } catch (error) {
        console.error('Translation failed:', error);
      } finally {
        setIsTranslating(false);
      }
    };

    translateContent();
  }, [menuData, selectedLanguage, businessAccountId]);

  const currentItems = useMemo(() => {
    if (!menuData?.items) return [];
    if (navigationStack.length === 0) {
      return menuData.items;
    }
    const currentParent = navigationStack[navigationStack.length - 1];
    return currentParent.children || [];
  }, [menuData?.items, navigationStack]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return currentItems;
    const query = searchQuery.toLowerCase();
    return currentItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.subtitle?.toLowerCase().includes(query)
    );
  }, [currentItems, searchQuery]);

  const handleItemClick = (item: MenuItem) => {
    switch (item.itemType) {
      case "navigate":
        if (item.children && item.children.length > 0) {
          setNavigationStack([...navigationStack, item]);
          setSearchQuery("");
        }
        break;
      case "chat":
        onSendMessage(item.title, item.id);
        break;
      case "url":
        if (item.actionValue) {
          if (onOpenUrl) {
            onOpenUrl(item.actionValue);
          } else {
            window.open(item.actionValue, "_blank");
          }
        }
        break;
      case "phone":
        if (item.actionValue) {
          if (onCallPhone) {
            onCallPhone(item.actionValue);
          } else {
            window.location.href = `tel:${item.actionValue}`;
          }
        }
        break;
      case "form":
        if (item.actionValue && onStartJourney) {
          onStartJourney(item.actionValue);
        } else {
          onSendMessage(item.actionValue || `Start ${item.title} form`);
        }
        break;
      case "lead_form":
        setLeadFormTitle(item.title || 'Get in Touch');
        setActiveLeadFormFields(item.leadFormFields || null);
        setActiveLeadFormSource(item.id);
        setShowLeadForm(true);
        break;
      case "detail":
        const detailsConfig = parseDetailsConfig(item.actionValue);
        if (detailsConfig) {
          setViewingDetailsItem(item);
        } else {
          setNavigationStack([...navigationStack, item]);
        }
        break;
      default:
        if (item.children && item.children.length > 0) {
          setNavigationStack([...navigationStack, item]);
          setSearchQuery("");
        }
    }
  };

  const handleBack = () => {
    if (navigationStack.length > 0) {
      setNavigationStack(navigationStack.slice(0, -1));
      setSearchQuery("");
    }
  };

  const handleQuickChipClick = (chip: string) => {
    onSendMessage(chip);
  };

  const handlePersistentCta = () => {
    const config = menuData?.config;
    if (!config) return;

    switch (config.persistentCtaAction) {
      case "chat":
        onSwitchToChat();
        break;
      case "phone":
        if (config.persistentCtaValue) {
          window.location.href = `tel:${config.persistentCtaValue}`;
        }
        break;
      case "url":
        if (config.persistentCtaValue) {
          window.open(config.persistentCtaValue, "_blank");
        }
        break;
      case "lead_form":
        setLeadFormTitle(config.persistentCtaLabel || 'Get in Touch');
        setActiveLeadFormFields(null);
        setActiveLeadFormSource('persistent_cta');
        setShowLeadForm(true);
        break;
    }
  };

  const handleLeadFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (leadFormSubmitting) return;
    
    const hasStandardData = leadFormData.name || leadFormData.phone || leadFormData.email;
    const hasCustomData = Object.values(leadFormData.customFields).some(v => v !== undefined && v !== '');
    if (!hasStandardData && !hasCustomData) {
      return;
    }
    
    if (leadFormData.phone && leadFormData.phone.length > 0) {
      const validation = validatePhoneNumber(leadFormData.phone, '10');
      if (!validation.isValid) {
        setPhoneError(validation.reasonMessage);
        return;
      }
    }
    setPhoneError(null);
    
    setLeadFormSubmitting(true);
    try {
      const visitorToken = (() => {
        const perBusinessKey = `chroney_visitor_${businessAccountId}`;
        return localStorage.getItem(perBusinessKey) || localStorage.getItem('chroney_visitor_token') || null;
      })();
      const response = await fetch('/api/chat/widget/capture-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessAccountId,
          name: leadFormData.name || null,
          phone: leadFormData.phone || null,
          email: leadFormData.email || null,
          customFields: (() => {
            const labeled: Record<string, string> = {};
            for (const field of fieldsConfig.custom || []) {
              const val = leadFormData.customFields[field.id];
              if (val !== undefined && val !== '') labeled[field.label] = val;
            }
            return labeled;
          })(),
          // Same answers keyed by stable field id. Labels can collide or be
          // renamed, so LeadSquared qualification is evaluated server-side
          // against these ids and the account's saved form config.
          customFieldsById: (() => {
            const byId: Record<string, string> = {};
            for (const field of fieldsConfig.custom || []) {
              const val = leadFormData.customFields[field.id];
              if (val !== undefined && val !== '') byId[field.id] = val;
            }
            return byId;
          })(),
          leadFormSource: activeLeadFormSource,
          source: 'menu_lead_form',
          formTitle: leadFormTitle,
          conversationId: conversationId || null,
          visitorToken,
          pageUrl: pageUrlProp || (() => {
            const params = new URLSearchParams(window.location.search);
            const src = params.get('sourceUrl') || params.get('parentUrl');
            if (src) return src.startsWith('http') ? src : window.location.origin + src;
            return window.location.href;
          })(),
        })
      });
      
      if (response.ok) {
        setLeadFormSuccess(true);
        setTimeout(() => {
          setShowLeadForm(false);
          setLeadFormSuccess(false);
          setLeadFormData({ name: "", phone: "", email: "", customFields: {} });
          setPhoneError(null);
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to submit lead form:', error);
    } finally {
      setLeadFormSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: chatColor }} />
      </div>
    );
  }

  if (!menuData?.enabled) {
    return null;
  }

  // Parse lead form fields configuration
  const parseLeadFormFieldsConfig = (str?: string): Record<string, { visible: boolean; required: boolean }> & { custom?: CustomLeadField[] } => {
    if (!str) {
      return { name: { visible: true, required: true }, phone: { visible: true, required: false }, custom: [] };
    }
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...parsed, custom: parsed.custom || [] };
      }
    } catch {
      // Legacy format: comma-separated field names
      const fields = str.split(",").filter(f => f);
      const result: Record<string, { visible: boolean; required: boolean }> = {};
      fields.forEach((f, i) => {
        result[f] = { visible: true, required: i === 0 };
      });
      return { ...result, custom: [] };
    }
    return { name: { visible: true, required: true }, phone: { visible: true, required: false }, custom: [] };
  };

  const fieldsConfig = parseLeadFormFieldsConfig(activeLeadFormFields || menuData?.config?.leadFormFields);

  // Lead Form Overlay
  if (showLeadForm) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-white">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <button
            onClick={() => {
              setShowLeadForm(false);
              setLeadFormData({ name: "", phone: "", email: "", customFields: {} });
              setPhoneError(null);
            }}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <span className="font-medium text-gray-800">{t(leadFormTitle)}</span>
        </div>
        
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-6">
          {leadFormSuccess ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("Thank You!")}</h3>
              <p className="text-gray-500 text-center">{t("We'll get back to you soon.")}</p>
            </div>
          ) : (
            <form onSubmit={handleLeadFormSubmit} className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">{t("Please fill in your details and we'll get back to you.")}</p>
              
              {fieldsConfig.name?.visible && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">{t("Name")} {fieldsConfig.name?.required && <span className="text-red-500">*</span>}</label>
                  <input
                    type="text"
                    value={leadFormData.name}
                    onChange={(e) => setLeadFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder={t("Enter your name")}
                    required={fieldsConfig.name?.required}
                  />
                </div>
              )}
              
              {fieldsConfig.phone?.visible && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">{t("Mobile Number")} {fieldsConfig.phone?.required && <span className="text-red-500">*</span>}</label>
                  <input
                    type="tel"
                    value={leadFormData.phone}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setLeadFormData(prev => ({ ...prev, phone: value }));
                      if (phoneError) setPhoneError(null);
                    }}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder={t("Enter your mobile number")}
                    required={fieldsConfig.phone?.required}
                    pattern="[0-9]{10}"
                    minLength={10}
                    maxLength={10}
                    title={t("Please enter a valid 10-digit mobile number")}
                  />
                  {phoneError && (
                    <p className="text-xs text-red-500">{t(phoneError)}</p>
                  )}
                  {!phoneError && leadFormData.phone && leadFormData.phone.length > 0 && leadFormData.phone.length < 10 && (
                    <p className="text-xs text-red-500">{t("Please enter a 10-digit mobile number")}</p>
                  )}
                </div>
              )}
              
              {fieldsConfig.email?.visible && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">{t("Email")} {fieldsConfig.email?.required && <span className="text-red-500">*</span>}</label>
                  <input
                    type="email"
                    value={leadFormData.email}
                    onChange={(e) => setLeadFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder={t("Enter your email")}
                    required={fieldsConfig.email?.required}
                  />
                </div>
              )}

              {(fieldsConfig.custom || []).map((field) => (
                <div key={field.id} className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    {t(field.label)} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {field.fieldType === 'dropdown' ? (
                    <select
                      value={leadFormData.customFields[field.id] || ''}
                      onChange={(e) => setLeadFormData(prev => ({ ...prev, customFields: { ...prev.customFields, [field.id]: e.target.value } }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white text-sm"
                      required={field.required}
                    >
                      <option value="">{t("Select an option")}</option>
                      {field.options.map((opt) => (
                        <option key={opt} value={opt}>{t(opt)}</option>
                      ))}
                    </select>
                  ) : field.fieldType === 'textarea' ? (
                    <textarea
                      value={leadFormData.customFields[field.id] || ''}
                      onChange={(e) => setLeadFormData(prev => ({ ...prev, customFields: { ...prev.customFields, [field.id]: e.target.value } }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm resize-none"
                      placeholder={t(field.label)}
                      rows={3}
                      required={field.required}
                    />
                  ) : (
                    <input
                      type="text"
                      value={leadFormData.customFields[field.id] || ''}
                      onChange={(e) => setLeadFormData(prev => ({ ...prev, customFields: { ...prev.customFields, [field.id]: e.target.value } }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder={t(field.label)}
                      required={field.required}
                    />
                  )}
                </div>
              ))}
              
              <button
                type="submit"
                disabled={leadFormSubmitting}
                className="w-full py-3 px-4 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition-transform active:scale-98 disabled:opacity-70"
                style={{
                  background: chatColorEnd
                    ? `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`
                    : chatColor,
                }}
              >
                {leadFormSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("Submitting...")}
                  </>
                ) : (
                  t("Submit")
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (viewingDetailsItem) {
    const detailsConfig = parseDetailsConfig(viewingDetailsItem.actionValue);
    if (detailsConfig) {
      return (
        <ChatDetailsView
          title={viewingDetailsItem.title}
          config={detailsConfig}
          onBack={() => setViewingDetailsItem(null)}
          onStartChat={onSwitchToChat}
          onSendMessage={onSendMessage}
          chatColor={chatColor}
          chatColorEnd={chatColorEnd}
          t={t}
        />
      );
    }
  }

  const config = menuData.config;
  const isAtRoot = navigationStack.length === 0;
  const currentTitle = isAtRoot ? null : navigationStack[navigationStack.length - 1].title;
  const showSearch = currentItems.length > 5;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      {isAtRoot && config?.welcomeMessage && (
        <div className="p-4 pb-2">
          <div className="flex flex-col items-center text-center">
            {(config.avatarUrl || avatarUrl) && (
              <img
                src={config.avatarUrl || avatarUrl}
                alt="Assistant"
                className="w-16 h-16 rounded-full object-cover mb-3"
              />
            )}
            <h2 className="text-xl font-bold text-gray-900 leading-tight">
              {isTranslating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {config.welcomeMessage}
                </span>
              ) : t(config.welcomeMessage)}
            </h2>
          </div>

          {config.quickChips && config.quickChips.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 justify-center">
              {config.quickChips.map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickChipClick(chip)}
                  className="px-3 py-1.5 text-sm rounded-full border transition-colors hover:bg-gray-50"
                  style={{ borderColor: chatColor, color: chatColor }}
                >
                  {t(chip)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!isAtRoot && (
        <div className="flex items-center gap-2 p-3 border-b border-gray-100">
          <button
            onClick={handleBack}
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <span className="font-medium text-gray-800">{t(currentTitle)}</span>
        </div>
      )}

      {showSearch && (
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-300"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={navigationStack.length}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            {filteredItems.map((item) => {
              const hasChildren = item.children && item.children.length > 0;
              const IconComponent = getIconComponent(item.icon);

              return (
                <button
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left group"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: item.iconBgColor || "#E0E7FF",
                    }}
                  >
                    {item.icon ? (
                      <span
                        className="text-lg"
                        style={{ color: item.iconColor || "#4F46E5" }}
                      >
                        {item.icon.length <= 2 ? item.icon : <IconComponent className="w-5 h-5" />}
                      </span>
                    ) : (
                      <ChevronRight
                        className="w-5 h-5"
                        style={{ color: item.iconColor || "#4F46E5" }}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-800">{t(item.title)}</p>
                    {item.subtitle && (
                      <p className="text-xs text-gray-500">{t(item.subtitle)}</p>
                    )}
                  </div>
                  {(hasChildren || item.itemType === "navigate") && (
                    <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
                  )}
                </button>
              );
            })}

            {filteredItems.length === 0 && searchQuery && (
              <div className="text-center py-8 text-gray-500">
                <p>No items found for "{searchQuery}"</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {(config?.footerText || config?.footerLinkText) && isAtRoot && (
        <div className="px-4 py-2 text-center text-xs text-gray-400 border-t border-gray-100">
          {config.footerText && <span className="text-sm text-black">{t(config.footerText)} </span>}
          {config.footerLinkUrl && config.footerLinkText && (
            <a
              href={config.footerLinkUrl.startsWith('http') ? config.footerLinkUrl : `https://${config.footerLinkUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {t(config.footerLinkText)}
            </a>
          )}
        </div>
      )}

      {config?.persistentCtaEnabled === "true" && (
        <div className="p-3 border-t border-gray-100">
          {(config?.persistentCtaStyle || "chatbox") === "chatbox" ? (
            <button
              onClick={handlePersistentCta}
              className="w-full py-3 px-4 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition-transform active:scale-98"
              style={{
                background: chatColorEnd
                  ? `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`
                  : chatColor,
              }}
            >
              {config.persistentCtaIcon === "phone" && <Phone className="w-5 h-5" />}
              {config.persistentCtaIcon === "chat" && <MessageCircle className="w-5 h-5" />}
              {config.persistentCtaAction === "lead_form" && <FileText className="w-5 h-5" />}
              {t(config.persistentCtaLabel) || "Contact Us"}
            </button>
          ) : (
            <button
              onClick={handlePersistentCta}
              className="w-full py-3 px-4 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              {config.persistentCtaIcon === "phone" && <Phone className="w-5 h-5" />}
              {config.persistentCtaIcon === "chat" && <MessageCircle className="w-5 h-5" />}
              {config.persistentCtaAction === "lead_form" && <FileText className="w-5 h-5" />}
              {t(config.persistentCtaLabel) || "Contact Us"}
            </button>
          )}
        </div>
      )}

      <div className="px-3 pb-3 pt-1 border-t border-gray-100">
        {config?.chatInsteadStyle === "chatbox" ? (
          <button
            onClick={onSwitchToChat}
            className="w-full py-2.5 px-4 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 transition-transform active:scale-98"
            style={{
              background: chatColorEnd
                ? `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`
                : chatColor,
            }}
          >
            <MessageCircle className="w-4 h-4" />
            {t("Chat with us instead") || "Chat with us instead"}
          </button>
        ) : (
          <button
            onClick={onSwitchToChat}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-4 h-4" />
            {t("Chat with us instead") || "Chat with us instead"}
          </button>
        )}
      </div>
    </div>
  );
}
