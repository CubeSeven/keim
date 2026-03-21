# Keim Notes - Development & Quality Guidelines

To ensure the codebase remains clean, performant, and error-free after every new feature, strictly adhere to the following ground rules. These standards prevent technical debt, cascading render bugs, and TypeScript regressions.

## 1. Strict TypeScript Compliance
- **No `any` or `@ts-ignore`**: Avoid using `any`. Use `unknown` or specific types instead. 
- **Use `@ts-expect-error` properly**: If you must bypass the compiler, use `// @ts-expect-error - [Reason]` with a descriptive reason of at least 3 characters. Never use `// @ts-ignore`.
- **Typechecks are Mandatory**: Code is not complete until `npx tsc --noEmit` passes without errors. If you change core types (like SmartSchemas/NoteItems), verify the changes propagate safely.

## 2. React Hooks & Component Architecture
- **Never Declare Components Inside Render**: Defining a component (e.g., `const FeatureCard = ...`) inside another component causes it to forcibly remount on every render cycle, destroying local state and tanking performance. Extract it out or memoize it.
- **Rules of Hooks**: Hooks cannot be called conditionally. Ensure early returns occur *after* all hooks (`useState`, `useEffect`, `useMemo`, `useCallback`) are executed.
- **Avoid `setState` in Effects**: Do not call `setState()` synchronously inside `useEffect()` to initialize data if it can be avoided, as it leads to cascading re-renders. Always prefer event handlers or data-fetching libraries. If unavoidable, use `// eslint-disable-next-line react-hooks/exhaustive-deps` or proper lint overrides explicitly justifying the decision.

## 3. Mandatory Linting & Testing Pipeline
- Always run the validation pipeline before concluding a feature task:
  ```bash
  npm run lint && npm run test:run && npx tsc --noEmit
  ```
- **Lint Warnings are Errors**: Treat warnings (like `react-hooks/exhaustive-deps`) as errors. If an incompatible library triggers a warning (e.g., TanStack Table functions), selectively disable that exact line using `// eslint-disable-next-line <rule>` only if technically justified.
- **Unit Tests**: Existing tests must pass (`npm run test:run`). For complex logic like the Sync engine or Encryption features, write or update the relevant Vitest test cases in `src/lib/__tests__/`.

## 4. Production-Ready Polish
- **Debug Logs**: Do not leave raw `console.log()` statements floating around. Gate them behind a `DEBUG` check:
  ```typescript
  const DEBUG = import.meta.env.DEV;
  if (DEBUG) console.log('Useful state info:', data);
  ```
- **Consistent Variable usage**: Use `const` over `let` whenever possible.
- **Handle Edge Cases Gracefully**: Check for `null`/`undefined` objects explicitly. Use optional chaining (`?.`) safely without leaving hanging unused expressions.

## 5. Styling & Visual Design
- **Monochrome & Glassmorphism Aesthetic**: All new components must adhere strictly to the project's established visual identity.
- **Colors**: Rely purely on the established grayscale token variables (`dark-bg`, `light-bg`, `dark-ui`, `light-ui`). Avoid introducing new saturated colors unless required for semantic alerts (e.g., destructive actions). Use opacity modifiers (like `bg-black/5 dark:bg-white/10`) for depth, layering, and separation.
- **Glassmorphism**: Build overlays and distinct sections using translucent backgrounds (e.g., `backdrop-blur-md`, `bg-white/40 dark:bg-dark-ui/40`) combined with extremely soft borders (e.g., `border-black/5 dark:border-white/5`).
- **Smooth Micro-interactions**: Apply intentional animations and transitions for hover states, scale changes, and reveals (utilizing Framer Motion or Tailwind classes like `transition-all duration-300`). 
- **Tailwind Consistency**: Do not implement ad-hoc CSS properties or random hex codes. Check existing high-quality components (e.g., `Dashboard`, `WelcomeScreen`) to reuse existing class combinations and ensure the application feels perfectly cohesive.
