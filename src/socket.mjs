import fs from 'node:fs';
import net from 'node:net';
import {t} from './i18n.mjs';

export function request(file, message, maxBytes = 1024 * 1024) {
  const stat = fs.statSync(file);
  if (!stat.isSocket() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error(t('Socket de contrôle non privé.'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(file);
    let input = '', complete = false;
    const fail = () => {socket.destroy(); if (!complete) reject(new Error(t('Contrôleur inaccessible ou réponse non confirmée.')));};
    socket.setTimeout(5000, fail);
    socket.on('error', fail);
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', chunk => {
      input += chunk;
      if (Buffer.byteLength(input) > maxBytes) return fail();
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      try {
        const reply = JSON.parse(input.slice(0, newline));
        complete = true; socket.destroy(); resolve(reply);
      } catch {fail();}
    });
    socket.on('end', fail);
  });
}
