import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface PackageImport {
  readonly file: string;
  readonly specifier: string;
}

export async function findTypeScriptSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  const nested = await Promise.all(
    entries
      .filter(({ name }) => name !== 'dist' && name !== 'node_modules')
      .map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return findTypeScriptSourceFiles(path);
        return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
      }),
  );
  return nested.flat();
}

function literalText(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

export async function collectAuroraImports(
  packageDirectory: string,
): Promise<readonly PackageImport[]> {
  const imports: PackageImport[] = [];
  for (const filePath of await findTypeScriptSourceFiles(packageDirectory)) {
    const source = ts.createSourceFile(
      filePath,
      await readFile(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      let specifier: string | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        specifier = literalText(node.moduleSpecifier);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        specifier = literalText(node.arguments[0]);
      }
      if (specifier?.startsWith('@aurora/')) {
        imports.push({
          file: relative(packageDirectory, filePath).replaceAll('\\', '/'),
          specifier,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return imports.sort((left, right) =>
    `${left.file}\0${left.specifier}`.localeCompare(`${right.file}\0${right.specifier}`),
  );
}
