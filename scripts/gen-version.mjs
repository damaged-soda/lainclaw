import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const packagePath = path.join(rootDir, 'package.json');
const versionFilePath = path.join(rootDir, 'src', 'cli', 'version.ts');

const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
const version = packageJson.version;

await fs.writeFile(versionFilePath, `export const VERSION = '${version}';\n`, 'utf-8');
