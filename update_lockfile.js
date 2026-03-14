import fs from 'fs';

const replacements = [
  { old: '@mariozechner/pi-tui', new: '@apholdings/jensen-tui' },
  { old: '@mariozechner/pi-ai', new: '@apholdings/jensen-ai' },
  { old: '@mariozechner/pi-agent-core', new: '@apholdings/jensen-agent-core' },
  { old: '@mariozechner/pi-mom', new: '@apholdings/jensen-mom' },
  { old: '@mariozechner/pi', new: '@apholdings/jensen-pods' },
  { old: '@mariozechner/pi-web-ui', new: '@apholdings/jensen-web-ui' },
];

let content = fs.readFileSync('package-lock.json', 'utf8');
replacements.forEach(r => {
    const escapedOld = r.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedOld, 'g');
    content = content.replace(regex, r.new);
});

fs.writeFileSync('package-lock.json', content, 'utf8');
console.log('Updated package-lock.json');
