import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// icon.svg is the editable source; the DEV variant shares its artwork.
// Regeneration requires macOS iconutil and Playwright Chromium.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'apps/desktop/build');
if (process.platform !== 'darwin') throw new Error('Regenerate ICNS on macOS');
const temporary = await mkdtemp(path.join(tmpdir(), 'verd-icons-'));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  const source = await readFile(path.join(output, 'icon.svg'), 'utf8');
  // Use vector lettering so exports do not depend on locally installed fonts.
  const development = source.replace(
    '</svg>',
    `<rect x="614" y="778" width="364" height="174" rx="44" fill="#FAAD14" stroke="#fffef5" stroke-width="12"/>
  <g fill="none" stroke="#243438" stroke-width="18" stroke-linejoin="round" stroke-linecap="square">
    <path d="M670 824v80h20q32 0 32-40t-32-40z"/>
    <path d="M802 824h-44v80h44m-44-40h36"/>
    <path d="M836 824l28 80 28-80"/>
  </g>
</svg>`,
  );
  await writeFile(path.join(output, 'icon-dev.svg'), development);
  for (const [name, svg] of [
    ['icon', source],
    ['icon-dev', development],
  ]) {
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
    );
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      omitBackground: true,
    });
    const iconset = path.join(temporary, `${name}.iconset`);
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        execFileSync(
          'sips',
          [
            '-z',
            String(size * scale),
            String(size * scale),
            path.join(output, `${name}.png`),
            '--out',
            path.join(
              iconset,
              `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`,
            ),
          ],
          { stdio: 'pipe' },
        );
      }
    }
    execFileSync('iconutil', [
      '-c',
      'icns',
      iconset,
      '-o',
      path.join(output, `${name}.icns`),
    ]);
    const sizes = [16, 32, 48, 64, 128, 256];
    const images = [];
    for (const size of sizes) {
      const file = path.join(temporary, `${size}.png`);
      execFileSync(
        'sips',
        [
          '-z',
          String(size),
          String(size),
          path.join(output, `${name}.png`),
          '--out',
          file,
        ],
        { stdio: 'pipe' },
      );
      images.push(await readFile(file));
    }
    const header = Buffer.alloc(6 + images.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach((image, index) => {
      const cursor = 6 + index * 16;
      header[cursor] = sizes[index] % 256;
      header[cursor + 1] = sizes[index] % 256;
      header.writeUInt16LE(1, cursor + 4);
      header.writeUInt16LE(32, cursor + 6);
      header.writeUInt32LE(image.length, cursor + 8);
      header.writeUInt32LE(offset, cursor + 12);
      offset += image.length;
    });
    await writeFile(
      path.join(output, `${name}.ico`),
      Buffer.concat([header, ...images]),
    );
  }
  console.log('Generated desktop and DEV SVG, PNG, ICNS and ICO from icon.svg');
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
