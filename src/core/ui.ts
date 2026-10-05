import { esc } from "./chart.ts";

/** Checkbox list; at least one item stays selected, since an empty list would silently fall back to the defaults. */
export function checkboxes(host: HTMLElement, names: string[], checked: string[], onChange: (next: string[]) => void): void {
  host.innerHTML = "";
  for (const name of names) {
    const label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = `<input type="checkbox" ${checked.includes(name) ? "checked" : ""}>${esc(name)}`;
    const box = label.querySelector("input")!;
    box.addEventListener("change", () => {
      const next = box.checked ? [...checked, name] : checked.filter((n) => n !== name);
      if (!next.length) { box.checked = true; return; }
      onChange(names.filter((n) => next.includes(n)));
    });
    host.appendChild(label);
  }
}
