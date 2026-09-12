# Code Review: Standards & Spec Audit

Audit code along two independent axes: **Standards** and **Spec Adherence**.

## 1. Standards Axis
Check code quality against modern fullstack best practices:
- **TypeScript**: No any types, properly typed props and return types.
- **Component Hygiene**: No monolithic 1000-line components, business logic extracted into hooks.
- **Tailwind & UI**: Consistent spacing, accessible contrast, mobile responsiveness.
- **Code Smells**: Identify duplicate code, mystery variable names, prop drilling, and dead code.

## 2. Spec Axis
Verify alignment with the user's prompt or requirements:
- Check if all requested pages, components, and interactive features are present.
- Identify any missing edge cases or incomplete implementations (e.g. missing modals, incomplete forms).
- Highlight any unintended scope creep or unnecessary dependencies.
