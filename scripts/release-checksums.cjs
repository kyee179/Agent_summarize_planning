const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release'));
const files = fs.readdirSync(directory).filter(file => /\.(?:exe|dmg|AppImage|zip|deb|rpm)$/i.test(file) && !file.includes('.__uninstaller.') && fs.statSync(path.join(directory, file)).isFile()).sort();
if (!files.length) throw new Error('Build an installer before generating checksums.');
const lines = files.map(file => crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex') + '  ' + file);
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Generated SHA256SUMS.txt for ${files.length} distributable(s).`);
