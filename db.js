const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'data.json');

function read() {
  if (!fs.existsSync(FILE)) {
    const initial = { users: [], classes: [], members: [], sessions: [], attendance: [] };
    fs.writeFileSync(FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function write(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = { read, write };
