const fs = require('fs');
const path = require('path');

// Define input and output file paths relative to the project root
const inputFile = path.join(process.cwd(), 'utils', 'default_proxies.txt');
const outputFile = path.join(process.cwd(), 'utils', 'proxies.txt');

fs.readFile(inputFile, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading default_proxies.txt:', err);
    return;
  }

  const lines = data.split(/\r?\n/).filter(line => line.trim() !== '');

  const convertedProxies = lines.map(line => {
    line = line.trim();
    if (!line.startsWith('socks5://')) {
      return `socks5://${line}`;
    }
    return line;
  });

  fs.writeFile(outputFile, convertedProxies.join('\n'), 'utf8', err => {
    if (err) {
      console.error('Error writing proxies.txt:', err);
    } else {
      console.log('Conversion completed! Proxies have been saved in proxies.txt');
    }
  });
});
