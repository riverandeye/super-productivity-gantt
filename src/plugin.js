// Gantt: host-side entry points. The chart itself lives in index.html.
// The app adds a side-menu entry for the iframe view on its own; this adds a
// header button and a keyboard shortcut (unbound until the user assigns keys).
PluginAPI.registerHeaderButton({
  label: PluginAPI.translate('HEADER_BTN'),
  icon: 'view_timeline',
  onClick: function () {
    PluginAPI.showIndexHtmlAsView();
  },
});

PluginAPI.registerShortcut({
  id: 'open_gantt',
  label: PluginAPI.translate('OPEN_GANTT'),
  onExec: function () {
    PluginAPI.showIndexHtmlAsView();
  },
});
