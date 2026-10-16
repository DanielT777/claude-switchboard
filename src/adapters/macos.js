/* Executed by osascript (JXA), not Node. Arguments are data, never script text. */
function run(argv) {
  var host = argv[0], action = argv[1], target = argv[2], text = argv[3];
  var app = Application(host === 'Terminal' ? 'com.apple.Terminal' : 'com.googlecode.iterm2');
  if (!app.running()) return JSON.stringify([]);
  var rows = [], chosen;
  app.windows().forEach(function (window) {
    window.tabs().forEach(function (tab) {
      var sessions = host === 'Terminal' ? [tab] : tab.sessions();
      sessions.forEach(function (session) {
        var tty = session.tty();
        var id = host === 'Terminal' ? window.id() + ':' + tty : session.uniqueID();
        rows.push({id: String(id), tty: tty});
        if (String(id) === target) chosen = {window: window, tab: tab, session: session};
      });
    });
  });
  if (action === 'list') return JSON.stringify(rows);
  if (!chosen) throw new Error('Terminal remplacé ou fermé.');
  if (action === 'read') return JSON.stringify({text: host === 'Terminal' ? chosen.session.contents() : chosen.session.text()});
  if (action === 'send') {
    if (host === 'Terminal') app.doScript(text, {in: chosen.session});
    else chosen.session.write({text: text});
  } else if (action === 'focus') {
    if (host === 'Terminal') {chosen.window.index = 1; chosen.tab.selected = true;}
    else chosen.session.select();
    app.activate();
  } else throw new Error('Commande inconnue.');
  return JSON.stringify({accepted: true});
}
