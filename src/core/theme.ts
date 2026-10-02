/**
 * Azure DevOps applies its theme through CSS variables (SDK.init({ applyTheme: true })).
 * Our palette has light and dark variants, so pick one from the actual background luminance.
 */
export function syncTheme(): void {
  const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return;
  const [r, g, b] = m.map(Number);
  document.documentElement.dataset.theme = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
}

/** The SDK fires "themeApplied" on the initial handshake and whenever the user switches theme. */
export function watchTheme(onChange: () => void): void {
  syncTheme();
  window.addEventListener("themeApplied", () => { syncTheme(); onChange(); });
}
