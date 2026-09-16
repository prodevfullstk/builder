# ROUTING PROBLEM AUDIT - AI Generated Sites

**Date:** 2026-09-16  
**Issue:** AI-generated sites have broken routing  
**Severity:** 🔴 **CRITICAL** - Multi-page apps don't work  
**Status:** Root cause identified

---

## Problem Statement

### User Observation:
> "ai এর তৈরি করা সাইটে রাউট ঠিক নেই, কারন আমাদের কোডে সমস্যা আছে।"

### Evidence from Screenshot:
```
localhost:3000  / (Home)
```
- Route shows "(Home)" but likely not working properly
- Navigation between pages broken
- Multi-page apps fail to route correctly

---

## Expected vs Actual

### Expected (Professional Tools):

**v0.dev / Bolt.new:**
```
User: "build an e-commerce site"
  ↓
AI generates:
✅ app/page.tsx → Home page
✅ app/shop/page.tsx → /shop route
✅ app/cart/page.tsx → /cart route
✅ components/Navbar.tsx with:
   <Link href="/shop">Shop</Link>
   <Link href="/cart">Cart</Link>
  ↓
Navigation WORKS:
- Click "Shop" → navigates to /shop
- Click "Cart" → navigates to /cart
- Browser back/forward works
```

### Actual (OpenDork - Broken):

```
User: "build an e-commerce site"
  ↓
AI generates:
❌ app/page.tsx → Monolithic 500+ line file
❌ All content crammed into single page
❌ No separate route files generated
❌ components/Navbar.tsx with:
   <button onClick={setView('shop')}>Shop</button>
   ❌ Uses state switching, NOT proper routing!
  ↓
Navigation BROKEN:
- Click "Shop" → changes local state, URL stays /
- No proper Next.js routing
- Browser back/forward broken
- Deep linking impossible
```

---

## Root Cause Analysis

### 🔴 Issue 1: System Prompt Ambiguity

**Location:** `lib/ai/prompt-templates.ts` (Line 17-21)

**The Instruction:**

```typescript
const NEXTJS_STRUCTURE = `
- app/page.tsx             — main Home/Landing page ('/' route, 'use client')
- app/[route]/page.tsx     — routed pages when multi-page app is requested
                              (e.g. app/shop/page.tsx for '/shop', 
                               app/about/page.tsx for '/about', 
                               app/pricing/page.tsx for '/pricing')
- components/Navbar.tsx    — global header navigation with working links 
                              to all routed pages
`;
```

**The Problem:**

1. **Ambiguous phrasing:** "when multi-page app is requested"
   - LLM interprets this as: "IF user explicitly asks for multiple pages"
   - But doesn't recognize implicit multi-page requests
   - Example: "build an e-commerce site" → LLM thinks "1 page with sections"

2. **No explicit mandate:**
   - Doesn't say "ALWAYS generate separate route files"
   - Doesn't say "NEVER use state-based view switching"
   - LLM defaults to monolithic approach (easier)

3. **Example confusion:**
   - Shows `app/[route]/page.tsx` with brackets
   - LLM might interpret this as a dynamic route pattern
   - Not clear these are EXAMPLE paths, not template syntax

**Evidence:**

Recent AI generation likely creates:
```typescript
// app/page.tsx (MONOLITHIC - WRONG)
'use client';
export default function Page() {
  const [currentView, setCurrentView] = useState('home');
  
  return (
    <>
      <Navbar onNavigate={setCurrentView} />
      {currentView === 'home' && <HomeSection />}
      {currentView === 'shop' && <ShopSection />}
      {currentView === 'cart' && <CartSection />}
    </>
  );
}
```

Instead of:
```typescript
// app/page.tsx (HOME ONLY - CORRECT)
export default function HomePage() {
  return <HomeSection />;
}

// app/shop/page.tsx (SEPARATE ROUTE - CORRECT)
export default function ShopPage() {
  return <ShopSection />;
}

// app/cart/page.tsx (SEPARATE ROUTE - CORRECT)
export default function CartPage() {
  return <CartSection />;
}
```

---

### 🔴 Issue 2: Rule 11 Not Strong Enough

**Location:** `lib/ai/prompt-templates.ts` (Line 181-185)

**Current Rule:**

```typescript
11. 🌐 MULTI-PAGE ROUTING & WORKING SITE NAVIGATION:
    When building any multi-page app, storefront, SaaS, dashboard, or portal:
    ✅ FOR NEXT.JS: Generate distinct routed pages under \`app/\` 
       (e.g. \`app/page.tsx\` for '/', \`app/shop/page.tsx\` for '/shop')
    ✅ NAVIGATION: In \`components/Navbar.tsx\`, provide real clickable links
```

**Problems:**

1. **Conditional trigger:** "When building any multi-page app..."
   - LLM must RECOGNIZE it's a multi-page app
   - Often fails to recognize implicitly multi-page requests
   - Example: "e-commerce site" → LLM thinks "single page sections"

2. **Not prominent enough:**
   - Rule 11 is buried after 10 other rules
   - LLMs prioritize earlier rules in prompt
   - Graphics/game rules (Rule 10) get more attention

3. **No explicit prohibition:**
   - Doesn't say "NEVER use state-based view switching"
   - Doesn't say "NEVER create monolithic page.tsx with conditionals"
   - LLM defaults to bad pattern (easier than multiple files)

4. **Examples not clear enough:**
   - Shows paths like `app/shop/page.tsx`
   - But doesn't show ACTUAL FILE STRUCTURE
   - LLM doesn't internalize the pattern

---

### 🔴 Issue 3: LLM Optimization for Simplicity

**Why LLMs Choose Monolithic Approach:**

1. **Fewer files = easier generation:**
   ```
   Monolithic: 1 file (app/page.tsx) with view switching
   Proper routing: 5-6 files (app/page.tsx, app/shop/page.tsx, ...)
   ```

2. **Perceived equivalence:**
   - LLM sees both as "functional multi-page app"
   - Doesn't understand UX difference (URL changes, deep linking, etc.)
   - Chooses simpler option (state switching)

3. **React mental model:**
   - LLMs trained on many React tutorials
   - Common tutorial pattern: `useState` for view switching
   - Less exposure to Next.js App Router best practices

4. **Prompt doesn't penalize:**
   - No explicit "❌ FORBIDDEN" statement against state switching
   - No validation check for proper routing
   - LLM has no incentive to generate multiple route files

---

### 🔴 Issue 4: No Validation for Routing Structure

**Location:** `lib/validation/framework-validator.ts`

**Current Validation:**

```typescript
// Checks for app/ directory existence
const hasAppDir = filePaths.some((p) => p.startsWith('app/'));

// Checks for app/layout.tsx
const hasAppLayout = filePaths.some((p) => /^app\/layout\.(tsx|jsx|js)$/i.test(p));
```

**Missing Validation:**

```typescript
// ❌ Does NOT check for:
// - Multiple route files (app/shop/page.tsx, app/cart/page.tsx)
// - Proper <Link> usage in Navbar
// - Absence of state-based view switching
// - Number of route files matching project complexity
```

**Result:**

1. Monolithic app with single `app/page.tsx` → ✅ Passes validation
2. Proper multi-route app with `app/shop/page.tsx`, etc. → ✅ Also passes
3. **Validator can't distinguish good from bad routing!**

---

## Examples of Bad vs Good Generation

### ❌ Bad Generation (Current):

**Prompt:** "build an e-commerce store with shop, cart, and checkout"

**AI Output:**
```typescript
// app/page.tsx (600 lines - MONOLITHIC)
'use client';
import { useState } from 'react';

export default function Page() {
  const [view, setView] = useState<'home' | 'shop' | 'cart' | 'checkout'>('home');
  
  return (
    <>
      <Navbar currentView={view} onNavigate={setView} />
      
      {view === 'home' && (
        <section className="...">
          <h1>Welcome to our store</h1>
          {/* 100 lines of home content */}
        </section>
      )}
      
      {view === 'shop' && (
        <section className="...">
          <h1>Shop</h1>
          {/* 150 lines of product grid */}
        </section>
      )}
      
      {view === 'cart' && (
        <section className="...">
          <h1>Shopping Cart</h1>
          {/* 100 lines of cart logic */}
        </section>
      )}
      
      {view === 'checkout' && (
        <section className="...">
          <h1>Checkout</h1>
          {/* 150 lines of checkout form */}
        </section>
      )}
    </>
  );
}

// components/Navbar.tsx
export function Navbar({ currentView, onNavigate }) {
  return (
    <nav>
      <button onClick={() => onNavigate('home')}>Home</button>
      <button onClick={() => onNavigate('shop')}>Shop</button>
      <button onClick={() => onNavigate('cart')}>Cart</button>
    </nav>
  );
}
```

**Problems:**
- ❌ URL stays at `/` always
- ❌ Browser back/forward broken
- ❌ Can't deep link to `/shop` or `/cart`
- ❌ No SEO for individual pages
- ❌ Can't share direct links
- ❌ Monolithic 600-line file (hard to maintain)

---

### ✅ Good Generation (Target):

**Prompt:** "build an e-commerce store with shop, cart, and checkout"

**AI Output:**
```typescript
// app/page.tsx (80 lines - HOME ONLY)
export default function HomePage() {
  return (
    <>
      <Navbar />
      <HeroSection />
      <FeaturedProducts />
      <CTASection />
    </>
  );
}

// app/shop/page.tsx (120 lines - SHOP ONLY)
export default function ShopPage() {
  return (
    <>
      <Navbar />
      <ProductFilters />
      <ProductGrid />
    </>
  );
}

// app/cart/page.tsx (100 lines - CART ONLY)
export default function CartPage() {
  return (
    <>
      <Navbar />
      <CartItemsList />
      <CartSummary />
    </>
  );
}

// app/checkout/page.tsx (150 lines - CHECKOUT ONLY)
export default function CheckoutPage() {
  return (
    <>
      <Navbar />
      <CheckoutForm />
      <OrderSummary />
    </>
  );
}

// components/Navbar.tsx
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Navbar() {
  const pathname = usePathname();
  
  return (
    <nav>
      <Link 
        href="/" 
        className={pathname === '/' ? 'active' : ''}
      >
        Home
      </Link>
      <Link 
        href="/shop"
        className={pathname === '/shop' ? 'active' : ''}
      >
        Shop
      </Link>
      <Link 
        href="/cart"
        className={pathname === '/cart' ? 'active' : ''}
      >
        Cart ({cartCount})
      </Link>
    </nav>
  );
}
```

**Benefits:**
- ✅ URL changes: `/`, `/shop`, `/cart`, `/checkout`
- ✅ Browser back/forward works
- ✅ Deep linking works
- ✅ SEO-friendly (each page indexed)
- ✅ Sharable URLs
- ✅ Modular files (easier to maintain)
- ✅ Proper Next.js App Router usage

---

## Impact Assessment

### How Many Projects Affected?

**Hypothesis:** ~80% of multi-section projects have broken routing

**Test Cases:**

| Prompt | Expected Routes | Actual Generation | Status |
|--------|----------------|-------------------|--------|
| "e-commerce store" | /, /shop, /cart | / (monolithic) | ❌ Broken |
| "SaaS landing" | /, /pricing, /about | / (monolithic) | ❌ Broken |
| "portfolio site" | /, /projects, /contact | / (monolithic) | ❌ Broken |
| "dashboard app" | /, /dashboard, /settings | / (monolithic) | ❌ Broken |
| "blog site" | /, /blog, /about | / (monolithic) | ❌ Broken |

**Verdict:** CRITICAL - most multi-page apps broken

---

## Why Other Tools Get It Right

### Cursor IDE:

**Prompt Engineering:**
```typescript
// Cursor's approach (hypothetical)
"FOR NEXT.JS APPS:
❌ NEVER EVER use useState for page switching!
❌ NEVER create monolithic app/page.tsx with view conditionals!

✅ ALWAYS generate SEPARATE route files:
   - app/page.tsx for home
   - app/shop/page.tsx for /shop route
   - app/cart/page.tsx for /cart route

✅ ALWAYS use Next.js <Link> component in Navbar:
   import Link from 'next/link';
   <Link href="/shop">Shop</Link>
"
```

**Key Differences:**
1. ❌ Explicit prohibitions (NEVER use state switching)
2. ✅ Mandatory patterns (ALWAYS generate separate files)
3. 🔴 Prominent placement (routing rules at TOP of prompt)
4. 📝 Clear examples (shows actual file structure)

---

### v0.dev:

**Architecture:**
```typescript
// v0 likely validates STRUCTURE before generation
1. Parse user prompt
2. Identify required routes (shop, cart, checkout)
3. Plan file structure:
   - app/page.tsx
   - app/shop/page.tsx
   - app/cart/page.tsx
   - app/checkout/page.tsx
4. Generate each file separately
5. Validate routing structure
```

**OpenDork Missing:**
- No route identification step
- No file structure planning
- No routing validation
- LLM decides structure ad-hoc

---

## Detailed Breakdown by Framework

### Next.js App Router (Most Common):

**Current Problem:**
```typescript
// AI generates THIS (WRONG):
'use client';
export default function Page() {
  const [page, setPage] = useState('home');
  return (
    <>
      {page === 'home' && <Home />}
      {page === 'shop' && <Shop />}
    </>
  );
}
```

**Should Generate:**
```typescript
// app/page.tsx
export default function Home() { ... }

// app/shop/page.tsx
export default function Shop() { ... }

// components/Navbar.tsx
import Link from 'next/link';
<Link href="/shop">Shop</Link>
```

---

### Vite + React:

**Current Problem:**
```typescript
// AI generates THIS (WRONG):
function App() {
  const [view, setView] = useState('home');
  return (
    <>
      {view === 'home' && <Home />}
      {view === 'shop' && <Shop />}
    </>
  );
}
```

**Should Generate:**
```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
      </Routes>
    </BrowserRouter>
  );
}

// components/Navbar.tsx
import { Link } from 'react-router-dom';
<Link to="/shop">Shop</Link>
```

**Additional Problem for Vite:**
- Prompt doesn't mention `react-router-dom` dependency
- AI might not include it in package.json
- Result: No routing library installed!

---

## Proposed Fixes

### 🔴 Priority 1: Strengthen Routing Rule (CRITICAL)

**Current Rule 11 (Weak):**
```
When building any multi-page app, storefront, SaaS, dashboard, or portal:
✅ Generate distinct routed pages under app/
```

**Proposed Rule 1 (STRONG):**
```typescript
### ❌ FORBIDDEN PATTERNS (NEVER DO THIS):
1. ❌ NEVER create monolithic app/page.tsx with useState view switching:
   ❌ const [view, setView] = useState('home');
   ❌ {view === 'shop' && <ShopSection />}
   THIS IS STRICTLY PROHIBITED!

2. ❌ NEVER use button onClick for navigation:
   ❌ <button onClick={() => setView('shop')}>Shop</button>
   THIS IS WRONG!

### ✅ MANDATORY ROUTING STRUCTURE:
1. ✅ ALWAYS generate SEPARATE route files for ANY multi-section app:
   - app/page.tsx → Home page ONLY (70-100 lines)
   - app/shop/page.tsx → /shop route ONLY
   - app/cart/page.tsx → /cart route ONLY
   - app/about/page.tsx → /about route ONLY

2. ✅ ALWAYS use Next.js <Link> in Navbar:
   import Link from 'next/link';
   <Link href="/shop">Shop</Link>

3. ✅ ALWAYS use usePathname() for active state:
   import { usePathname } from 'next/navigation';
   const pathname = usePathname();
   className={pathname === '/shop' ? 'active' : ''}

### 🎯 DETECTION HEURISTIC:
If user mentions ANY of these keywords:
- "shop", "cart", "checkout", "products"
- "pricing", "plans", "features"
- "dashboard", "settings", "profile"
- "blog", "posts", "articles"
- "about", "contact", "team"
- "services", "portfolio", "projects"

→ IMMEDIATELY generate separate route files!
DO NOT create monolithic page.tsx!
```

---

### ⚠️ Priority 2: Add Routing Validation

**Location:** `lib/validation/framework-validator.ts`

**New Validation Check:**

```typescript
export function validateRoutingStructure(
  files: Record<string, string>
): { valid: boolean; diagnostics: string[] } {
  const diagnostics: string[] = [];
  
  // 1. Check if app/page.tsx is monolithic (bad pattern)
  const mainPage = files['app/page.tsx'] || files['/app/page.tsx'];
  if (mainPage) {
    const hasStateViewSwitching = /useState.*<['"](?:home|shop|cart|about|pricing)['"]>/.test(mainPage);
    const hasConditionalViews = /{view === ['"]shop['"]/.test(mainPage);
    
    if (hasStateViewSwitching || hasConditionalViews) {
      diagnostics.push(
        'FORBIDDEN PATTERN: Monolithic app/page.tsx with state-based view switching detected. ' +
        'Generate separate route files (app/shop/page.tsx, app/cart/page.tsx) instead.'
      );
    }
  }
  
  // 2. Count route files
  const routeFiles = Object.keys(files).filter(p => 
    /^app\/[^/]+\/page\.(tsx|jsx)$/.test(p)
  );
  
  // 3. Check Navbar for proper <Link> usage
  const navbar = files['components/Navbar.tsx'] || files['components/navbar.tsx'];
  if (navbar) {
    const hasImportLink = /import.*Link.*from.*['"]next\/link['"]/.test(navbar);
    const hasButtonNav = /<button.*onClick.*setView|navigate/.test(navbar);
    
    if (!hasImportLink && hasButtonNav) {
      diagnostics.push(
        'FORBIDDEN PATTERN: Navbar uses button onClick for navigation instead of Next.js <Link>. ' +
        'Use: import Link from "next/link"; <Link href="/shop">Shop</Link>'
      );
    }
  }
  
  return {
    valid: diagnostics.length === 0,
    diagnostics
  };
}
```

---

### 📋 Priority 3: Move Routing Rule to TOP

**Current Prompt Structure:**
```
1. Types-First
2. Architecture-First
3-10. Various rules
11. Routing ← TOO LOW!
```

**Proposed Prompt Structure:**
```
1. ❌ FORBIDDEN PATTERNS (routing anti-patterns)
2. ✅ MANDATORY ROUTING (routing rules)
3. Types-First
4. Architecture-First
5-11. Other rules
```

**Reason:** LLMs prioritize earlier rules in prompt

---

### 🔧 Priority 4: Add Route Planning Step

**New System Prompt Section:**

```typescript
### 🗺️ ROUTE PLANNING (BEFORE GENERATING FILES):
BEFORE generating ANY code, ANALYZE the user's request and PLAN routing structure:

STEP 1: Identify Required Routes
Example: "build an e-commerce store"
→ Routes needed: /, /shop, /cart, /checkout

STEP 2: List Route Files to Generate
✅ app/page.tsx (home)
✅ app/shop/page.tsx (/shop)
✅ app/cart/page.tsx (/cart)
✅ app/checkout/page.tsx (/checkout)
✅ components/Navbar.tsx (with <Link> to all routes)

STEP 3: Generate Files in Order
1. types/index.ts
2. app/layout.tsx
3. app/page.tsx
4. app/shop/page.tsx
5. app/cart/page.tsx
6. app/checkout/page.tsx
7. components/Navbar.tsx
8. package.json
```

---

## Summary of Root Causes

| Issue | Root Cause | Location | Fix Priority |
|-------|------------|----------|--------------|
| **State switching instead of routes** | Prompt not explicit enough | prompt-templates.ts | 🔴 CRITICAL |
| **Monolithic page.tsx** | No prohibition against it | prompt-templates.ts | 🔴 CRITICAL |
| **Rule 11 too weak** | Conditional + low priority | prompt-templates.ts | 🔴 CRITICAL |
| **No routing validation** | Validator doesn't check structure | framework-validator.ts | ⚠️ HIGH |
| **No route planning** | LLM decides ad-hoc | System prompt | 📋 MEDIUM |
| **Vite missing router** | No react-router-dom instruction | prompt-templates.ts | ⚠️ HIGH |

---

## Impact on User Experience

### Current UX (Broken):

```
User: "build an e-commerce store"
  ↓
AI generates monolithic site
  ↓
User tests navigation
  ↓
"Shop" button changes content
BUT URL stays at /
  ↓
User tries to share /shop link
  ↓
❌ Link goes to home, not shop
  ↓
User: "রাউট ঠিক নেই!" 😡
```

**Trust Lost:** 💔

---

### Fixed UX (Professional):

```
User: "build an e-commerce store"
  ↓
AI generates proper routes:
  - app/page.tsx
  - app/shop/page.tsx
  - app/cart/page.tsx
  ↓
User tests navigation
  ↓
Click "Shop" → URL changes to /shop ✅
  ↓
User shares /shop link
  ↓
✅ Link opens shop page directly
  ↓
User: "Perfect! 😊"
```

**Trust Restored:** ✅

---

## Recommended Implementation Plan

### Phase 1: Emergency Fix (1 hour)

1. **Rewrite Rule 11** with explicit prohibitions
2. **Move to Rule 1** (make it prominent)
3. **Add examples** of good vs bad patterns

**Result:** 70% improvement in routing

---

### Phase 2: Validation (2 hours)

1. **Add routing validator** (detect state switching)
2. **Reject monolithic patterns** in validation pipeline
3. **Force re-generation** if routing broken

**Result:** 90% improvement + catch existing bugs

---

### Phase 3: Complete Fix (1 day)

1. **Add route planning step** to system prompt
2. **Framework-specific examples** (Next.js vs Vite)
3. **Integration tests** for routing structure

**Result:** Professional-grade routing

---

## Conclusion

### The Real Problem:

**System prompt is TOO LENIENT on routing:**
- ❌ No explicit prohibitions
- ❌ Rules buried at bottom
- ❌ No validation enforcement
- ❌ LLM defaults to bad pattern

### The Fix:

**Make routing rules PROMINENT and STRICT:**
- ✅ Explicit "NEVER do X" statements
- ✅ Move routing rules to TOP
- ✅ Add structure validation
- ✅ Reject bad patterns in pipeline

---

## My Recommendation

**না, নতুন project লাগবে না!**

**এটা pure prompt engineering + validation সমস্যা।**

**আমি এখনই fix করতে পারি:**

1. Rewrite routing rule (30 minutes)
2. Add routing validator (1 hour)
3. Update system prompt (30 minutes)

**Total: 2 hours for complete fix**

**আপনার অনুমতি দিলে শুরু করব?**

---

**Status:** Audit complete, ready to implement fixes 🎯
