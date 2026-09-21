import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export type MenuLang = 'ar' | 'en';

/** Labels for the custom (non-role) menu items. Electron localizes `role:` items to the OS
 *  language on its own, so only these top-level and custom entries need translating here. */
const STRINGS: Record<MenuLang, { file: string; edit: string; view: string; window: string; githubProject: string }> = {
  en: { file: 'File', edit: 'Edit', view: 'View', window: 'Window', githubProject: 'Project on GitHub' },
  ar: { file: 'ملف', edit: 'تحرير', view: 'عرض', window: 'نافذة', githubProject: 'المشروع على GitHub' },
};

export function buildMenu(opts: { isDev: boolean; lang: MenuLang; openExternal: (url: string) => void }): Menu {
  const isMac = process.platform === 'darwin';
  const s = STRINGS[opts.lang] ?? STRINGS.en;
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'quit' as const }] }] : []),
    {
      label: s.file,
      submenu: [{ role: 'close' }, ...(isMac ? [] : [{ role: 'quit' as const }])],
    },
    { label: s.edit, submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: s.view,
      submenu: [
        ...(opts.isDev ? [{ role: 'reload' as const }, { role: 'forceReload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: s.window, submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])] },
    { role: 'help', submenu: [{ label: s.githubProject, click: () => opts.openExternal('https://github.com/moathkleap/7vid') }] },
  ];
  return Menu.buildFromTemplate(template);
}
