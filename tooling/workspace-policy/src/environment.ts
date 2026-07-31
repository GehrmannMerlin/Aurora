import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { findTypeScriptSourceFiles } from './imports.js';
import type { WorkspacePackage, WorkspaceViolation } from './types.js';

const forbiddenCoreIdentifiers: ReadonlySet<string> = new Set([
  'Document',
  'Element',
  'Event',
  'EventTarget',
  'HTMLElement',
  'Location',
  'Navigator',
  'Node',
  'Storage',
  'Window',
  'XMLHttpRequest',
  'document',
  'fetch',
  'localStorage',
  'location',
  'navigator',
  'sessionStorage',
  'window',
]);

function packageLayer(workspacePackage: WorkspacePackage): string | undefined {
  const value = workspacePackage.manifest.aurora;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (!('layer' in value)) return undefined;
  return typeof value.layer === 'string' ? value.layer : undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  if (ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function isMutableInitializer(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return false;
  const unwrapped = unwrapExpression(expression);
  return (
    ts.isNewExpression(unwrapped) ||
    ts.isArrayLiteralExpression(unwrapped) ||
    ts.isObjectLiteralExpression(unwrapped)
  );
}

const browserHostRoots: ReadonlySet<string> = new Set([
  'window',
  'document',
  'navigator',
  'performance',
  'globalThis',
  'fetch',
  'XMLHttpRequest',
  'history',
]);

function expressionRoot(expression: ts.Expression): string | undefined {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    return expressionRoot(value.expression);
  }
  return undefined;
}

function containsPrototype(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text === 'prototype' || containsPrototype(value.expression);
  }
  if (ts.isElementAccessExpression(value)) {
    return (
      (ts.isStringLiteralLike(value.argumentExpression) &&
        value.argumentExpression.text === 'prototype') ||
      containsPrototype(value.expression)
    );
  }
  return false;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isMutationCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const owner = node.expression.expression;
  const method = node.expression.name.text;
  const isMutator =
    (ts.isIdentifier(owner) &&
      owner.text === 'Object' &&
      (method === 'defineProperty' || method === 'assign')) ||
    (ts.isIdentifier(owner) && owner.text === 'Reflect' && method === 'set');
  if (!isMutator) return false;
  const target = node.arguments[0];
  return (
    target !== undefined &&
    (browserHostRoots.has(expressionRoot(target) ?? '') || containsPrototype(target))
  );
}

function isBrowserHostMutation(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
    return browserHostRoots.has(expressionRoot(node.left) ?? '') || containsPrototype(node.left);
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const isUpdate =
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken;
    return (
      isUpdate &&
      (browserHostRoots.has(expressionRoot(node.operand) ?? '') || containsPrototype(node.operand))
    );
  }
  return ts.isCallExpression(node) && isMutationCall(node);
}

function inspectSource(
  workspacePackage: WorkspacePackage,
  file: string,
  sourceText: string,
  layer: 'sdk-core' | 'sdk-browser',
): readonly WorkspaceViolation[] {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const violations: WorkspaceViolation[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const hasMutableContainer = statement.declarationList.declarations.some((declaration) =>
      isMutableInitializer(declaration.initializer),
    );
    if (!isConst || hasMutableContainer)
      violations.push({
        code: 'mutable-module-state',
        packageName: workspacePackage.name,
        file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
        message: `${layer} source must not declare module-level mutable state`,
      });
  }
  function visit(node: ts.Node): void {
    if (layer === 'sdk-core') {
      const forbiddenName = ts.isIdentifier(node)
        ? node.text
        : ts.isStringLiteralLike(node) &&
            ts.isElementAccessExpression(node.parent) &&
            node.parent.argumentExpression === node
          ? node.text
          : undefined;
      if (forbiddenName !== undefined && forbiddenCoreIdentifiers.has(forbiddenName)) {
        violations.push({
          code: 'forbidden-runtime-global',
          packageName: workspacePackage.name,
          file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
          message: `sdk-core source must not reference ${forbiddenName}`,
        });
      }
    }
    if (layer === 'sdk-browser' && isBrowserHostMutation(node)) {
      violations.push({
        code: 'forbidden-host-mutation',
        packageName: workspacePackage.name,
        file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
        message: 'sdk-browser source must not mutate host globals or native prototypes',
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

export async function findEnvironmentViolations(
  workspacePackage: WorkspacePackage,
): Promise<readonly WorkspaceViolation[]> {
  const layer = packageLayer(workspacePackage);
  if (layer !== 'sdk-core' && layer !== 'sdk-browser') return [];
  const sourceDirectory = join(workspacePackage.directory, 'src');
  const files = await findTypeScriptSourceFiles(sourceDirectory);
  const groups = await Promise.all(
    files.map(async (file) =>
      inspectSource(workspacePackage, file, await readFile(file, 'utf8'), layer),
    ),
  );
  return groups.flat();
}
