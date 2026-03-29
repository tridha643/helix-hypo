import ts from "typescript";

import type { ExtractedImport } from "./types.js";

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (filePath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (filePath.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

function dedupeNames(names: string[]): string[] {
  return [...new Set(names.filter(Boolean))];
}

function collectBindingNameNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  if (ts.isObjectBindingPattern(name)) {
    return name.elements.flatMap((element) => collectBindingNameNames(element.name));
  }

  if (ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? collectBindingNameNames(element.name) : []
    );
  }

  return [];
}

function collectAssignedExpressionNames(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) {
    return [expression.text];
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) {
        return [property.name.text];
      }

      if (ts.isPropertyAssignment(property)) {
        return collectAssignedExpressionNames(property.initializer);
      }

      return [];
    });
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) =>
      ts.isExpression(element) ? collectAssignedExpressionNames(element) : []
    );
  }

  return [];
}

function collectImportClauseNames(importClause?: ts.ImportClause): string[] {
  if (!importClause) {
    return [];
  }

  const names: string[] = [];

  if (importClause.name) {
    names.push(importClause.name.text);
  }

  if (!importClause.namedBindings) {
    return dedupeNames(names);
  }

  if (ts.isNamespaceImport(importClause.namedBindings)) {
    names.push(`* as ${importClause.namedBindings.name.text}`);
    return dedupeNames(names);
  }

  for (const element of importClause.namedBindings.elements) {
    if (element.propertyName) {
      names.push(`${element.propertyName.text} as ${element.name.text}`);
    } else {
      names.push(element.name.text);
    }
  }

  return dedupeNames(names);
}

function collectExportClauseNames(exportClause?: ts.NamedExportBindings): string[] {
  if (!exportClause) {
    return ["*"];
  }

  if (ts.isNamespaceExport(exportClause)) {
    return [`* as ${exportClause.name.text}`];
  }

  return dedupeNames(
    exportClause.elements.map((element) =>
      element.propertyName ? `${element.propertyName.text} as ${element.name.text}` : element.name.text
    )
  );
}

function unwrapBindingParent(node: ts.Node): ts.Node {
  let current = node;

  while (
    ts.isAwaitExpression(current.parent) ||
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent)
  ) {
    current = current.parent;
  }

  return current;
}

function collectCallBindingNames(node: ts.CallExpression): string[] {
  const current = unwrapBindingParent(node);
  const parent = current.parent;

  if (ts.isVariableDeclaration(parent)) {
    return dedupeNames(collectBindingNameNames(parent.name));
  }

  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return dedupeNames(collectAssignedExpressionNames(parent.left));
  }

  return [];
}

export function extractImports(filePath: string, content: string): ExtractedImport[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );
  const extracted: ExtractedImport[] = [];
  const seen = new Set<string>();

  function pushImport(entry: ExtractedImport): void {
    const key = JSON.stringify([entry.kind, entry.specifier, entry.names]);
    if (!seen.has(key)) {
      seen.add(key);
      extracted.push(entry);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      pushImport({
        kind: "import",
        names: collectImportClauseNames(node.importClause),
        specifier: node.moduleSpecifier.text,
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      pushImport({
        kind: "export",
        names: collectExportClauseNames(node.exportClause),
        specifier: node.moduleSpecifier.text,
      });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const specifier = node.arguments[0].text;

      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        pushImport({
          kind: "require",
          names: collectCallBindingNames(node),
          specifier,
        });
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        pushImport({
          kind: "dynamic-import",
          names: collectCallBindingNames(node),
          specifier,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return extracted;
}
