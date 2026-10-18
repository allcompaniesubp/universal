/// <reference types="vite/client" />

// Side-effect CSS imports are resolved by Vite at build time. This declaration
// exists so `tsc --noEmit` does not report a missing module for them.
declare module '*.css';
