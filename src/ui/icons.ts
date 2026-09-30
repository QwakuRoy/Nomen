// Inline 16px icons. Stroke/fill use currentColor so they follow the Figma theme.

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icon = {
  settings: svg(
    '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
  ),
  back: svg('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
  target: svg('<circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"/>'),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  checkSmall: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`,
  alert: svg('<path d="M8 2 1.8 13h12.4L8 2Z"/><path d="M8 6.5v3"/><circle cx="8" cy="11.3" r=".4" fill="currentColor"/>'),
  info: svg('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8"/><circle cx="8" cy="5" r=".4" fill="currentColor"/>'),
  sparkle: svg('<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M4 12l1.8-1.8M10.2 5.8 12 4"/>'),
  layers: svg('<path d="M8 2 2 5l6 3 6-3-6-3Z"/><path d="m2 8 6 3 6-3"/><path d="m2 11 6 3 6-3"/>'),
};

/** Nomen mark: an N whose diagonal is the "rename" stroke. Same geometry as brand/nomen-icon.svg. */
export const logo = `<svg class="logo" viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#1E1B4B"/><rect x="34" y="32" width="16" height="64" rx="3" fill="#F5F5F7"/><rect x="78" y="32" width="16" height="64" rx="3" fill="#F5F5F7"/><polygon points="34,32 50,32 94,96 78,96" fill="#7C5CFF"/><circle cx="98" cy="30" r="7" fill="#3DDC97"/></svg>`;

const TYPE_ICONS: Record<string, string> = {
  FRAME: svg('<path d="M5 2v12M11 2v12M2 5h12M2 11h12"/>'),
  GROUP: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="2 1.6"/>'),
  SECTION: svg('<rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M2.5 6h5"/>'),
  TEXT: svg('<path d="M3.5 3.5h9M8 3.5v9"/>'),
  RECTANGLE: svg('<rect x="3" y="3" width="10" height="10" rx="0.5"/>'),
  ELLIPSE: svg('<circle cx="8" cy="8" r="5"/>'),
  LINE: svg('<path d="M3 13 13 3"/>'),
  VECTOR: svg('<path d="M3 13c1-5 5-9 10-10"/><circle cx="3" cy="13" r="1"/><circle cx="13" cy="3" r="1"/>'),
  BOOLEAN_OPERATION: svg('<rect x="2.5" y="2.5" width="7" height="7"/><rect x="6.5" y="6.5" width="7" height="7"/>'),
  POLYGON: svg('<path d="M8 2.5 13.5 13h-11L8 2.5Z"/>'),
  STAR: svg('<path d="m8 2.5 1.7 3.6 3.8.4-2.9 2.6.8 3.8L8 11l-3.4 1.9.8-3.8-2.9-2.6 3.8-.4L8 2.5Z"/>'),
  COMPONENT: svg('<path d="m8 1.8 2.2 2.2L8 6.2 5.8 4 8 1.8ZM12 5.8l2.2 2.2-2.2 2.2L9.8 8 12 5.8ZM4 5.8 6.2 8 4 10.2 1.8 8 4 5.8ZM8 9.8l2.2 2.2L8 14.2 5.8 12 8 9.8Z"/>'),
  COMPONENT_SET: svg('<path d="m8 1.8 2.2 2.2L8 6.2 5.8 4 8 1.8ZM12 5.8l2.2 2.2-2.2 2.2L9.8 8 12 5.8ZM4 5.8 6.2 8 4 10.2 1.8 8 4 5.8ZM8 9.8l2.2 2.2L8 14.2 5.8 12 8 9.8Z"/>'),
  INSTANCE: svg('<path d="M8 2 14 8l-6 6-6-6 6-6Z"/>'),
};

export function typeIcon(type: string): string {
  return TYPE_ICONS[type] ?? TYPE_ICONS.RECTANGLE;
}
