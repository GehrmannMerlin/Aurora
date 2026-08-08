import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { generateOpenApiDocument } from '../src/generator/openapi.js';
import { OPERATION_MANIFEST } from '../src/registry/manifest.js';

const apiDirUrl = new URL('../../../docs/api/', import.meta.url);
const apiDir = fileURLToPath(apiDirUrl);
const GENERATED_HEADER = '# 由契约源码生成、禁止手工修改\n';

async function main(): Promise<void> {
  await mkdir(apiDir, { recursive: true });
  const yaml =
    GENERATED_HEADER + stringify(generateOpenApiDocument({ title: 'Aurora Platform API' }));
  await writeFile(new URL('platform-openapi-v1.yaml', apiDirUrl), yaml, 'utf8');
  const manifest = JSON.stringify(OPERATION_MANIFEST, null, 2) + '\n';
  await writeFile(new URL('platform-openapi-v1.manifest.json', apiDirUrl), manifest, 'utf8');
}

await main();
