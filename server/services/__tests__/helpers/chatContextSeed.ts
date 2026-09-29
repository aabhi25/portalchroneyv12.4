/**
 * Seeds a realistic website-chat business (fictional "Northwind Fitness Club") for the
 * chat-context tests and scripts/chat-context-benchmark.ts: website analysis, N analyzed
 * pages, N training documents (summary + key points + embedded chunks) and N embedded
 * FAQs. Every page / doc / FAQ carries one unique fact so tests can check that the right
 * one reaches the prompt. Embeddings come from the fake OpenAI's deterministic function.
 */
import { fakeEmbedding } from './fakeOpenAIChat';

type Topic = { slug: string; title: string; words: string; fact: string };

// 40 website topics. `fact` is the unique, checkable sentence on that page.
export const PAGE_TOPICS: Topic[] = [
  { slug: 'yoga-classes', title: 'Yoga Classes', words: 'yoga flexibility breathing meditation stretching', fact: 'Yoga mat rental costs ₹150 per session at the front desk.' },
  { slug: 'pilates', title: 'Pilates', words: 'pilates reformer core posture', fact: 'Reformer pilates is limited to 8 people per class.' },
  { slug: 'spin-classes', title: 'Spin Classes', words: 'spin cycling cardio bikes', fact: 'Spin shoes with SPD cleats can be borrowed free of charge.' },
  { slug: 'personal-training', title: 'Personal Training', words: 'personal trainer coaching program goals', fact: 'A 10-session personal training pack costs ₹18,000.' },
  { slug: 'membership-plans', title: 'Membership Plans', words: 'membership plan monthly annual joining', fact: 'The annual Gold membership costs ₹24,000 and includes 4 guest passes.' },
  { slug: 'student-discount', title: 'Student Discount', words: 'student discount college id', fact: 'Students with a valid college ID get 20% off any membership.' },
  { slug: 'senior-discount', title: 'Senior Citizens', words: 'senior citizen discount age', fact: 'Members aged 60 and above get 30% off and free physiotherapy screening.' },
  { slug: 'corporate-plans', title: 'Corporate Plans', words: 'corporate company employees team wellness', fact: 'Companies with 25+ employees get the corporate rate of ₹1,200 per employee per month.' },
  { slug: 'opening-hours', title: 'Opening Hours', words: 'hours open close timings weekday weekend', fact: 'The club is open 5:30 am to 11 pm on weekdays and 7 am to 8 pm on weekends.' },
  { slug: 'parking', title: 'Parking', words: 'parking car bike basement validation', fact: 'Basement parking is free for 3 hours with validation code PK-4417 at reception.' },
  { slug: 'locations', title: 'Locations', words: 'location branch address city', fact: 'Our branches are in Koramangala, Indiranagar and Whitefield.' },
  { slug: 'swimming-pool', title: 'Swimming Pool', words: 'swimming pool lanes lessons water', fact: 'The pool has 6 lanes and adult swim lessons cost ₹3,500 per month.' },
  { slug: 'sauna-steam', title: 'Sauna and Steam', words: 'sauna steam room recovery heat', fact: 'The sauna is closed every Sunday for deep cleaning.' },
  { slug: 'childcare', title: 'Kids Zone', words: 'kids childcare creche children play', fact: 'The Kids Zone takes children aged 3 to 10 for up to 2 hours.' },
  { slug: 'nutrition', title: 'Nutrition Coaching', words: 'nutrition diet meal plan dietitian', fact: 'Nutrition consultations are with dietitian Dr. Meera Rao on Tuesdays.' },
  { slug: 'physiotherapy', title: 'Physiotherapy', words: 'physiotherapy injury rehab pain', fact: 'Physiotherapy sessions cost ₹1,100 and need a doctor referral for insurance claims.' },
  { slug: 'group-classes', title: 'Group Classes', words: 'group class schedule zumba hiit', fact: 'Zumba runs Monday, Wednesday and Friday at 7 pm.' },
  { slug: 'strength-zone', title: 'Strength Zone', words: 'strength weights squat racks deadlift', fact: 'The strength zone has 12 squat racks and competition kettlebells.' },
  { slug: 'boxing', title: 'Boxing', words: 'boxing gloves punching bags sparring', fact: 'Boxing gloves must be your own; hand wraps are sold for ₹400.' },
  { slug: 'lockers', title: 'Lockers', words: 'locker storage valuables key', fact: 'Monthly private lockers cost ₹600; day lockers are free with a padlock.' },
  { slug: 'towels', title: 'Towel Service', words: 'towel laundry shower toiletries', fact: 'Towel service is included in Gold and Platinum plans only.' },
  { slug: 'freeze-policy', title: 'Membership Freeze', words: 'freeze pause membership travel medical', fact: 'Annual members can freeze their membership for up to 60 days per year.' },
  { slug: 'refund-policy', title: 'Refund Policy', words: 'refund cancellation money back', fact: 'Refunds are only issued within 7 days of joining, minus a ₹1,000 admin fee.' },
  { slug: 'guest-passes', title: 'Guest Passes', words: 'guest pass friend visitor trial', fact: 'A single guest pass costs ₹500 and guests must bring photo ID.' },
  { slug: 'free-trial', title: 'Free Trial', words: 'free trial first visit tour', fact: 'New visitors get one free 3-day trial after a guided tour.' },
  { slug: 'gift-cards', title: 'Gift Cards', words: 'gift card voucher present', fact: 'Gift cards are valid for 12 months and start at ₹2,000.' },
  { slug: 'app', title: 'Member App', words: 'app booking mobile android iphone', fact: 'Classes are booked in the Northwind app up to 7 days ahead.' },
  { slug: 'dress-code', title: 'Dress Code', words: 'dress code clothes shoes attire', fact: 'Closed-toe sports shoes are mandatory on the gym floor.' },
  { slug: 'safety', title: 'Safety', words: 'safety first aid defibrillator staff', fact: 'Every floor has a defibrillator and CPR-certified staff.' },
  { slug: 'careers', title: 'Careers', words: 'jobs careers hiring trainer vacancy', fact: 'Trainer applicants need an ACE or ISSA certification.' },
  { slug: 'events', title: 'Events', words: 'events challenge marathon community', fact: 'The annual Northwind 10K run is held on the second Sunday of December.' },
  { slug: 'cafe', title: 'Protein Cafe', words: 'cafe smoothie protein shake food', fact: 'The protein cafe serves a whey shake for ₹220.' },
  { slug: 'wheelchair-access', title: 'Accessibility', words: 'wheelchair accessible disability lift ramp', fact: 'All branches have ramps and an accessible lift to every floor.' },
  { slug: 'women-only', title: 'Women Only Hours', words: 'women ladies only hours privacy', fact: 'Women-only hours are 11 am to 1 pm daily in the Indiranagar branch.' },
  { slug: 'online-classes', title: 'Online Classes', words: 'online live stream virtual classes home', fact: 'Live online classes are included free with every membership.' },
  { slug: 'body-composition', title: 'Body Composition Scan', words: 'body composition scan fat muscle inbody', fact: 'An InBody scan is free every 30 days for members.' },
  { slug: 'transfer-policy', title: 'Membership Transfer', words: 'transfer membership another person', fact: 'Memberships can be transferred once for a ₹1,500 fee.' },
  { slug: 'payment-options', title: 'Payment Options', words: 'payment emi card upi instalments', fact: 'No-cost EMI is available on annual plans with HDFC and ICICI cards.' },
  { slug: 'contact', title: 'Contact Us', words: 'contact phone email support', fact: 'Support is reachable on WhatsApp at +91 80 4000 1234.' },
  { slug: 'about-us', title: 'About Us', words: 'about history founder story', fact: 'Northwind Fitness Club was founded in 2012 by Arjun Mehta.' },
];

export const DOC_TOPICS: Topic[] = [
  { slug: 'pt-terms.pdf', title: 'Personal Training Terms', words: 'personal training cancellation notice session', fact: 'Personal training sessions need 48 hours notice to cancel without losing the session.' },
  { slug: 'membership-agreement.pdf', title: 'Membership Agreement', words: 'membership agreement contract terms', fact: 'The membership agreement auto-renews unless cancelled 30 days before expiry.' },
  { slug: 'class-timetable.pdf', title: 'Class Timetable', words: 'timetable schedule classes weekly', fact: 'Early-bird HIIT starts at 6:15 am on Tuesdays and Thursdays.' },
  { slug: 'pool-rules.pdf', title: 'Pool Rules', words: 'pool rules swimming caps hygiene', fact: 'Swimming caps are compulsory and sold at the pool desk for ₹250.' },
  { slug: 'nutrition-guide.pdf', title: 'Nutrition Guide', words: 'nutrition guide protein calories', fact: 'The guide recommends 1.6 g of protein per kg of body weight for muscle gain.' },
  { slug: 'corporate-brochure.pdf', title: 'Corporate Brochure', words: 'corporate brochure wellness employer', fact: 'Corporate wellness days include an on-site health camp twice a year.' },
  { slug: 'kids-programs.pdf', title: 'Kids Programs', words: 'kids programs swimming gymnastics', fact: 'Kids gymnastics batches are on Saturdays at 10 am.' },
  { slug: 'rehab-protocol.pdf', title: 'Rehab Protocol', words: 'rehab injury protocol knee shoulder', fact: 'The knee rehab protocol runs for 6 weeks with 3 supervised sessions a week.' },
  { slug: 'franchise-info.pdf', title: 'Franchise Information', words: 'franchise investment partner business', fact: 'A Northwind franchise needs a minimum 8,000 sq ft space.' },
  { slug: 'code-of-conduct.pdf', title: 'Code of Conduct', words: 'conduct behaviour rules members', fact: 'Members must re-rack weights; repeated violations lead to a 7-day suspension.' },
];

export const FAQ_TOPICS: Array<{ q: string; a: string }> = [
  { q: 'Do you offer a student discount?', a: 'Yes — students with a valid college ID get 20% off any membership.' },
  { q: 'What are your opening hours?', a: 'We are open 5:30 am to 11 pm on weekdays and 7 am to 8 pm on weekends.' },
  { q: 'Is there a joining fee?', a: 'The one-time joining fee is ₹2,500, waived during the monthly offer week.' },
  { q: 'Can I pause my membership?', a: 'Annual members can freeze for up to 60 days per year.' },
  { q: 'Do you have showers?', a: 'Yes, every branch has hot showers and changing rooms.' },
  { q: 'Can I bring a friend?', a: 'Yes, a guest pass costs ₹500; guests need photo ID.' },
  { q: 'Do you have a swimming pool?', a: 'Yes, a 6-lane pool at the Whitefield branch.' },
  { q: 'Is personal training included?', a: 'No, personal training is sold separately in packs.' },
  { q: 'What payment methods do you accept?', a: 'Cards, UPI and no-cost EMI on annual plans.' },
  { q: 'Can I cancel my membership?', a: 'You can cancel with 30 days notice; refunds only within 7 days of joining.' },
  { q: 'Is parking available?', a: 'Yes, basement parking is free for 3 hours with validation.' },
  { q: 'Do you have trainers for beginners?', a: 'Every new member gets two free induction sessions with a trainer.' },
  { q: 'What should I wear?', a: 'Comfortable sportswear and closed-toe sports shoes.' },
  { q: 'Do you have lockers?', a: 'Day lockers are free; monthly lockers cost ₹600.' },
  { q: 'Is there a kids area?', a: 'The Kids Zone takes children aged 3 to 10 for up to 2 hours.' },
  { q: 'Do you sell supplements?', a: 'The protein cafe sells whey, creatine and electrolyte drinks.' },
  { q: 'Can I transfer my membership?', a: 'Once, for a ₹1,500 transfer fee.' },
  { q: 'Do you offer corporate memberships?', a: 'Yes, for companies with 25 or more employees.' },
  { q: 'Is there Wi-Fi?', a: 'Free Wi-Fi is available in the lounge and cafe.' },
  { q: 'Do you run group classes?', a: 'Yes, over 60 group classes a week including zumba, spin and HIIT.' },
  { q: 'Do you have women-only hours?', a: 'Yes, 11 am to 1 pm daily at Indiranagar.' },
  { q: 'How do I book classes?', a: 'Book in the Northwind app up to 7 days ahead.' },
  { q: 'Is there a free trial?', a: 'Yes, a free 3-day trial after a guided tour.' },
  { q: 'Do you provide towels?', a: 'Towels are included in Gold and Platinum plans.' },
  { q: 'Are the branches wheelchair accessible?', a: 'Yes, all branches have ramps and accessible lifts.' },
  { q: 'Do you have a sauna?', a: 'Yes, sauna and steam rooms at every branch (sauna closed Sundays).' },
  { q: 'Can I get a diet plan?', a: 'Nutrition coaching with our dietitian is available on Tuesdays.' },
  { q: 'Do you have physiotherapy?', a: 'Yes, sessions cost ₹1,100 each.' },
  { q: 'Are online classes available?', a: 'Live online classes are free with every membership.' },
  { q: 'How old do I need to be to join?', a: 'Members must be 16 or older; 16–17 year olds need a parent’s consent.' },
];

const FILLER = [
  'Our coaches are certified professionals who design every session around your goals, whether you are just starting out or training for competition. We believe fitness should be enjoyable, sustainable and part of a healthy lifestyle.',
  'Members can combine this with any of our other facilities. Please speak to the front desk team or our member experience managers if you need help choosing the right option, adjusting your schedule or understanding what is included in your plan.',
  'We regularly review feedback from members to improve equipment, cleanliness and class quality. All equipment is serviced monthly and sanitised several times a day by our housekeeping team.',
  'Visit any of our branches for a guided tour, or message us to arrange a call with a membership advisor who can explain the options in detail.',
];

export function pageContent(t: Topic, i: number): string {
  return [
    `${t.title} at Northwind Fitness Club. This page covers ${t.words}.`,
    `${t.fact} Our ${t.title.toLowerCase()} offering is popular with members who care about ${t.words.split(' ').slice(0, 2).join(' and ')}.`,
    FILLER[i % FILLER.length],
    `More about ${t.title.toLowerCase()}: ${t.words} are all part of the experience. ${FILLER[(i + 1) % FILLER.length]}`,
    FILLER[(i + 2) % FILLER.length],
    `${t.title} FAQs: ask our team about ${t.words}. ${FILLER[(i + 3) % FILLER.length]}`,
  ].join('\n\n');
}

export function docChunks(t: Topic): string[] {
  return [
    `${t.title}. Section 1 — overview of ${t.words}. ${FILLER[0]}`,
    `${t.title}. Section 2 — key rule. ${t.fact} ${FILLER[1]}`,
    `${t.title}. Section 3 — details on ${t.words}. ${FILLER[2]}`,
    `${t.title}. Section 4 — member responsibilities. ${FILLER[3]}`,
    `${t.title}. Section 5 — exceptions for ${t.words}. ${FILLER[1]}`,
    `${t.title}. Section 6 — contact. For questions about ${t.words} contact the front desk.`,
  ];
}

export const WEBSITE_FACTS = {
  businessName: 'Northwind Fitness Club',
  businessDescription: 'Northwind Fitness Club is a premium gym and wellness club in Bengaluru with strength, cardio, pool, group classes, personal training, physiotherapy and nutrition coaching under one roof.',
  mainProducts: ['Gold membership', 'Platinum membership', 'Personal training packs', 'Gift cards'],
  mainServices: ['Group classes', 'Personal training', 'Swimming lessons', 'Physiotherapy', 'Nutrition coaching', 'Corporate wellness'],
  keyFeatures: ['3 branches', '60+ weekly classes', '6-lane pool', 'Free InBody scans'],
  targetAudience: 'Working professionals, students and families in Bengaluru',
  uniqueSellingPoints: ['Open 5:30 am to 11 pm', 'Certified coaches', 'No-cost EMI'],
  contactInfo: { email: 'hello@northwind.example', phone: '+91 80 4000 1234', address: '80 Feet Road, Koramangala, Bengaluru' },
  businessHours: 'Weekdays 5:30 am – 11 pm, weekends 7 am – 8 pm',
  pricingInfo: 'Monthly from ₹2,500; annual Gold ₹24,000; Platinum ₹36,000',
  additionalInfo: 'Free 3-day trial for new visitors.',
};

export interface SeedResult { accountId: string; userId: string }

export async function seedChatBusiness(
  db: any, schema: any,
  opts: { tag: string; name?: string; pages?: number; docs?: number; faqs?: number; secret?: string },
): Promise<SeedResult> {
  const nPages = opts.pages ?? 40, nDocs = opts.docs ?? 10, nFaqs = opts.faqs ?? 30;
  const [biz] = await db.insert(schema.businessAccounts).values({
    name: `${opts.name || 'Northwind Fitness'} ${opts.tag}`, website: 'https://northwind.example', openaiApiKey: 'sk-test-fake',
  }).returning();
  const [user] = await db.insert(schema.users).values({
    username: `seed_${opts.tag}_${biz.id.slice(0, 6)}`, passwordHash: 'x', role: 'business_user', businessAccountId: biz.id,
  }).returning();

  await db.insert(schema.widgetSettings).values({ businessAccountId: biz.id }).onConflictDoNothing();
  await db.insert(schema.websiteAnalysis).values({
    businessAccountId: biz.id, websiteUrl: 'https://northwind.example', status: 'completed', analyzedContent: JSON.stringify(WEBSITE_FACTS),
  });

  const pages = PAGE_TOPICS.slice(0, nPages).map((t, i) => ({
    businessAccountId: biz.id, pageUrl: `https://northwind.example/${t.slug}`, extractedContent: pageContent(t, i),
  }));
  if (pages.length) await db.insert(schema.analyzedPages).values(pages);

  for (const t of DOC_TOPICS.slice(0, nDocs)) {
    const [doc] = await db.insert(schema.trainingDocuments).values({
      businessAccountId: biz.id, filename: t.slug, originalFilename: t.slug, fileSize: '1000', storageKey: `k/${t.slug}`,
      uploadStatus: 'completed', uploadedBy: user.id, embeddingStatus: 'completed',
      summary: `${t.title}: this document explains ${t.words} for Northwind members, including rules, pricing notes and exceptions. ${FILLER[0]}`,
      keyPoints: JSON.stringify([`Covers ${t.words}`, 'Applies to all branches', 'Updated every quarter', 'Ask the front desk for a printed copy', FILLER[3]]),
    }).returning();
    const chunks = docChunks(t);
    await db.insert(schema.documentChunks).values(chunks.map((c, i) => ({
      trainingDocumentId: doc.id, businessAccountId: biz.id, chunkText: c, chunkIndex: i, embedding: fakeEmbedding(c),
    })));
  }

  const faqRows = FAQ_TOPICS.slice(0, nFaqs).map(f => ({
    businessAccountId: biz.id, question: f.q, answer: f.a, embedding: fakeEmbedding(`Question: ${f.q}\nAnswer: ${f.a}`),
  }));
  if (opts.secret) {
    faqRows.push({ businessAccountId: biz.id, question: 'What is the vault access code?', answer: opts.secret, embedding: fakeEmbedding(`Question: What is the vault access code?\nAnswer: ${opts.secret}`) });
  }
  if (faqRows.length) await db.insert(schema.faqs).values(faqRows);
  if (opts.secret) {
    const [doc] = await db.insert(schema.trainingDocuments).values({
      businessAccountId: biz.id, filename: 'vault.pdf', originalFilename: 'vault.pdf', fileSize: '10', storageKey: 'k/vault.pdf',
      uploadStatus: 'completed', uploadedBy: user.id, embeddingStatus: 'completed', summary: null, keyPoints: null,
    }).returning();
    const c = `Vault access code for the back office: ${opts.secret}.`;
    await db.insert(schema.documentChunks).values({ trainingDocumentId: doc.id, businessAccountId: biz.id, chunkText: c, chunkIndex: 0, embedding: fakeEmbedding(c) });
  }
  return { accountId: biz.id, userId: user.id };
}
