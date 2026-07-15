// Expo normally supplies this via the gitignored, dev-server-generated
// expo-env.d.ts (which references expo/types). A clean checkout — e.g.
// CI running `tsc --noEmit` before any `expo start`/`expo export` has
// ever run — has neither, so the side-effect `@/global.css` import in
// constants/theme.ts has nowhere to resolve. Committing the one
// declaration we actually rely on keeps typecheck deterministic.
declare module '*.css';
