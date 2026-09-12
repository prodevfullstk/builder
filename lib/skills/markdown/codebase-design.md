# Codebase Design: Deep Modules & Clean Architecture

Design **deep modules**: a lot of behavior behind a small interface, placed at clean seams.
Use this discipline to avoid monolithic, hard-to-maintain files.

## 1. Deep vs Shallow Modules
- **Deep Module** (Preferred): A small, clean interface with rich internal implementation (e.g. a custom hook useTradingStore() or an encapsulated component OrderBook).
- **Shallow Module** (Avoid): A bloated interface that merely passes through props without hiding complexity, or a giant monolithic component where data fetching, state, calculations, and 20 nested sub-views live in one single 1000-line file.

## 2. Component & File Separation Rules
1. **Separate Business Logic from Presentation**:
   - Extract state machines, calculations, and data fetching into custom hooks (e.g., hooks/use-trade.ts, lib/store.ts).
   - Keep React components focused on layout, UI feedback, and user interaction.
2. **Atomic Component Decomposition**:
   - Break large pages into subcomponents under components/<feature>/ (e.g., Navbar.tsx, Sidebar.tsx, MetricCard.tsx).
   - Each component should receive only the props it actually needs.
3. **The Deletion Test**:
   - If deleting a module merely moves messy complexity into 10 caller components, the module was not properly designed. A good module cleanly encapsulates its domain.
4. **Locality & Seams**:
   - State and logic that change together should live together.
   - Avoid prop drilling through many levels; use lightweight React Context or custom hooks where appropriate.
