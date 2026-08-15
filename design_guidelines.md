# Design Guidelines: AI Chroney Chat Application

## Design Approach

**Reference-Based Approach**: AI Chroney Interface
This application features a clean, card-based design with a friendly, approachable aesthetic. The design emphasizes clarity through white card messages, consistent avatars, and a warm color palette centered on red/pink and purple gradients.

## Core Design Principles

1. **Card-Based Clarity**: All messages appear in clean white cards with subtle shadows
2. **Consistent Avatar System**: Both user and AI messages display avatars on the left
3. **Friendly Branding**: "Hi Chroney" header with active status indicator
4. **Clean White Space**: Light gray background with ample spacing between elements
5. **Vibrant Accents**: Red/pink gradient header, purple gradient action buttons

---

## Layout System

### Spacing Primitives
Use Tailwind units: **2, 3, 4, 6, 8, 12, 16** for consistent rhythm
- Message card padding: p-4
- Message spacing: mb-4
- Container padding: px-4, py-3
- Between sections: mb-6, mt-8

### Viewport Structure
```
┌─────────────────────────────┐
│   Header (Fixed)            │ Red/pink gradient, 60px
├─────────────────────────────┤
│                             │
│   Message Feed (Scroll)     │ Light gray bg, flex-grow
│   - White cards             │
│   - Avatars on left         │
│                             │
├─────────────────────────────┤
│   Input Area (Fixed)        │ White bg, auto height
└─────────────────────────────┘
```

### Container Widths
- Messages: Full width with px-4 padding
- Cards: Full width within container, no max-width restriction
- Responsive: Maintains same structure on all screen sizes

---

## Color System

### Primary Palette
- **Header Gradient**: Red (#E53E3E) to Pink (#ED64A6)
- **Accent Purple**: #9333EA (for buttons, active states)
- **Background Gray**: #F7FAFC (for main background)
- **Card White**: #FFFFFF
- **Text Primary**: #1A202C
- **Text Secondary**: #718096
- **Border**: #E2E8F0

### Usage Guidelines
- Header: Red-to-pink gradient background, white text
- Messages: White cards with subtle shadow
- Avatars: Purple gradient circles
- Send button: Purple gradient background
- Status indicators: Green for "active"

---

## Typography System

### Font Families
- Primary: Inter or system-ui font stack via Google Fonts CDN
- Code blocks: 'JetBrains Mono' or 'Fira Code'

### Text Hierarchy
**Header Title**: text-base, font-semibold, white
**Header Subtitle**: text-xs, white with opacity-80
**Messages**: text-sm, leading-relaxed, text-gray-900
**Timestamps**: text-xs, text-gray-500
**Input Placeholder**: text-sm, text-gray-400
**Button Labels**: text-sm, font-medium

---

## Component Library

### 1. Header Component

**Structure**:
- Fixed position at top, full-width
- Red/pink gradient background
- Left side: Circular logo/icon
- Center: "Hi Chroney" title with "AI Assistant Active" subtitle
- Right side: Action icons (expand, close, etc.)
- Height: 60px
- Padding: px-4, py-3
- White text throughout

**Elements**:
- Logo: Small circular icon on left
- Title: "Hi Chroney" - text-base, font-semibold
- Subtitle: "AI Assistant Active" - text-xs, opacity-80
- Icons: Right-aligned utility icons

### 2. Message Components

**Message Card Structure** (Both AI and User):
- White background card with rounded corners (rounded-lg)
- Subtle shadow (shadow-sm)
- Padding: p-4
- Margin bottom: mb-4
- Full width within container

**Layout**:
- Avatar: 32px circle on left with 12px margin-right
- Content: Flex-grow column
- Timestamp: Below message, text-xs, text-gray-500

**AI Message**:
- Avatar: Purple gradient circle with Sparkles icon
- Content: Regular text, supports markdown
- Timestamp: "12:04 AM" format

**User Message**:
- Avatar: Purple gradient circle with user icon
- Content: Regular text
- Timestamp: Same as AI messages
- Same card style as AI messages (white card)

### 3. Input Area Component

**Container Structure**:
- Fixed at bottom, full-width
- White background
- Border-top: subtle gray border
- Padding: px-4, py-4

**Input Field**:
- Rounded container: rounded-3xl
- Border: 1px gray border
- Padding: px-4, py-3
- Background: white
- Placeholder: "Ask Hi Chroney anything... (e.g., 'Generate timetable', 'Check attendance')"
- Min-height: 44px

**Send Button**:
- Positioned on right side of input
- Purple gradient background
- Circular or rounded square
- Icon: Send/arrow icon in white
- Size: w-10, h-10
- Enabled when input has text

**Action Icons**:
- Left of send button
- Small icon buttons (attach, voice, etc.)
- Gray color, simple styling

### 4. Message Accessories

**Code Blocks**:
- Dark background container
- Rounded corners: rounded-lg
- Padding: p-4
- Syntax highlighting with github-dark theme
- Copy button in top-right
- Language label

**Timestamps**:
- Below each message
- Format: "12:04 AM"
- text-xs, text-gray-500
- Left-aligned

**Regenerate Button** (for AI messages):
- Small text button
- Appears below last AI message
- Icon + "Regenerate" text
- Subtle hover state

### 5. Empty State

**When No Messages**:
- Centered in message area
- Large icon (ChatBubble, Sparkles, etc.)
- Heading: "How can I help you today?"
- Suggestion text below
- Clean, minimal design

---

## Interaction Patterns

### Scrolling Behavior
- Auto-scroll to bottom on new messages
- Smooth scroll animation
- Message feed: overflow-y-auto with light gray background

### Loading States
- Typing indicator for AI responses
- Streaming text appears progressively
- Loading spinner minimal and subtle

### Hover States
- Message cards: Slight shadow increase on hover
- Buttons: Opacity or brightness change
- Send button: Slight scale or glow effect

### Responsive Behavior
**Desktop & Mobile**:
- Same card-based design
- Messages stack vertically
- Input remains fixed at bottom
- Header remains fixed at top

---

## Accessibility

- ARIA labels on all icon buttons
- Focus visible on interactive elements
- Keyboard navigation support
- High contrast text ratios
- Screen reader support for new messages

---

## Icon Usage

**Icon Library**: Lucide React

**Required Icons**:
- Sparkles (AI avatar)
- User (user avatar)
- Send (PaperAirplane for send button)
- RefreshCw (regenerate)
- Copy (DocumentDuplicate for code blocks)
- Plus (new chat)
- Trash (delete conversation)

All icons: Standard sizes with consistent styling

---

## Animation Guidelines

**Minimal Animations**:
- Typing indicator: gentle pulse
- Message entrance: simple fade-in
- Button hover: subtle transform
- Scroll: smooth behavior
- NO elaborate transitions

**Performance**: GPU-accelerated animations only (transform, opacity)

---

## Key Design Features

1. **Card-Based Messages**: Both user and AI messages use same white card design
2. **Consistent Avatars**: All messages show avatars on left side
3. **Warm Color Palette**: Red/pink header, purple accents
4. **Clean Hierarchy**: White cards on light gray background
5. **Friendly Branding**: "Hi Chroney" with active status
6. **Simple Input**: Clean text input with purple gradient send button
7. **Subtle Shadows**: Cards use shadow-sm for depth without distraction

This design creates an approachable, friendly chat interface that's clear and easy to use.
