import fs from 'fs';
import path from 'path';

const replacements = [
  { old: '@mariozechner/pi-tui', new: '@apholdings/jensen-tui' },
  { old: '@mariozechner/pi-ai', new: '@apholdings/jensen-ai' },
  { old: '@mariozechner/pi-agent-core', new: '@apholdings/jensen-agent-core' },
  { old: '@mariozechner/pi-mom', new: '@apholdings/jensen-mom' },
  { old: '@mariozechner/pi', new: '@apholdings/jensen-pods' },
  { old: '@mariozechner/pi-web-ui', new: '@apholdings/jensen-web-ui' },
];

const versionUpdate = '^0.0.1';

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
      }
    } else {
      const ext = path.extname(file);
      const filename = path.basename(file);
      if (['.ts', '.tsx', '.json', '.md', '.sh'].includes(ext) || filename === 'tsconfig.base.json') {
          arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

const allFiles = getAllFiles('.');

allFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  replacements.forEach(r => {
    if (content.includes(r.old)) {
      // For package.json, we want to update the version too if it's in dependencies/devDependencies/peerDependencies
      if (path.basename(file) === 'package.json') {
        const json = JSON.parse(content);
        let pkgChanged = false;
        ['dependencies', 'devDependencies', 'peerDependencies'].forEach(depType => {
          if (json[depType] && json[depType][r.old]) {
            const version = json[depType][r.old];
            // If it's a "file:..." version, don't change it unless it's pointing to the wrong place
            // But usually for monorepo it's fine.
            // Let's check what it currently is in web-ui/package.json
            if (!version.startsWith('file:')) {
                json[depType][r.new] = versionUpdate;
                delete json[depType][r.old];
                pkgChanged = true;
            } else {
                json[depType][r.new] = version;
                delete json[depType][r.old];
                pkgChanged = true;
            }
          }
        });
        if (pkgChanged) {
          content = JSON.stringify(json, null, '\t') + '\n';
          changed = true;
        }
      }

      // Perform string replacement for everything else (including parts of package.json like scripts or description)
      // We use a regex to replace all occurrences
      const escapedOld = r.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedOld, 'g');
      if (content.match(regex)) {
          content = content.replace(regex, r.new);
          changed = true;
      }
    }
  });

  if (changed) {
    console.log(`Updated ${file}`);
    fs.writeFileSync(file, content, 'utf8');
  }
});
