import type { Definition, Root, RootContent } from "mdast";

/** Carry first-wins document definitions into independently rendered source fragments. */
export function markdownReferences(tree: Root): string {
  const definitions = new Map<string, Definition>();
  function visit(node: RootContent): void {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ("children" in node) node.children.forEach(visit);
  }
  tree.children.forEach(visit);
  return [...definitions.values()]
    .map((node) => {
      const label = node.identifier.replace(/[\\[\]]/g, "\\$&");
      const url = node.url.replace(/[\\<>]/g, "\\$&");
      const title = node.title ? ` "${node.title.replace(/[\\"]/g, "\\$&")}"` : "";
      return `[${label}]: <${url}>${title}`;
    })
    .join("\n");
}
