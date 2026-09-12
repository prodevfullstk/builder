# Domain Modeling: Data & Type Discipline

Actively model the domain entities, types, and relationships before writing UI or state logic.

## 1. Canonical Type Definitions
- Create dedicated type definitions in types/ (e.g. types/crypto.ts, types/ecommerce.ts).
- Define exact interfaces for every core entity:
  - User / Account
  - Core Business Entities (e.g. Position, Order, Product, Transaction)
  - Enums for statuses (e.g. status: 'open' | 'closed' | 'pending')

## 2. Naming Consistency
- Avoid fuzzy or overloaded terms.
- Use consistent property naming across API routes, database schemas, mock data, and UI components (e.g. choose createdAt or created_at consistently, never mix both for the same entity).

## 3. Database Schema Alignment
- When generating Supabase or SQL schemas, table columns, constraints, foreign keys, and RLS policies must strictly match the TypeScript interfaces.
- Always generate companion supabase/schema.sql and supabase/seed.sql with realistic sample records.
