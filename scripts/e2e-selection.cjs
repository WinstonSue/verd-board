const { readFileSync } = require('node:fs');
const path = require('node:path');

function runtimeTests(
  host,
  runtime,
  catalog = JSON.parse(
    readFileSync(path.join(__dirname, '../tests/catalog.json'), 'utf8'),
  ),
) {
  const files = catalog.units
    .filter((unit) => unit.host === host && unit.runtime === runtime)
    .flatMap((unit) => unit.tests);
  if (!files.length) throw new Error(`No classified ${host} ${runtime} tests`);
  return files.map(
    (file) => '**/' + path.posix.relative(`tests/${host}-e2e`, file),
  );
}

module.exports = { runtimeTests };
