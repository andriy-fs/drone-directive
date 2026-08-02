/**
 * Whether to narrate dropped input on the console.
 *
 * A flag rather than `import.meta.env.DEV` on purpose: reading Vite's env here
 * would tie this package to one bundler, and the point of splitting it out was
 * that it depends on nothing but the protocol and the shared types. The host
 * application decides — `setNetDebug(import.meta.env.DEV)` in the client's case.
 */
let debug = false;

export function setNetDebug(enabled: boolean): void {
  debug = enabled;
}

export function isDebug(): boolean {
  return debug;
}
